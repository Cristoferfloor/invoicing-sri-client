import { Db } from 'mongodb';

import { ComprobantesPort, Envio } from '../../domain/puertos';
import { Ambiente, ComprobanteEnviado, ComprobanteFirmado, MensajeSri } from '../../domain/modelo';

type Doc = Record<string, any>;
// Los _id de los comprobantes son UUID en texto, no ObjectId.
type DocComprobante = { _id: string } & Doc;

// Escribe el estado directamente en facturacion.comprobantes porque el Nucleo
// todavia no existe. Cuando exista, este servicio le avisara el resultado y el
// Nucleo sera el unico que escriba.
export class MongoComprobantesRepository implements ComprobantesPort {
  constructor(private readonly db: Db) {}

  private get col() {
    return this.db.collection<DocComprobante>('comprobantes');
  }

  async empresasConFirmados(): Promise<Array<{ empresaId: string; ambiente: number; cantidad: number; masAntiguo: Date }>> {
    const grupos = await this.col
      .aggregate<{ _id: { empresaId: string; ambiente: number }; cantidad: number; masAntiguo: Date }>([
        { $match: { estado: 'FIRMADO' } },
        { $group: { _id: { empresaId: '$empresaId', ambiente: '$ambiente' }, cantidad: { $sum: 1 }, masAntiguo: { $min: '$actualizadoEn' } } },
      ])
      .toArray();
    return grupos.map((g) => ({ empresaId: g._id.empresaId, ambiente: g._id.ambiente, cantidad: g.cantidad, masAntiguo: g.masAntiguo }));
  }

  async empresasConEnviados(): Promise<string[]> {
    return (await this.col.distinct('empresaId', { estado: 'ENVIADO' })) as string[];
  }

  async firmados(empresaId: string, limite: number): Promise<ComprobanteFirmado[]> {
    const docs = await this.col.find({ empresaId, estado: 'FIRMADO' }).sort({ actualizadoEn: 1 }).limit(limite).toArray();
    return docs.flatMap((d) => {
      const intento = this.intentoActual(d);
      const xmlFirmado = intento?.archivos?.xmlFirmado;
      if (!intento || typeof xmlFirmado !== 'string') return [];
      return [{
        id: d._id, empresaId: d.empresaId, tipo: d.tipo, ambiente: d.ambiente as Ambiente,
        intento: intento.numero, claveAcceso: intento.claveAcceso, xmlFirmado,
      }];
    });
  }

  async enviados(empresaId: string): Promise<ComprobanteEnviado[]> {
    const docs = await this.col.find({ empresaId, estado: 'ENVIADO' }).project({ 'intentos.archivos': 0, 'intentos.datos': 0 }).toArray();
    return docs.flatMap((d) => {
      const intento = this.intentoActual(d);
      if (!intento) return [];
      return [{
        id: d._id, empresaId: d.empresaId, ambiente: d.ambiente as Ambiente, intento: intento.numero,
        claveAcceso: intento.claveAcceso, modo: intento.envio?.modo ?? 'INDIVIDUAL', claveLote: intento.envio?.claveLote ?? null,
        consultas: intento.sri?.autorizacion?.consultas ?? 0,
        referencia: intento.sri?.autorizacion?.ultimaConsultaEn ?? intento.envio?.enviadoEn ?? d.actualizadoEn,
      }];
    });
  }

  async marcarEnviado(c: { id: string; intento: number }, envio: Envio, estadoRecepcion: string, mensajes: MensajeSri[]): Promise<boolean> {
    return this.cambiar(c, 'FIRMADO', 'ENVIADO', {
      'intentos.$[i].envio': { ...envio, enviadoEn: new Date() },
      'intentos.$[i].sri': { recepcion: { estado: estadoRecepcion, mensajes, respondidoEn: new Date() }, autorizacion: { estado: null, consultas: 0 } },
    });
  }

  async marcarDevuelto(c: { id: string; intento: number }, envio: Envio, mensajes: MensajeSri[]): Promise<boolean> {
    return this.cambiar(c, 'FIRMADO', 'DEVUELTO', {
      'intentos.$[i].envio': { ...envio, enviadoEn: new Date() },
      'intentos.$[i].sri': { recepcion: { estado: 'DEVUELTA', mensajes, respondidoEn: new Date() }, autorizacion: null },
    });
  }

  async anotarLoteNoReconocido(c: { id: string; intento: number }, claveLote: string): Promise<void> {
    await this.col.updateOne(
      { _id: c.id },
      { $push: { 'intentos.$[i].lotesNoReconocidos': { claveLote, fecha: new Date() } } as Doc, $set: { actualizadoEn: new Date() } },
      { arrayFilters: [{ 'i.numero': c.intento }] },
    );
  }

  async marcarAutorizacion(
    c: { id: string; intento: number },
    r: { estado: 'AUTORIZADO' | 'NO_AUTORIZADO'; numero: string | null; fecha: string | null; mensajes: MensajeSri[] },
  ): Promise<boolean> {
    const set: Doc = {
      'intentos.$[i].sri.autorizacion.estado': r.estado === 'AUTORIZADO' ? 'AUTORIZADO' : 'NO AUTORIZADO',
      'intentos.$[i].sri.autorizacion.fecha': r.fecha,
      'intentos.$[i].sri.autorizacion.mensajes': r.mensajes,
    };
    if (r.estado === 'AUTORIZADO') set['intentos.$[i].autorizacion'] = { numero: r.numero, fecha: r.fecha };
    return this.cambiar(c, 'ENVIADO', r.estado, set, { 'intentos.$[i].sri.autorizacion.consultas': 1 });
  }

  async anotarConsulta(c: { id: string; intento: number }): Promise<void> {
    await this.col.updateOne(
      { _id: c.id, estado: 'ENVIADO' },
      { $inc: { 'intentos.$[i].sri.autorizacion.consultas': 1 }, $set: { 'intentos.$[i].sri.autorizacion.ultimaConsultaEn': new Date() } as Doc },
      { arrayFilters: [{ 'i.numero': c.intento }] },
    );
  }

  // Solo cambia si el comprobante sigue en el estado esperado: si otra
  // ejecucion ya lo movio, no se pisa.
  private async cambiar(c: { id: string; intento: number }, desde: string, hacia: string, set: Doc, inc?: Doc): Promise<boolean> {
    const ahora = new Date();
    const resultado = await this.col.updateOne(
      { _id: c.id, estado: desde },
      {
        $set: { estado: hacia, actualizadoEn: ahora, 'intentos.$[i].estado': hacia, ...set },
        $push: { 'intentos.$[i].historial': { estado: hacia, fecha: ahora, servicio: 'cliente-sri' } } as Doc,
        ...(inc ? { $inc: inc } : {}),
      },
      { arrayFilters: [{ 'i.numero': c.intento }] },
    );
    return resultado.modifiedCount === 1;
  }

  private intentoActual(d: Doc): Doc | undefined {
    return (d.intentos as Doc[] | undefined)?.find((i) => i.numero === d.intentoActual);
  }
}
