import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { createHash, timingSafeEqual } from 'node:crypto';
import { Request } from 'express';

export const TOKEN_ADMIN = Symbol('TOKEN_ADMIN');

// Mientras no exista el panel con usuarios, se protege con un token del
// servicio en el header X-Token-Admin.
@Injectable()
export class TokenAdminGuard implements CanActivate {
  constructor(@Inject(TOKEN_ADMIN) private readonly esperado: string) {}

  canActivate(contexto: ExecutionContext): boolean {
    const recibido = contexto.switchToHttp().getRequest<Request>().header('x-token-admin') ?? '';
    const resumen = (v: string) => createHash('sha256').update(v).digest();
    if (!timingSafeEqual(resumen(recibido), resumen(this.esperado))) {
      throw new ForbiddenException('Token de administracion invalido.');
    }
    return true;
  }
}
