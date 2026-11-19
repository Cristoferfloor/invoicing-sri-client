import { Db } from 'mongodb';

import { ComprobanteDelLote, LoteGuardado, LotesPort } from '../../domain/puertos';
import { Ambiente, EstadoLote, MensajeSri } from '../../domain/modelo';

// La clave del lote es su _id.
type Doc = { _id: string } & Record<string, any>;

export class MongoLotesRepository implements LotesPort {
  constructor(private readonly db: Db) {}

  private get col() {
    return this.db.collection<Doc>('lotes');
  }

  async prepararIndices(): Promise<void> {
    await this.col.createIndex({ empresaId: 1, estado: 1, creadoEn: -1 }, { name: 'por_empresa_y_estado' });
  }

  // Contador atomico: dos envios a la vez nunca obtienen el mismo numero.
  async siguienteSecuencial(empresaId: string, ambiente: Ambiente): Promise<number> {
    const contador = await this.db.collection<{ _id: string; valor: number }>('contadores').findOneAndUpdate(
      { _id: `lote:${empresaId}:${ambiente}` },
      { $inc: { valor: 1 } },
      { upsert: true, returnDocument: 'after' },
    );
    return contador!.valor;
  }

  async crear(lote: LoteGuardado): Promise<void> {
    const { claveLote, ...resto } = lote;
    await this.col.insertOne({ _id: claveLote, ...resto });
  }

  async registrarRecepcion(
    claveLote: string,
    estado: EstadoLote,
    recepcion: { estado: string | null; mensajes: MensajeSri[] },
    comprobantes: ComprobanteDelLote[],
  ): Promise<void> {
    await this.col.updateOne(
      { _id: claveLote },
      { $set: { estado, comprobantes, 'sri.recepcion': { ...recepcion, respondidoEn: new Date() }, actualizadoEn: new Date() } },
    );
  }

  async registrarConsulta(claveLote: string, numeroComprobantesLote: number, comprobantes: ComprobanteDelLote[], estado: EstadoLote): Promise<void> {
    await this.col.updateOne(
      { _id: claveLote },
      {
        $set: {
          estado, comprobantes, actualizadoEn: new Date(),
          'sri.autorizacion.numeroComprobantesLote': numeroComprobantesLote,
          'sri.autorizacion.ultimaConsultaEn': new Date(),
        },
        $inc: { 'sri.autorizacion.consultas': 1 },
      },
    );
  }

  async obtener(claveLote: string): Promise<LoteGuardado | null> {
    const doc = await this.col.findOne({ _id: claveLote });
    return doc ? this.aModelo(doc) : null;
  }

  async recibidos(empresaId: string): Promise<LoteGuardado[]> {
    const docs = await this.col.find({ empresaId, estado: 'RECIBIDO' }).sort({ creadoEn: 1 }).toArray();
    return docs.map((d) => this.aModelo(d));
  }

  private aModelo(d: Doc): LoteGuardado {
    const { _id, ...resto } = d;
    return { claveLote: _id, ...resto } as LoteGuardado;
  }
}
