export type Ambiente = 1 | 2;

export interface MensajeSri {
  identificador: string;
  mensaje: string;
  informacionAdicional: string | null;
  tipo: string;
}

// Lo que se necesita de un comprobante FIRMADO para enviarlo.
export interface ComprobanteFirmado {
  id: string;
  empresaId: string;
  tipo: string;
  ambiente: Ambiente;
  intento: number;
  claveAcceso: string;
  xmlFirmado: string;
}

// Un comprobante ya enviado que espera la autorizacion.
export interface ComprobanteEnviado {
  id: string;
  empresaId: string;
  ambiente: Ambiente;
  intento: number;
  claveAcceso: string;
  modo: 'LOTE' | 'INDIVIDUAL';
  claveLote: string | null;
  // Para espaciar las consultas: cuantas van y desde cuando contar.
  consultas: number;
  referencia: Date;
}

export interface RespuestaRecepcion {
  estado: string;
  // Comprobantes que el SRI lista en la respuesta (en un lote, los devueltos).
  comprobantes: Array<{ claveAcceso: string; mensajes: MensajeSri[] }>;
}

export interface Autorizacion {
  claveAcceso: string | null;
  estado: string;
  numeroAutorizacion: string | null;
  fechaAutorizacion: string | null;
  mensajes: MensajeSri[];
}

export interface RespuestaAutorizacion {
  numeroComprobantes: number;
  autorizaciones: Autorizacion[];
}

export type EstadoLote = 'CREADO' | 'NO_ENVIADO' | 'NO_RECONOCIDO' | 'RECIBIDO' | 'DEVUELTO' | 'COMPLETADO';
