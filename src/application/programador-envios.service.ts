import { Inject, Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';

import { COMPROBANTES_PORT, ComprobantesPort } from '../domain/puertos';
import { EnviarComprobantesService } from './enviar-comprobantes.service';
import { ConsultarAutorizacionesService } from './consultar-autorizaciones.service';

export const CONFIGURACION_AUTOMATICO = Symbol('CONFIGURACION_AUTOMATICO');

export interface ConfiguracionAutomatico {
  activo: boolean;
  pulsoMs: number;
  // Se espera a juntar un lote: sale al llegar a maxComprobantes o cuando el
  // FIRMADO mas antiguo cumple esta espera.
  esperaLoteMs: number;
  maxComprobantes: number;
  esperasConsultaSegundos: number[];
  // Solo en estos ambientes se espera a juntar lote; en los demas se envia ya.
  ambientesConLote: number[];
}

// Modo automatico: sin Postman, envia los FIRMADO y consulta los ENVIADO.
@Injectable()
export class ProgramadorEnviosService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(ProgramadorEnviosService.name);
  private temporizador?: NodeJS.Timeout;
  private ocupado = false;

  constructor(
    private readonly envio: EnviarComprobantesService,
    private readonly consulta: ConsultarAutorizacionesService,
    @Inject(COMPROBANTES_PORT) private readonly comprobantes: ComprobantesPort,
    @Inject(CONFIGURACION_AUTOMATICO) private readonly config: ConfiguracionAutomatico,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.config.activo) return;
    this.temporizador = setInterval(() => void this.pulso(), this.config.pulsoMs);
    this.logger.log(JSON.stringify({
      evento: 'envio_automatico_activo', esperaLoteMs: this.config.esperaLoteMs,
      maxComprobantes: this.config.maxComprobantes, esperasConsultaSegundos: this.config.esperasConsultaSegundos,
    }));
  }

  onApplicationShutdown(): void {
    if (this.temporizador) clearInterval(this.temporizador);
  }

  private async pulso(): Promise<void> {
    if (this.ocupado) return;
    this.ocupado = true;
    try {
      const listas = new Set<string>();
      for (const grupo of await this.comprobantes.empresasConFirmados()) {
        const esperando = Date.now() - new Date(grupo.masAntiguo).getTime();
        const conLote = this.config.ambientesConLote.includes(grupo.ambiente);
        if (!conLote || grupo.cantidad >= this.config.maxComprobantes || esperando >= this.config.esperaLoteMs) {
          listas.add(grupo.empresaId);
        }
      }

      for (const empresaId of listas) {
        const grupo = { empresaId };

        const r = await this.envio.enviar(grupo.empresaId);
        this.logger.log(JSON.stringify({
          evento: 'envio_automatico', empresaId: grupo.empresaId, firmados: r.firmados,
          lotes: r.lotes.map((l) => ({ claveLote: l.claveLote, comprobantes: l.comprobantes, resultado: l.resultado, mensaje: l.mensaje })),
          individuales: r.individuales.length,
          individualesPorResultado: r.individuales.reduce<Record<string, number>>((a, i) => ({ ...a, [i.resultado]: (a[i.resultado] ?? 0) + 1 }), {}),
          error: r.error,
        }));
      }

      for (const empresaId of await this.comprobantes.empresasConEnviados()) {
        const r = await this.consulta.consultar(empresaId, this.config.esperasConsultaSegundos);
        if (r.comprobantes.length === 0 && !r.error) continue;
        this.logger.log(JSON.stringify({
          evento: 'consulta_automatica', empresaId, lotesConsultados: r.lotesConsultados,
          resultados: r.comprobantes.reduce<Record<string, number>>((a, c) => ({ ...a, [c.resultado]: (a[c.resultado] ?? 0) + 1 }), {}),
          error: r.error,
        }));
      }
    } catch (error) {
      this.logger.error(JSON.stringify({ evento: 'pulso_fallido', error: (error as Error).message }));
    } finally {
      this.ocupado = false;
    }
  }
}
