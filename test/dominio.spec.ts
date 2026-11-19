import { claveDeLote, digitoVerificador, esClaveValida } from '../src/domain/clave-acceso';
import { armarLotes, xmlDeLote } from '../src/domain/lote';
import { leerRespuestaRecepcion } from '../src/domain/respuestas-sri';
import { interpretarRecepcionIndividual, interpretarRecepcionLote } from '../src/domain/interpretacion';
import { ComprobanteFirmado } from '../src/domain/modelo';

const comprobante = (n: number, extra: Partial<ComprobanteFirmado> = {}): ComprobanteFirmado => ({
  id: `id-${n}`, empresaId: '2390625475001', tipo: '01', ambiente: 1, intento: 1,
  claveAcceso: `clave-${n}`, xmlFirmado: `<factura id="comprobante">${n}</factura>`, ...extra,
});

describe('clave de acceso', () => {
  it('valida una clave real autorizada por el SRI', () => {
    expect(esClaveValida('1509202601239062547500110010010007335350073353516')).toBe(true);
    expect(esClaveValida('1509202601239062547500110010010007335350073353515')).toBe(false);
  });

  it('arma la clave del lote con 49 digitos, tipo 00 y digito correcto', () => {
    const clave = claveDeLote({ fecha: new Date(2026, 8, 16), ruc: '2390625475001', ambiente: 1, serie: '001001', secuencial: 7 });
    expect(clave).toHaveLength(49);
    expect(clave.slice(0, 8)).toBe('16092026');
    expect(clave.slice(8, 10)).toBe('00');
    expect(clave.slice(10, 23)).toBe('2390625475001');
    expect(clave[23]).toBe('1');
    expect(clave.slice(24, 39)).toBe('001001000000007');
    expect(esClaveValida(clave)).toBe(true);
  });

  it('no repite el error del Java en el digito de las claves reales del 27/08', () => {
    expect(digitoVerificador('270820260017913495120012001001000092183000921801')).toBe('4');
  });
});

describe('armado de lotes (ficha tecnica: 50 comprobantes o 500 KB)', () => {
  it('parte en lotes de 50', () => {
    const lotes = armarLotes(Array.from({ length: 120 }, (_, i) => comprobante(i)));
    expect(lotes.map((l) => l.length)).toEqual([50, 50, 20]);
  });

  it('parte por tamano', () => {
    const grande = 'x'.repeat(200_000);
    const lotes = armarLotes([1, 2, 3].map((n) => comprobante(n, { xmlFirmado: grande })));
    expect(lotes.map((l) => l.length)).toEqual([2, 1]);
  });

  it('no mezcla ambientes ni tipos', () => {
    const lotes = armarLotes([comprobante(1), comprobante(2, { ambiente: 2 }), comprobante(3, { tipo: '04' })]);
    expect(lotes).toHaveLength(3);
  });

  it('arma el XML de la tabla 8', () => {
    expect(xmlDeLote('1'.repeat(49), '2390625475001', [comprobante(1)])).toBe(
      '<?xml version="1.0" encoding="UTF-8"?><lote version="1.0.0"><claveAcceso>' + '1'.repeat(49) +
        '</claveAcceso><ruc>2390625475001</ruc><comprobantes><comprobante><![CDATA[<factura id="comprobante">1</factura>]]></comprobante></comprobantes></lote>',
    );
  });
});

const sobreRecepcion = (interior: string) =>
  `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><ns2:validarComprobanteResponse xmlns:ns2="http://ec.gob.sri.ws.recepcion"><RespuestaRecepcionComprobante>${interior}</RespuestaRecepcionComprobante></ns2:validarComprobanteResponse></soap:Body></soap:Envelope>`;
const mensaje = (id: string, texto: string, adicional: string) =>
  `<mensajes><mensaje><identificador>${id}</identificador><mensaje>${texto}</mensaje><informacionAdicional>${adicional}</informacionAdicional><tipo>ERROR</tipo></mensaje></mensajes>`;

describe('respuestas de recepcion', () => {
  it('lote no reconocido: la respuesta real de hoy (35, clave N/A)', () => {
    const respuesta = leerRespuestaRecepcion(
      sobreRecepcion(`<estado>DEVUELTA</estado><comprobantes><comprobante><claveAcceso>N/A</claveAcceso>${mensaje('35', 'ARCHIVO NO CUMPLE ESTRUCTURA XML', 'No se ha encontrado información en el tag claveAcceso.')}</comprobante></comprobantes>`),
    );
    const resultado = interpretarRecepcionLote(respuesta, ['clave-1', 'clave-2']);
    expect(resultado.tipo).toBe('NO_RECONOCIDO');
    if (resultado.tipo === 'NO_RECONOCIDO') expect(resultado.mensajes[0].identificador).toBe('35');
  });

  it('lote recibido completo (ejemplo de la ficha: RECIBIDA sin comprobantes)', () => {
    const respuesta = leerRespuestaRecepcion(sobreRecepcion('<estado>RECIBIDA</estado><comprobantes/>'));
    const resultado = interpretarRecepcionLote(respuesta, ['clave-1', 'clave-2']);
    expect(resultado).toMatchObject({ tipo: 'RECIBIDO', recibidos: ['clave-1', 'clave-2'], sinEvaluar: [] });
  });

  it('lote recibido parcial: solo el listado queda devuelto', () => {
    const respuesta = leerRespuestaRecepcion(
      sobreRecepcion(`<estado>RECIBIDA</estado><comprobantes><comprobante><claveAcceso>clave-2</claveAcceso>${mensaje('35', 'DOCUMENTO INVALIDO', 'totalSinImpuestos')}</comprobante></comprobantes>`),
    );
    const resultado = interpretarRecepcionLote(respuesta, ['clave-1', 'clave-2', 'clave-3']);
    expect(resultado.tipo).toBe('RECIBIDO');
    if (resultado.tipo !== 'NO_RECONOCIDO') {
      expect(resultado.recibidos).toEqual(['clave-1', 'clave-3']);
      expect([...resultado.devueltos.keys()]).toEqual(['clave-2']);
    }
  });

  it('devolucion total: los no listados no se dan por recibidos (error del Java)', () => {
    const respuesta = leerRespuestaRecepcion(
      sobreRecepcion(`<estado>DEVUELTA</estado><comprobantes><comprobante><claveAcceso>clave-1</claveAcceso>${mensaje('35', 'DOCUMENTO INVALIDO', 'x')}</comprobante></comprobantes>`),
    );
    const resultado = interpretarRecepcionLote(respuesta, ['clave-1', 'clave-2']);
    expect(resultado).toMatchObject({ tipo: 'DEVUELTO', recibidos: [], sinEvaluar: ['clave-2'] });
  });

  it('individual con error 43 (clave registrada) se trata como enviado', () => {
    const respuesta = leerRespuestaRecepcion(
      sobreRecepcion(`<estado>DEVUELTA</estado><comprobantes><comprobante><claveAcceso>clave-1</claveAcceso>${mensaje('43', 'CLAVE ACCESO REGISTRADA', '')}</comprobante></comprobantes>`),
    );
    expect(interpretarRecepcionIndividual(respuesta).tipo).toBe('ENVIADO');
  });
});
