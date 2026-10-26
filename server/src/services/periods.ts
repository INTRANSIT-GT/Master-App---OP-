import { pool, tx } from '../db.js';
import type { AuthUser } from '../auth.js';
import { MES, dn, iso, monthKey, period, weeksFor, wk } from '../engine/calendar.js';
import { HttpError, bad, conflict } from '../http.js';
import { audit } from './audit.js';
import { getEngine } from './engineCache.js';
import { invOut, monthStr, periodRow, weekPeriod } from './reports.js';
import { getSettings } from './store.js';
import { tzToday } from './records.js';

export async function listPeriods() {
  const eng = await getEngine(), s = await getSettings(pool);
  const first = monthKey(dn(s.inicio)! + 3), last = monthKey(dn(tzToday())!) + 1, rows = (await pool.query('SELECT * FROM periods')).rows;
  const out = [];
  for (let k = first; k <= last; k++) {
    const p = period(k, eng.d.mw), r = rows.find((x) => x.month_key === k);
    out.push({ month: monthStr(k), key: k, title: p.title, weeks: p.ws.map((m) => ({ monday: iso(m), week: wk(m) })), start: iso(p.s), end: iso(p.e), weekFrom: wk(p.s), weekTo: wk(p.e), status: r?.status ?? 'abierto', closedAt: r?.closed_at ?? null, override: !!r?.week_from });
  }
  return out;
}

export async function setWeeks(user: AuthUser, k: number, from: number, to: number) {
  if (!(from >= 1 && to >= from && to <= 53)) throw bad('Semanas inválidas.');
  return tx(async (c) => {
    const cur = (await c.query('SELECT * FROM periods WHERE month_key = $1 FOR UPDATE', [k])).rows[0];
    if (cur?.status === 'cerrado') throw conflict('PERIODO_CERRADO', 'El periodo está cerrado; reábrelo para cambiar sus semanas.');
    const ws = weeksFor(k, { [String(k)]: [from, to] }), start = iso(ws[0]), end = iso(ws[ws.length - 1] + 6);
    const over = await c.query(`SELECT month_key FROM periods WHERE status = 'cerrado' AND month_key <> $1 AND daterange(start_date, end_date, '[]') && daterange($2::date, $3::date, '[]')`, [k, start, end]);
    if (over.rowCount) throw conflict('TRASLAPE', 'Esas semanas se traslapan con un periodo cerrado.');
    const r = await c.query(`INSERT INTO periods (month_key, year, month, week_from, week_to, start_date, end_date) VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (month_key) DO UPDATE SET week_from = $4, week_to = $5, start_date = $6, end_date = $7 RETURNING *`, [k, Math.floor(k / 12), (k % 12) + 1, from, to, start, end]);
    await audit(c, user, 'periodo', monthStr(k), 'semanas', cur ? { weekFrom: cur.week_from, weekTo: cur.week_to } : null, { weekFrom: from, weekTo: to });
    return r.rows[0];
  });
}

export async function precheck(k: number) {
  const eng = await getEngine(), p = period(k, eng.d.mw), R = eng.results(p), S = eng.resumen(p, R), s = iso(p.s), e = iso(p.e);
  const blockers: string[] = [], warnings: string[] = [];
  const d = (await pool.query(`SELECT (SELECT count(*) FROM production_records WHERE status='borrador' AND record_date BETWEEN $1 AND $2) a, (SELECT count(*) FROM hours_records WHERE status='borrador' AND record_date BETWEEN $1 AND $2) b,
                                      (SELECT count(*) FROM requirements WHERE status='borrador' AND request_date BETWEEN $1 AND $2) c`, [s, e])).rows[0];
  const nd = +d.a + +d.b + +d.c;
  if (nd) blockers.push(`Hay ${nd} borradores en el periodo; confírmalos o anúlalos.`);
  if (!R.lines.length) blockers.push('El periodo no tiene producción ni horas.');
  for (const u of R.unknownSaps) warnings.push(`SAP ${u.sap} sin catálogo (no suma HH): ${u.name}`);
  for (const l of R.lines) if (l.incomplete.length) warnings.push(`${l.name}: ${l.incomplete.join(', ')}`);
  R.wHH.forEach((v, i) => { if (v > 0 && !R.wAsis[i]) warnings.push(`Semana ${R.period.weeks[i].week} sin asistencia: la eficiencia queda N/D`); });
  const inv = invOut(eng, p);
  for (const r of inv?.rows ?? []) if (r.fin < 0) warnings.push(`Inventario negativo en ${r.name} (${Math.round(r.fin)})`);
  if (!inv) warnings.push('No hay conteo físico de inventario base.');
  return { period: monthStr(k), blockers, warnings, summary: { hh: R.HH, costoNeto: S.T.net }, results: R, resumen: S, inventory: inv };
}

