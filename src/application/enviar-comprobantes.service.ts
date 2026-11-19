import { Inject, Injectable, Logger } from '@nestjs/common';

import { COMPROBANTES_PORT, ComprobantesPort, LOTES_PORT, LotesPort, SRI_PORT, SriPort } from '../domain/puertos';
import { ComprobanteFirmado } from '../domain/modelo';
import { LimitesLote, armarLotes, xmlDeLote } from '../domain/lote';
import { claveDeLote } from '../domain/clave-acceso';
import { interpretarRecepcionIndividual, interpretarRecepcionLote } from '../domain/interpretacion';
import { SriNoDisponibleError } from '../domain/errores';

export const CONFIGURACION_ENVIO = Symbol('CONFIGURACION_ENVIO');

export interface ConfiguracionEnvio {
  limites: LimitesLote;
  serieLote: string;
  permitirProduccion: boolean;
  maxPorEnvio: number;
  // Ambientes donde se intenta el lote. El SRI de pruebas (1) no reconoce
  // <lote>; produccion (2) si.
  ambientesConLote: number[];
}

export interface ResumenEnvio {
  empresaRuc: string;
  firmados: number;
  omitidosProduccion: number;
  lotes: Array<{ claveLote: string; comprobantes: number; bytes: number; resultado: string; mensaje: string | null }>;
  individuales: Array<{ claveAcceso: string; motivo: string; resultado: string; mensaje: string | null }>;
  error: string | null;
}

@Injectable()
export class EnviarComprobantesService {
  private readonly logger = new Logger(EnviarComprobantesService.name);

  constructor(
    @Inject(SRI_PORT) private readonly sri: SriPort,
    @Inject(COMPROBANTES_PORT) private readonly comprobantes: ComprobantesPort,
    @Inject(LOTES_PORT) private readonly lotes: LotesPort,
    @Inject(CONFIGURACION_ENVIO) private readonly config: ConfiguracionEnvio,
  ) {}

  async enviar(empresaRuc: string): Promise<ResumenEnvio> {
    const firmados = await this.comprobantes.firmados(empresaRuc, this.config.maxPorEnvio);
    // Seguro: produccion solo si se activa a proposito.
    const enviables = firmados.filter((c) => c.ambiente === 1 || this.config.permitirProduccion);
    const resumen: ResumenEnvio = {
      empresaRuc,
      firmados: firmados.length,
      omitidosProduccion: firmados.length - enviables.length,
      lotes: [],
      individuales: [],
      error: null,
    };

    try {
      const conLote = enviables.filter((c) => this.config.ambientesConLote.includes(c.ambiente));
      for (const grupo of armarLotes(conLote, this.config.limites)) {
        await this.enviarLote(grupo, resumen);
      }
      for (const c of enviables.filter((c) => !this.config.ambientesConLote.includes(c.ambiente))) {
        await this.enviarIndividual(c, `Ambiente ${c.ambiente}: envio por lote desactivado`, resumen);
      }
    } catch (error) {
      if (!(error instanceof SriNoDisponibleError)) throw error;
      // Lo que no se envio queda FIRMADO y sale en el proximo envio.
      resumen.error = error.message;
      this.logger.warn(JSON.stringify({ evento: 'sri_no_disponible', empresaRuc, mensaje: error.message }));
    }
    return resumen;
  }

