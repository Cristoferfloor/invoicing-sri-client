import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { Matches } from 'class-validator';

import { EnviarComprobantesService } from '../../application/enviar-comprobantes.service';
import { TokenAdminGuard } from './token-admin.guard';

export class EmpresaDto {
  @Matches(/^\d{10}00[1-9]$/, { message: 'empresaRuc debe ser un RUC de 13 digitos.' })
  empresaRuc!: string;
}

@Controller('v1')
@UseGuards(TokenAdminGuard)
export class EnviosController {
  constructor(private readonly envio: EnviarComprobantesService) {}

  @Post('envios')
  @HttpCode(HttpStatus.OK)
  enviar(@Body() cuerpo: EmpresaDto) {
    return this.envio.enviar(cuerpo.empresaRuc);
  }
}