export async function closePeriod(user: AuthUser, k: number, opts: { acknowledgeWarnings?: boolean; notes?: string }) {
  const pc = await precheck(k);
  if (pc.blockers.length) throw conflict('CIERRE_BLOQUEADO', 'No se puede cerrar: ' + pc.blockers.join(' '), pc.blockers);
  if (pc.warnings.length && !opts.acknowledgeWarnings) throw conflict('CIERRE_CON_ADVERTENCIAS', 'Hay advertencias pendientes; confirma que las revisaste para cerrar.', pc.warnings);
  const eng = await getEngine(), p = period(k, eng.d.mw);
  return tx(async (c) => {
    const cur = (await c.query('SELECT * FROM periods WHERE month_key = $1 FOR UPDATE', [k])).rows[0];
    if (cur?.status === 'cerrado') throw conflict('PERIODO_CERRADO', 'El periodo ya está cerrado.');
    const over = await c.query(`SELECT month_key FROM periods WHERE month_key <> $1 AND status='cerrado' AND daterange(start_date, end_date, '[]') && daterange($2::date, $3::date, '[]')`, [k, iso(p.s), iso(p.e)]);
    if (over.rowCount) throw conflict('TRASLAPE', 'El periodo se traslapa con otro ya cerrado.');
    // cada semana también se congela: sin esto, un cambio de precio de material movería el filtro semanal de un periodo cerrado
    const weeks: Record<string, unknown> = {};
    for (const m of p.ws) { const wp = weekPeriod(k, p.ws, iso(m)), wr = eng.results(wp); weeks[iso(m)] = { results: wr, resumen: eng.resumen(wp, wr), inventory: invOut(eng, wp) }; }
    const snapshot = { month: monthStr(k), status: 'cerrado', results: pc.results, resumen: pc.resumen, inventory: pc.inventory, weeks, stock: null, frozenAt: new Date().toISOString() };
    const r = await c.query(`INSERT INTO periods (month_key, year, month, week_from, week_to, start_date, end_date, status, closed_by, closed_at, close_notes, snapshot, warnings)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'cerrado',$8,now(),$9,$10,$11)
       ON CONFLICT (month_key) DO UPDATE SET status='cerrado', closed_by=$8, closed_at=now(), close_notes=$9, snapshot=$10, warnings=$11, start_date=$6, end_date=$7 RETURNING *`,
      [k, Math.floor(k / 12), (k % 12) + 1, cur?.week_from ?? null, cur?.week_to ?? null, iso(p.s), iso(p.e), user.id, opts.notes ?? null, JSON.stringify(snapshot), JSON.stringify(pc.warnings)]);
    await audit(c, user, 'periodo', monthStr(k), 'cerrar', { status: cur?.status ?? 'abierto' }, { status: 'cerrado', warnings: pc.warnings.length, hh: pc.summary.hh, costoNeto: pc.summary.costoNeto }, opts.notes);
    return { month: monthStr(k), status: 'cerrado', closedAt: r.rows[0].closed_at, warnings: pc.warnings };
  });
}

export async function reopenPeriod(user: AuthUser, k: number, reason: string) {
  if (!reason || reason.trim().length < 5) throw bad('Reabrir un periodo requiere justificación (mínimo 5 caracteres).');
  return tx(async (c) => {
    const cur = (await c.query('SELECT * FROM periods WHERE month_key = $1 FOR UPDATE', [k])).rows[0];
    if (!cur || cur.status !== 'cerrado') throw new HttpError(409, 'ESTADO', 'El periodo no está cerrado.');
    await c.query(`UPDATE periods SET status='abierto', closed_by=NULL, closed_at=NULL, snapshot=NULL WHERE month_key=$1`, [k]);
    await audit(c, user, 'periodo', monthStr(k), 'reabrir', { status: 'cerrado', closedAt: cur.closed_at }, { status: 'abierto' }, reason.trim());
    return { month: monthStr(k), status: 'abierto' };
  });
}
export { MES, periodRow };
