// Calendario de negocio. Todo trabaja en "días desde 1970-01-01" (UTC) para evitar problemas de zona horaria.
// Port de helpers del HTML original: isoWeek, monthWeeks, weeksFor, period.
export const DAY = 864e5;
export const MES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];

export const toD = (n: number) => new Date(n * DAY);
export const iso = (n: number) => toD(n).toISOString().slice(0, 10);
export function dn(s: string | null | undefined): number | null {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) / DAY : null;
}
export const wdOf = (n: number) => (toD(n).getUTCDay() + 6) % 7; // 0 = lunes
export function isoWeek(n: number) {
  const th = n - wdOf(n) + 3;
  const y = toD(th).getUTCFullYear();
  return { y, w: Math.floor((th - Date.UTC(y, 0, 1) / DAY) / 7) + 1 };
}
export const wk = (n: number) => isoWeek(n).w;
export const mondayOf = (n: number) => n - wdOf(n);
export const monthKey = (n: number) => { const d = toD(n); return d.getUTCFullYear() * 12 + d.getUTCMonth(); };
export const monthStart = (k: number) => Date.UTC(Math.floor(k / 12), k % 12, 1) / DAY;
export const monthEnd = (k: number) => Date.UTC(Math.floor(k / 12), (k % 12) + 1, 0) / DAY;
export const monthKeyOf = (year: number, month1: number) => year * 12 + (month1 - 1);

/** Una semana pertenece al mes de su jueves. */
export function monthWeeks(k: number): number[] {
  let m = mondayOf(monthStart(k));
  if (m + 3 < monthStart(k)) m += 7;
  const ws: number[] = [];
  while (m + 3 <= monthEnd(k)) { ws.push(m); m += 7; }
  return ws;
}
export const weekStart = (y: number, w: number) => mondayOf(Date.UTC(y, 0, 4) / DAY) + (w - 1) * 7;

export type MonthWeeksOverride = Record<string, [number, number]>;
export function weeksFor(k: number, mw: MonthWeeksOverride = {}): number[] {
  const o = mw[String(k)];
  if (o && +o[0] > 0 && +o[1] >= +o[0]) {
    const y = Math.floor(k / 12), ws: number[] = [];
    for (let w = +o[0]; w <= +o[1]; w++) ws.push(weekStart(y, w));
    return ws;
  }
  return monthWeeks(k);
}
export interface Period { k: number; ws: number[]; s: number; e: number; title: string }
export function period(k: number, mw: MonthWeeksOverride = {}): Period {
  const ws = weeksFor(k, mw);
  return { k, ws, s: ws[0], e: ws[ws.length - 1] + 6, title: MES[k % 12] + ' ' + Math.floor(k / 12) };
}
