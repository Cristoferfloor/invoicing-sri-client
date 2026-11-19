import { Autorizacion, MensajeSri, RespuestaRecepcion } from './modelo';

// Resultado de enviar un lote, comprobante por comprobante.
export type ResultadoLote =
  // El SRI no reconocio el <lote> (hoy: DEVUELTA, error 35, clave "N/A").
  // Ningun comprobante fue evaluado: todos salen individualmente.
  | { tipo: 'NO_RECONOCIDO'; mensajes: MensajeSri[] }
  | {
      tipo: 'RECIBIDO' | 'DEVUELTO';
      // Recibidos: esperan autorizacion.
      recibidos: string[];
      // Devueltos por sus datos: no se reenvian igual.
      devueltos: Map<string, MensajeSri[]>;
      // En una devolucion total, los que el SRI no listo no fueron recibidos:
      // se reenvian individualmente.
      sinEvaluar: string[];
    };

export function interpretarRecepcionLote(respuesta: RespuestaRecepcion, clavesDelLote: string[]): ResultadoLote {
  const enLote = new Set(clavesDelLote);
  const listados = respuesta.comprobantes.filter((c) => enLote.has(c.claveAcceso));

  if (respuesta.estado !== 'RECIBIDA' && listados.length === 0) {
    return { tipo: 'NO_RECONOCIDO', mensajes: respuesta.comprobantes.flatMap((c) => c.mensajes) };
  }

  const devueltos = new Map<string, MensajeSri[]>();
  for (const c of listados) {
    // Error 43: la clave ya estaba registrada. No es un rechazo: hay que
    // consultar su autorizacion.
    if (!c.mensajes.some((m) => m.identificador === '43')) devueltos.set(c.claveAcceso, c.mensajes);
  }
  const noDevueltos = clavesDelLote.filter((clave) => !devueltos.has(clave));

  if (respuesta.estado === 'RECIBIDA') {
    return { tipo: 'RECIBIDO', recibidos: noDevueltos, devueltos, sinEvaluar: [] };
  }
  const registrados = listados.filter((c) => !devueltos.has(c.claveAcceso)).map((c) => c.claveAcceso);
  return {
    tipo: 'DEVUELTO',
    recibidos: registrados,
    devueltos,
    sinEvaluar: noDevueltos.filter((clave) => !registrados.includes(clave)),
  };
}

export type ResultadoIndividual =
  | { tipo: 'ENVIADO'; mensajes: MensajeSri[] }
  | { tipo: 'DEVUELTO'; mensajes: MensajeSri[] };

export function interpretarRecepcionIndividual(respuesta: RespuestaRecepcion): ResultadoIndividual {
  const mensajes = respuesta.comprobantes.flatMap((c) => c.mensajes);
  if (respuesta.estado === 'RECIBIDA') return { tipo: 'ENVIADO', mensajes };
  // Clave ya registrada: se trata como enviada y se consulta la autorizacion.
  if (mensajes.some((m) => m.identificador === '43')) return { tipo: 'ENVIADO', mensajes };
  return { tipo: 'DEVUELTO', mensajes };
}

// "0 comprobantes" o sin respuesta para esa clave significa "todavia no".
export type EstadoAutorizacion = 'AUTORIZADO' | 'NO_AUTORIZADO' | 'PENDIENTE';

export function estadoDeAutorizacion(autorizacion: Autorizacion | undefined): EstadoAutorizacion {
  if (!autorizacion) return 'PENDIENTE';
  if (autorizacion.estado === 'AUTORIZADO') return 'AUTORIZADO';
  if (autorizacion.estado === 'NO AUTORIZADO') return 'NO_AUTORIZADO';
  return 'PENDIENTE';
}
