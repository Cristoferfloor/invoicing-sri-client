import {
  Ambiente,
  ComprobanteEnviado,
  ComprobanteFirmado,
  EstadoLote,
  MensajeSri,
  RespuestaAutorizacion,
  RespuestaRecepcion,
} from './modelo';

export const SRI_PORT = Symbol('SRI_PORT');
export const COMPROBANTES_PORT = Symbol('COMPROBANTES_PORT');
export const LOTES_PORT = Symbol('LOTES_PORT');

export interface SriPort {
  // Lanza SriNoDisponibleError si el SRI no responde.
  recepcion(ambiente: Ambiente, xml: string): Promise<RespuestaRecepcion>;
  autorizacion(ambiente: Ambiente, claveAcceso: string): Promise<RespuestaAutorizacion>;
  autorizacionLote(ambiente: Ambiente, claveLote: string): Promise<RespuestaAutorizacion>;
}

export interface Envio {
  modo: 'LOTE' | 'INDIVIDUAL';
  claveLote: string | null;
  // Por que salio individual (por ejemplo, el SRI no reconocio el lote).
  motivo: string | null;
}

export interface ComprobantesPort {
  // Para el modo automatico: empresas con comprobantes pendientes.
  empresasConFirmados(): Promise<Array<{ empresaId: string; ambiente: number; cantidad: number; masAntiguo: Date }>>;
  empresasConEnviados(): Promise<string[]>;
  firmados(empresaId: string, limite: number): Promise<ComprobanteFirmado[]>;
  enviados(empresaId: string): Promise<ComprobanteEnviado[]>;
  // Cambia el estado solo si el comprobante sigue en el estado esperado.
  marcarEnviado(c: { id: string; intento: number }, envio: Envio, estadoRecepcion: string, mensajes: MensajeSri[]): Promise<boolean>;
  marcarDevuelto(c: { id: string; intento: number }, envio: Envio, mensajes: MensajeSri[]): Promise<boolean>;
  anotarLoteNoReconocido(c: { id: string; intento: number }, claveLote: string): Promise<void>;
  marcarAutorizacion(
    c: { id: string; intento: number },
    resultado: { estado: 'AUTORIZADO' | 'NO_AUTORIZADO'; numero: string | null; fecha: string | null; mensajes: MensajeSri[] },
  ): Promise<boolean>;
  anotarConsulta(c: { id: string; intento: number }): Promise<void>;
}

export interface ComprobanteDelLote {
  comprobanteId: string;
  claveAcceso: string;
  estado: string;
}

export interface LoteGuardado {
  claveLote: string;
  empresaId: string;
  tipo: string;
  ambiente: Ambiente;
  estado: EstadoLote;
  comprobantes: ComprobanteDelLote[];
  tamanoBytes: number;
  sri: {
    recepcion: { estado: string | null; mensajes: MensajeSri[]; respondidoEn: Date | null };
    autorizacion: { consultas: number; numeroComprobantesLote: number; ultimaConsultaEn: Date | null };
  };
  creadoEn: Date;
  actualizadoEn: Date;
}

export interface LotesPort {
  siguienteSecuencial(empresaId: string, ambiente: Ambiente): Promise<number>;
  crear(lote: LoteGuardado): Promise<void>;
  registrarRecepcion(claveLote: string, estado: EstadoLote, recepcion: { estado: string | null; mensajes: MensajeSri[] }, comprobantes: ComprobanteDelLote[]): Promise<void>;
  registrarConsulta(claveLote: string, numeroComprobantesLote: number, comprobantes: ComprobanteDelLote[], estado: EstadoLote): Promise<void>;
  obtener(claveLote: string): Promise<LoteGuardado | null>;
  recibidos(empresaId: string): Promise<LoteGuardado[]>;
}
