import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { leerRespuestaRecepcion } from '../src/domain/respuestas-sri';
import { interpretarRecepcionLote } from '../src/domain/interpretacion';

// Respuesta real del SRI de PRODUCCION (17/09/2026) a un lote de 17 facturas
// de Roots y Routes que ya estaban autorizadas.
const respuestaReal = readFileSync(join(__dirname, 'respuestas-sri/recepcion-lote-produccion-43.xml'), 'utf8');

describe('lote en produccion (respuesta real del SRI)', () => {
  const respuesta = leerRespuestaRecepcion(respuestaReal);
  const claves = respuesta.comprobantes.map((c) => c.claveAcceso);

  it('produccion abre el lote y responde por cada factura', () => {
    expect(respuesta.estado).toBe('DEVUELTA');
    expect(respuesta.comprobantes).toHaveLength(17);
    expect(respuesta.comprobantes.every((c) => c.mensajes[0].identificador === '43')).toBe(true);
  });

  it('clave ya registrada (43) no es rechazo: quedan para consultar su autorizacion', () => {
    const resultado = interpretarRecepcionLote(respuesta, claves);
    expect(resultado.tipo).not.toBe('NO_RECONOCIDO');
    if (resultado.tipo !== 'NO_RECONOCIDO') {
      expect(resultado.recibidos).toHaveLength(17);
      expect(resultado.devueltos.size).toBe(0);
      expect(resultado.sinEvaluar).toHaveLength(0);
    }
  });
});