  private async enviarLote(grupo: ComprobanteFirmado[], resumen: ResumenEnvio): Promise<void> {
    const { empresaId, ambiente, tipo } = grupo[0];
    const secuencial = await this.lotes.siguienteSecuencial(empresaId, ambiente);
    const claveLote = claveDeLote({ fecha: new Date(), ruc: empresaId, ambiente, serie: this.config.serieLote, secuencial });
    const xml = xmlDeLote(claveLote, empresaId, grupo);
    const bytes = Buffer.byteLength(xml, 'utf8');
    const ahora = new Date();
    const comprobantesDelLote = grupo.map((c) => ({ comprobanteId: c.id, claveAcceso: c.claveAcceso, estado: 'FIRMADO' }));

    await this.lotes.crear({
      claveLote, empresaId, tipo, ambiente, estado: 'CREADO', comprobantes: comprobantesDelLote, tamanoBytes: bytes,
      sri: { recepcion: { estado: null, mensajes: [], respondidoEn: null }, autorizacion: { consultas: 0, numeroComprobantesLote: 0, ultimaConsultaEn: null } },
      creadoEn: ahora, actualizadoEn: ahora,
    });

    let respuesta;
    try {
      respuesta = await this.sri.recepcion(ambiente, xml);
    } catch (error) {
      if (error instanceof SriNoDisponibleError) {
        await this.lotes.registrarRecepcion(claveLote, 'NO_ENVIADO', { estado: null, mensajes: [] }, comprobantesDelLote);
        resumen.lotes.push({ claveLote, comprobantes: grupo.length, bytes, resultado: 'NO_ENVIADO', mensaje: error.message });
      }
      throw error;
    }

    const resultado = interpretarRecepcionLote(respuesta, grupo.map((c) => c.claveAcceso));
    const porClave = new Map(grupo.map((c) => [c.claveAcceso, c]));
    const envioLote = { modo: 'LOTE' as const, claveLote, motivo: null };

    this.logger.log(JSON.stringify({ evento: 'lote_enviado', empresaId, claveLote, comprobantes: grupo.length, bytes, estadoSri: respuesta.estado, resultado: resultado.tipo }));

    if (resultado.tipo === 'NO_RECONOCIDO') {
      const mensaje = resultado.mensajes.map((m) => `${m.identificador} ${m.mensaje}`).join('; ');
      for (const c of grupo) await this.comprobantes.anotarLoteNoReconocido(c, claveLote);
      await this.lotes.registrarRecepcion(claveLote, 'NO_RECONOCIDO', { estado: respuesta.estado, mensajes: resultado.mensajes }, comprobantesDelLote);
      resumen.lotes.push({ claveLote, comprobantes: grupo.length, bytes, resultado: 'NO_RECONOCIDO', mensaje });
      // Respaldo: el SRI no evaluo ningun comprobante, salen uno por uno.
      for (const c of grupo) await this.enviarIndividual(c, `El SRI no reconocio el lote ${claveLote}: ${mensaje}`, resumen);
      return;
    }

    for (const [clave, mensajes] of resultado.devueltos) {
      await this.comprobantes.marcarDevuelto(porClave.get(clave)!, envioLote, mensajes);
      comprobantesDelLote.find((c) => c.claveAcceso === clave)!.estado = 'DEVUELTO';
    }
    for (const clave of resultado.recibidos) {
      await this.comprobantes.marcarEnviado(porClave.get(clave)!, envioLote, respuesta.estado, []);
      comprobantesDelLote.find((c) => c.claveAcceso === clave)!.estado = 'ENVIADO';
    }
    const estadoLote = resultado.tipo === 'RECIBIDO' ? 'RECIBIDO' : resultado.recibidos.length > 0 ? 'RECIBIDO' : 'DEVUELTO';
    await this.lotes.registrarRecepcion(
      claveLote, estadoLote,
      { estado: respuesta.estado, mensajes: [...resultado.devueltos.values()].flat() },
      comprobantesDelLote,
    );
    resumen.lotes.push({
      claveLote, comprobantes: grupo.length, bytes, resultado: estadoLote,
      mensaje: `${resultado.recibidos.length} recibidos, ${resultado.devueltos.size} devueltos, ${resultado.sinEvaluar.length} sin evaluar`,
    });

    for (const clave of resultado.sinEvaluar) {
      await this.enviarIndividual(porClave.get(clave)!, `Devolucion total del lote ${claveLote} sin detalle para este comprobante`, resumen);
    }
  }

  private async enviarIndividual(c: ComprobanteFirmado, motivo: string, resumen: ResumenEnvio): Promise<void> {
    const respuesta = await this.sri.recepcion(c.ambiente, c.xmlFirmado);
    const resultado = interpretarRecepcionIndividual(respuesta);
    const envio = { modo: 'INDIVIDUAL' as const, claveLote: null, motivo };
    // Con el detalle del SRI (informacionAdicional): sin el, una devolucion 35 no dice que campo esta mal.
    const mensaje = resultado.mensajes.map((m) => `${m.identificador} ${m.mensaje} ${m.informacionAdicional ?? ''}`.trim()).join('; ') || null;

    if (resultado.tipo === 'ENVIADO') {
      await this.comprobantes.marcarEnviado(c, envio, respuesta.estado, resultado.mensajes);
    } else {
      await this.comprobantes.marcarDevuelto(c, envio, resultado.mensajes);
    }
    resumen.individuales.push({ claveAcceso: c.claveAcceso, motivo, resultado: resultado.tipo, mensaje });
    this.logger.log(JSON.stringify({ evento: 'envio_individual', claveAcceso: c.claveAcceso, estadoSri: respuesta.estado, resultado: resultado.tipo }));
  }
}
