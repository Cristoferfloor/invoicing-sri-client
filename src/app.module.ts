import { DynamicModule, Inject, Module, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { MongoClient } from 'mongodb';

import { CONFIGURACION_ENVIO, EnviarComprobantesService } from './application/enviar-comprobantes.service';
import { ConsultarAutorizacionesService } from './application/consultar-autorizaciones.service';
import { CONFIGURACION_AUTOMATICO, ProgramadorEnviosService } from './application/programador-envios.service';
import { COMPROBANTES_PORT, LOTES_PORT, SRI_PORT } from './domain/puertos';
import { SoapSriAdapter } from './infrastructure/sri/soap-sri.adapter';
import { MongoComprobantesRepository } from './infrastructure/mongo/mongo-comprobantes.repository';
import { MongoLotesRepository } from './infrastructure/mongo/mongo-lotes.repository';
import { EnviosController } from './infrastructure/rest/envios.controller';
import { SaludController } from './infrastructure/rest/salud.controller';
import { TOKEN_ADMIN, TokenAdminGuard } from './infrastructure/rest/token-admin.guard';

const MONGO = Symbol('MONGO');

@Module({})
export class AppModule implements OnModuleInit, OnApplicationShutdown {
  constructor(
    @Inject(MONGO) private readonly mongo: MongoClient,
    @Inject(LOTES_PORT) private readonly lotes: MongoLotesRepository,
  ) {}

  static registrar(env: NodeJS.ProcessEnv): DynamicModule {
    if (!env.SRI_CLIENT_MONGO_URL) throw new Error('Falta SRI_CLIENT_MONGO_URL.');
    if (!env.SRI_CLIENT_ADMIN_TOKEN) throw new Error('Falta SRI_CLIENT_ADMIN_TOKEN.');

    const mongo = new MongoClient(env.SRI_CLIENT_MONGO_URL);
    const db = mongo.db('invoicing');

    return {
      module: AppModule,
      controllers: [EnviosController, SaludController],
      providers: [
        EnviarComprobantesService,
        ConsultarAutorizacionesService,
        ProgramadorEnviosService,
        TokenAdminGuard,
        {
          provide: CONFIGURACION_AUTOMATICO,
          useValue: {
            activo: env.SRI_CLIENT_AUTO === 'true',
            pulsoMs: Number(env.AUTO_PULSE_MS ?? 3000),
            esperaLoteMs: Number(env.BATCH_WAIT_MS ?? 15000),
            maxComprobantes: Number(env.BATCH_MAX_DOCUMENTS ?? 50),
            esperasConsultaSegundos: (env.SRI_QUERY_WAITS_SEC ?? '3,10,30,60,120,300,600,1800').split(',').map(Number),
            ambientesConLote: (env.BATCH_ENVIRONMENTS ?? '2').split(',').map(Number),
          },
        },
        { provide: MONGO, useValue: mongo },
        { provide: TOKEN_ADMIN, useValue: env.SRI_CLIENT_ADMIN_TOKEN },
        { provide: SRI_PORT, useValue: new SoapSriAdapter(Number(env.SRI_TIMEOUT_MS ?? 60000)) },
        { provide: COMPROBANTES_PORT, useValue: new MongoComprobantesRepository(db) },
        { provide: LOTES_PORT, useValue: new MongoLotesRepository(db) },
        {
          provide: CONFIGURACION_ENVIO,
          useValue: {
            limites: {
              maxComprobantes: Number(env.BATCH_MAX_DOCUMENTS ?? 50),
              maxBytes: Number(env.BATCH_MAX_BYTES ?? 500000),
            },
            serieLote: env.BATCH_SERIES ?? '001001',
            permitirProduccion: env.SRI_CLIENT_ALLOW_PRODUCTION === 'true',
            maxPorEnvio: Number(env.SEND_MAX_DOCUMENTS ?? 500),
            ambientesConLote: (env.BATCH_ENVIRONMENTS ?? '2').split(',').map(Number),
          },
        },
      ],
    };
  }

  async onModuleInit(): Promise<void> {
    await this.mongo.connect();
    await this.lotes.prepararIndices();
  }

  async onApplicationShutdown(): Promise<void> {
    await this.mongo.close();
  }
}
