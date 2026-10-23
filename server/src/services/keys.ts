import { createHash } from 'node:crypto';

const norm = (v: unknown) => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
/** Huella natural de un registro de origen. Mismos campos → misma llave → no se duplica al reimportar. */
export function naturalKey(parts: unknown[]): string {
  return createHash('sha1').update(parts.map((p) => (typeof p === 'number' ? String(Math.round(p * 1e6) / 1e6) : norm(p))).join('|')).digest('hex');
}
/** Repeticiones idénticas dentro de un mismo archivo reciben sufijo #n (dos filas iguales son dos registros legítimos). */
export class KeyCounter {
  private seen = new Map<string, number>();
  next(parts: unknown[]): string {
    const base = naturalKey(parts), n = (this.seen.get(base) ?? 0) + 1;
    this.seen.set(base, n);
    return base + '#' + n;
  }
}
export const sha256 = (buf: Buffer | string) => createHash('sha256').update(buf).digest('hex');
