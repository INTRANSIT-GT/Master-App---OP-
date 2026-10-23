export const ND = 'N/D';
const L = 'es-GT';
export const nf = (v: number | null | undefined) => (v == null ? ND : Math.round(v).toLocaleString(L));
export const nf1 = (v: number | null | undefined) => (v == null ? ND : v.toLocaleString(L, { minimumFractionDigits: 1, maximumFractionDigits: 1 }));
export const nf2 = (v: number | null | undefined) => (v == null ? ND : v.toLocaleString(L, { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
export const nfx = (v: number | null | undefined) => (v == null ? ND : v.toLocaleString(L, { maximumFractionDigits: 2 }));
/** Dinero: negativo con signo menos; nunca imprime 0 cuando el dato no existe (null → N/D). */
export const q2 = (v: number | null | undefined) => (v == null ? ND : (v < 0 ? '−Q' : 'Q') + Math.abs(v).toLocaleString(L, { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
export const pf = (v: number | null | undefined) => (v == null || !isFinite(v) ? ND : (v * 100).toLocaleString(L, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%');
export const fmtDate = (s: string | null | undefined) => (s ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : '');
export const fmtDT = (s: string) => new Date(s).toLocaleString(L, { dateStyle: 'short', timeStyle: 'short' });
export const MES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
export const monthLabel = (m: string) => `${MES[+m.slice(5, 7) - 1]} ${m.slice(0, 4)}`;
export const addMonth = (m: string, d: number) => { const k = +m.slice(0, 4) * 12 + (+m.slice(5, 7) - 1) + d; return `${Math.floor(k / 12)}-${String((k % 12) + 1).padStart(2, '0')}`; };
