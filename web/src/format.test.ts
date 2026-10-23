import { describe, expect, it } from 'vitest';
import { addMonth, ND, nf2, pf, q2 } from './format';
describe('formato', () => {
  it('muestra N/D (nunca 0) cuando el dato no existe', () => { expect(q2(null)).toBe(ND); expect(pf(null)).toBe(ND); expect(nf2(undefined)).toBe(ND); });
  it('0 real sí se muestra como 0', () => { expect(q2(0)).toBe('Q0.00'); expect(pf(0)).toBe('0.0%'); });
  it('negativos con signo menos', () => { expect(q2(-12.5)).toBe('−Q12.50'); });
  it('navega meses cruzando años', () => { expect(addMonth('2026-12', 1)).toBe('2027-01'); expect(addMonth('2026-01', -1)).toBe('2025-12'); });
});
