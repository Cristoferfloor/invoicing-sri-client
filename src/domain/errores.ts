export abstract class ErrorClienteSri extends Error {
  abstract readonly codigo: string;

  constructor(mensaje: string) {
    super(mensaje);
    this.name = new.target.name;
  }
}

// Timeout, red o error del servidor del SRI: no dice nada del comprobante.
export class SriNoDisponibleError extends ErrorClienteSri {
  readonly codigo = 'SRI_NO_DISPONIBLE';
}

export class RespuestaSriIlegibleError extends ErrorClienteSri {
  readonly codigo = 'RESPUESTA_SRI_ILEGIBLE';
}

export class LoteNoEncontradoError extends ErrorClienteSri {
  readonly codigo = 'LOTE_NO_ENCONTRADO';
}
