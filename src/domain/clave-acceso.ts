import { Ambiente } from './modelo';

// Modulo 11 con pesos 2 a 7 desde la derecha (ficha tecnica, clave_helper.php).
// El Java calcula mal este digito para los lotes: multiplica el codigo del
// caracter ("0" = 48) en vez del numero.
export function digitoVerificador(digitos: string): string {
  const pesos = [2, 3, 4, 5, 6, 7];
  let suma = 0;
  for (let i = digitos.length - 1, p = 0; i >= 0; i--, p++) {
    suma += Number(digitos[i]) * pesos[p % 6];
  }
  const resultado = 11 - (suma % 11);
  return resultado === 11 ? '0' : resultado === 10 ? '1' : String(resultado);
}

export function esClaveValida(clave: string): boolean {
  return /^\d{49}$/.test(clave) && digitoVerificador(clave.slice(0, 48)) === clave[48];
}

// Clave del lote (ficha tecnica 2.26, tabla 9): fecha, tipo, RUC, ambiente,
// serie y secuencial propios del envio en lote, codigo numerico, tipo de
// emision y digito verificador. El tipo "00" es el del ejemplo de la ficha y
// el que usa hoy el Java.
export function claveDeLote(datos: {
  fecha: Date;
  ruc: string;
  ambiente: Ambiente;
  serie: string;
  secuencial: number;
}): string {
  const dos = (n: number) => String(n).padStart(2, '0');
  const fecha = `${dos(datos.fecha.getDate())}${dos(datos.fecha.getMonth() + 1)}${datos.fecha.getFullYear()}`;
  const secuencial = String(datos.secuencial).padStart(9, '0');
  const base = `${fecha}00${datos.ruc}${datos.ambiente}${datos.serie}${secuencial}${secuencial.slice(1)}1`;
  return base + digitoVerificador(base);
}
