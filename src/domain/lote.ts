import { ComprobanteFirmado } from './modelo';

export interface LimitesLote {
  maxComprobantes: number;
  maxBytes: number;
}

// Ficha tecnica 2.26: "500 kb o 50 comprobantes".
export const LIMITES_FICHA: LimitesLote = { maxComprobantes: 50, maxBytes: 500 * 1000 };

// Lo que ocupa un comprobante dentro del lote.
const bytesDentroDelLote = (c: ComprobanteFirmado) =>
  Buffer.byteLength(`<comprobante><![CDATA[${c.xmlFirmado}]]></comprobante>`, 'utf8');
const BYTES_CABECERA = 260;

// Agrupa sin mezclar empresa, ambiente ni tipo, y respetando los limites.
export function armarLotes(comprobantes: ComprobanteFirmado[], limites: LimitesLote = LIMITES_FICHA): ComprobanteFirmado[][] {
  const grupos = new Map<string, ComprobanteFirmado[]>();
  for (const c of comprobantes) {
    const llave = `${c.empresaId}|${c.ambiente}|${c.tipo}`;
    grupos.set(llave, [...(grupos.get(llave) ?? []), c]);
  }

  const lotes: ComprobanteFirmado[][] = [];
  for (const grupo of grupos.values()) {
    let actual: ComprobanteFirmado[] = [];
    let bytes = BYTES_CABECERA;
    for (const c of grupo) {
      const tamano = bytesDentroDelLote(c);
      const llena = actual.length >= limites.maxComprobantes || (actual.length > 0 && bytes + tamano > limites.maxBytes);
      if (llena) {
        lotes.push(actual);
        actual = [];
        bytes = BYTES_CABECERA;
      }
      actual.push(c);
      bytes += tamano;
    }
    if (actual.length > 0) lotes.push(actual);
  }
  return lotes;
}

// Formato de la tabla 8 de la ficha tecnica.
export function xmlDeLote(claveLote: string, ruc: string, comprobantes: ComprobanteFirmado[]): string {
  return (
    `<?xml version="1.0" encoding="UTF-8"?><lote version="1.0.0">` +
    `<claveAcceso>${claveLote}</claveAcceso><ruc>${ruc}</ruc><comprobantes>` +
    comprobantes.map((c) => `<comprobante><![CDATA[${c.xmlFirmado}]]></comprobante>`).join('') +
    `</comprobantes></lote>`
  );
}
