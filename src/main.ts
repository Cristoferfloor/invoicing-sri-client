import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { json } from 'express';

import { AppModule } from './app.module';
import { ErroresFilter } from './infrastructure/rest/errores.filter';

async function bootstrap() {
  // Fuera de Docker las variables vienen de .env; dentro, de env_file.
  try {
    process.loadEnvFile();
  } catch {
    // sin .env: se usan las variables del entorno
  }

  // Se desactiva el body parser por defecto para poder subir el limite: un comprobante firmado con muchos
  // detalles (~70KB de XML) en base64 supera los 100kb que trae Nest de fabrica y se rechazaba con 413,
  // dejando la factura sin firmar en la Cloud.
  const app = await NestFactory.create(AppModule.registrar(process.env), { bodyParser: false });
  app.enableShutdownHooks();
  app.use(json({ limit: process.env.SRI_CLIENT_MAX_BODY ?? '10mb' }));
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }));
  app.useGlobalFilters(new ErroresFilter());

  const puerto = Number(process.env.PORT ?? 3004);
  await app.listen(puerto, '0.0.0.0');

  new Logger('Bootstrap').log(
    `sri-client-service escuchando en :${puerto} | produccion ${process.env.SRI_CLIENT_ALLOW_PRODUCTION === 'true' ? 'HABILITADA' : 'deshabilitada'}`,
  );
}

void bootstrap();
