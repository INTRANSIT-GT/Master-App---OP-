import { pool } from '../db.js';
import { dn, iso, period, type Period } from '../engine/calendar.js';
import type { Engine, InvRow } from '../engine/compute.js';
import { bad } from '../http.js';
import { getEngine } from './engineCache.js';
import { tzToday } from './records.js';

export const parseMonth = (s: string) => { const m = /^(\d{4})-(\d{2})$/.exec(s ?? ''); if (!m || +m[2] < 1 || +m[2] > 12) throw Object.assign(new Error('Mes inválido (AAAA-MM)'), { status: 400 }); return +m[1] * 12 + (+m[2] - 1); };
export const monthStr = (k: number) => `${Math.floor(k / 12)}-${String((k % 12) + 1).padStart(2, '0')}`;

export function invOut(eng: Engine, p: Period) {
  const inv = eng.inventory(p.s, p.e); if (!inv) return null;
  const rows = Object.values(inv.X).map((x: InvRow) => ({
    id: x.it.id, name: x.it.name, kind: x.it.kind, ini: x.ini, ing: x.ing, con: x.con, mer: x.mer, fin: x.fin, conG: x.conG, unitCost: x.uc,
    costConsumed: (x.con + x.mer) * x.uc, finRolls: x.it.kind === 'lab' && x.it.unitsPerRoll ? x.fin / x.it.unitsPerRoll : x.it.kind === 'rib' ? x.fin : null,
    price: x.it.price, unitsPerRoll: x.it.unitsPerRoll,
  }));
  return { baseDate: iso(inv.bd), rows, materialCost: eng.materialCost(p) };
}

export async function periodRow(k: number) { return (await pool.query('SELECT * FROM periods WHERE month_key = $1', [k])).rows[0] ?? null; }

/** Periodo de una sola semana (lunes a domingo) dentro de un mes; sirve para filtrar Resumen, Dashboard e Inventario por semana. */
export function weekPeriod(k: number, ws: number[], monday: string): Period {
  const m = dn(monday);
  if (m == null || !ws.includes(m)) throw bad('La semana no pertenece al mes seleccionado.');
  return { k, ws: [m], s: m, e: m + 6, title: `Semana ${isoWeekNo(m)} · ${period(k).title}` };
}
const isoWeekNo = (n: number) => { const th = n - ((new Date(n * 864e5).getUTCDay() + 6) % 7) + 3, y = new Date(th * 864e5).getUTCFullYear(); return Math.floor((th - Date.UTC(y, 0, 1) / 864e5) / 7) + 1; };

export async function monthReport(k: number, week?: string) {
  const eng = await getEngine(), row = await periodRow(k);
  const p = week ? weekPeriod(k, period(k, eng.d.mw).ws, week) : period(k, eng.d.mw);
  if (!week && row?.status === 'cerrado' && row.snapshot) return { ...row.snapshot, frozen: true, closedAt: row.closed_at };
  const results = eng.results(p), resumen = eng.resumen(p, results);
  return { month: monthStr(k), week: week ?? null, status: row?.status ?? 'abierto', frozen: row?.status === 'cerrado' && !!week, results, resumen, inventory: invOut(eng, p), stock: eng.stock(dn(tzToday())!) };
}

export async function dashboard(k: number, week?: string) {
  const rep: any = await monthReport(k, week), eng = await getEngine(), p = week ? weekPeriod(k, period(k, eng.d.mw).ws, week) : period(k, eng.d.mw);
  const { results: R, resumen: S } = rep, M: any = week ? await monthReport(k) : rep;
  const s = iso(p.s), e = iso(p.e);
  const [drafts, recent, byStatus] = await Promise.all([
    pool.query(`SELECT (SELECT count(*) FROM production_records WHERE status='borrador' AND record_date BETWEEN $1 AND $2) + (SELECT count(*) FROM hours_records WHERE status='borrador' AND record_date BETWEEN $1 AND $2) AS n`, [s, e]),
    pool.query(`SELECT at, user_email, entity, action FROM audit_log ORDER BY id DESC LIMIT 8`),
    pool.query(`SELECT (SELECT count(*) FROM production_records WHERE record_date BETWEEN $1 AND $2 AND status='confirmado') prod, (SELECT count(*) FROM hours_records WHERE record_date BETWEEN $1 AND $2 AND status='confirmado') hrs`, [s, e]),
  ]);
  const stock = (rep.stock ?? []) as any[];
  const pend: string[] = [];
  const incomplete = R.lines.filter((l: any) => l.incomplete?.length);
  if (R.unknownSaps.length) pend.push(`${R.unknownSaps.length} SAP en producción sin catálogo`);
  if (incomplete.length) pend.push(`${incomplete.length} procesos con TT, cajas por tarima o costo sin definir`);
  if (+drafts.rows[0].n) pend.push(`${drafts.rows[0].n} borradores sin confirmar`);
  R.wHH.forEach((v: number, i: number) => { if (v > 0 && !R.wAsis[i]) pend.push(`Semana ${R.period.weeks[i].week} sin asistencia capturada (eficiencia N/D)`); });
  return {
    month: monthStr(k), week: week ?? null, title: R.period.title, status: rep.status, frozen: rep.frozen,
    kpi: { hh: R.HH, asistencia: R.ASIS, eficiencia: R.eff.month, costo: S.T.cost, costoNeto: S.T.net, margen: S.T.mg, requerimientos: S.T.req + S.T.gen, materiales: S.T.mat },
    weekly: M.results.period.weeks.map((w: any, i: number) => ({ week: w.week, monday: w.monday, hh: M.results.wHH[i], asistencia: M.results.wAsis[i] || null, eficiencia: M.results.eff.weeks[i] })),
    sections: S.list.map((o: any) => ({ g: o.g, name: o.name, cost: o.cost, net: o.net, hh: o.hh, mg: o.mg })),
    stockAlerts: stock.filter((x) => x.level !== 'ok'), stockTotal: stock.length,
    pendientes: pend, counts: { produccion: +byStatus.rows[0].prod, horas: +byStatus.rows[0].hrs, borradores: +drafts.rows[0].n },
    recent: recent.rows,
  };
}
