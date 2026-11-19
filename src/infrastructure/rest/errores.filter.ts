import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus } from '@nestjs/common';
import { Response } from 'express';

import { ErrorClienteSri } from '../../domain/errores';

const ESTADO_HTTP: Record<string, HttpStatus> = {
  LOTE_NO_ENCONTRADO: HttpStatus.NOT_FOUND,
  SRI_NO_DISPONIBLE: HttpStatus.SERVICE_UNAVAILABLE,
  RESPUESTA_SRI_ILEGIBLE: HttpStatus.BAD_GATEWAY,
  COMPROBANTE_NO_ENCONTRADO: HttpStatus.NOT_FOUND,
};

@Catch(ErrorClienteSri)
export class ErroresFilter implements ExceptionFilter<ErrorClienteSri> {
  catch(error: ErrorClienteSri, host: ArgumentsHost): void {
    host
      .switchToHttp()
      .getResponse<Response>()
      .status(ESTADO_HTTP[error.codigo] ?? HttpStatus.INTERNAL_SERVER_ERROR)
      .json({ estado: 'RECHAZADO', error: error.codigo, mensaje: error.message });
  }
}
