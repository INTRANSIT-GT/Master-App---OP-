// Módulo comercial: reporte de cobro a clientes (semanal o mensual) y tarifas por proyecto.
// Fritolay se cobra con la tarifa unitaria del motor (Costo Q); los demás clientes con «cantidad × tarifa de cobro vigente» por proyecto.
import ExcelJS from 'exceljs';
import { pool, tx } from '../db.js';
import type { AuthUser } from '../auth.js';
import { dn, iso, mondayOf, period, type Period } from '../engine/calendar.js';
import { bad, conflict, notFound } from '../http.js';
import { audit } from './audit.js';
import { getEngine } from './engineCache.js';
import { parseMonth, weekPeriod } from './reports.js';

const r2 = (x: number) => Math.round(x * 100) / 100;
// qué proyecto de Fritolay cobra cada línea del motor
const LINE_PROJECT: Record<string, string> = { wm: 'WM', cob: 'COB', sun: 'SUN', revS: 'SUN', etq: 'ETQ', noc: 'ETQ', qua: 'ETQ', revE: 'ETQ', crk: 'CRK', crkR: 'CRK', dFLUS: 'DESC', dGAL: 'DESC', dSAL: 'DESC', dQUA: 'DESC', uniR: 'UNI', revm: 'REVM', dc: 'DC' };

export interface CobroRow { client: string; clientId: string; project: string; projectId: string | null; detail: string | null; unit: string; qty: number; billableQty: number; rate: number | null; amount: number | null; issues: string[] }

export function resolvePeriod(eng: Awaited<ReturnType<typeof getEngine>>, q: { semana?: string; mes?: string }): { p: Period; label: string; tipo: 'semana' | 'mes' } {
  if (q.semana) {
    const m = dn(q.semana); if (m == null) throw bad('Semana inválida.');
    const mon = mondayOf(m), k = monthKeyOfMonday(mon);
    return { p: weekPeriod(k, [mon], iso(mon)), label: `Semana del ${iso(mon)} al ${iso(mon + 6)}`, tipo: 'semana' };
  }
  const k = parseMonth(q.mes ?? ''), p = period(k, eng.d.mw);
  return { p, label: p.title, tipo: 'mes' };
}
const monthKeyOfMonday = (mon: number) => { const d = new Date((mon + 3) * 864e5); return d.getUTCFullYear() * 12 + d.getUTCMonth(); };   // el mes de la semana es el de su jueves

export async function cobro(q: { semana?: string; mes?: string; clientId?: string }, sede: string) {
  const eng = await getEngine(sede), { p, label, tipo } = resolvePeriod(eng, q), s = iso(p.s), e = iso(p.e);
  const clients = (await pool.query('SELECT id, code, name FROM clients WHERE active ORDER BY sort')).rows;
  const projects = (await pool.query('SELECT id, client_id, code, name, um, kinds FROM projects WHERE active ORDER BY sort')).rows;
  const rows: CobroRow[] = [];
  // Fritolay: motor
  const fl = clients.find((c) => c.code === 'FRITOLAY');
  if (fl) {
    const R = eng.results(p);
    for (const l of R.lines) {
      if (['man', 'hrs', 'none'].includes(l.mode) && !l.rate) continue;
      const pc = l.k.startsWith('m:') ? 'MAQ' : LINE_PROJECT[l.k]; if (!pc) continue;
      const pr = projects.find((x) => x.client_id === fl.id && x.code === pc); if (!pr) continue;
      const issues = l.incomplete.filter((t) => t.startsWith('Sin costo'));
      const bill = l.b, hasRate = l.rate != null || l.cost > 0;
      rows.push({ client: fl.name, clientId: fl.id, project: pr.name, projectId: pr.id, detail: l.name, unit: l.billableLabel ? 'cajas de cobro' : l.um.toLowerCase(), qty: l.q, billableQty: bill,
        rate: bill > 0 && l.cost > 0 ? l.cost / bill : l.rate, amount: hasRate ? r2(l.cost) : null, issues: hasRate ? [] : issues.length ? issues : ['Sin tarifa vigente'] });
    }
  }
  // otros clientes: registros genéricos × tarifa vigente por día
  const g = (await pool.query(`SELECT pr.id AS project_id, pr.client_id, sum(r.boxes) AS qty, count(*)::int AS n,
        sum(CASE WHEN br.rate IS NOT NULL THEN r.boxes * br.rate END) AS amount, count(*) FILTER (WHERE br.rate IS NULL)::int AS sin_tarifa, max(br.unit) AS unit
      FROM production_records r JOIN projects pr ON pr.id = r.project_id
      LEFT JOIN billing_rates br ON br.project_id = pr.id AND r.record_date BETWEEN br.valid_from AND coalesce(br.valid_to, 'infinity'::date)
      WHERE r.sede_id = $3 AND r.kind = 'gen' AND r.status = 'confirmado' AND r.record_date BETWEEN $1 AND $2 GROUP BY pr.id, pr.client_id`, [s, e, sede])).rows;
  for (const x of g) {
    const pr = projects.find((y) => y.id === x.project_id), cl = clients.find((y) => y.id === x.client_id); if (!pr || !cl) continue;
    rows.push({ client: cl.name, clientId: cl.id, project: pr.name, projectId: pr.id, detail: `${x.n} registro(s)`, unit: (x.unit ?? pr.um).toLowerCase(), qty: x.qty, billableQty: x.qty,
      rate: x.amount != null && x.qty > 0 ? x.amount / x.qty : null, amount: x.amount != null ? r2(x.amount) : null, issues: x.sin_tarifa ? [`${x.sin_tarifa} registro(s) sin tarifa vigente`] : [] });
  }
  const out = q.clientId ? rows.filter((r) => r.clientId === q.clientId) : rows;
  const byClient = clients.map((c) => {
    const rs = out.filter((r) => r.clientId === c.id);
    return { id: c.id, name: c.name, rows: rs, total: r2(rs.reduce((a, r) => a + (r.amount ?? 0), 0)), pendientes: rs.filter((r) => r.issues.length).length };
  }).filter((c) => c.rows.length);
  return { tipo, label, desde: s, hasta: e, clients: byClient, total: r2(byClient.reduce((a, c) => a + c.total, 0)), pendientes: byClient.reduce((a, c) => a + c.pendientes, 0),
    nota: 'Importes en quetzales. Las filas con «sin tarifa» no suman al total hasta definir la tarifa. Resumen y cobro usan los mismos registros confirmados.' };
}

export async function excelCobro(q: Parameters<typeof cobro>[0], sede: string): Promise<{ buf: Buffer; name: string }> {
  const d = await cobro(q, sede), wb = new ExcelJS.Workbook(); wb.creator = 'In Transit Operaciones';
  const settings = (await pool.query(`SELECT value FROM settings WHERE key = 'demo'`)).rows[0]?.value === true;
  const hdr = (r: ExcelJS.Row) => { r.font = { bold: true, color: { argb: 'FFFFFFFF' } }; r.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1D2A3A' } }; };
  const ws = wb.addWorksheet('COBRO');
  ws.addRow([`REPORTE DE COBRO · ${d.label.toUpperCase()}`]).font = { bold: true, size: 13 };
  if (settings) ws.addRow(['DATOS DE DEMOSTRACIÓN: no usar para facturar']).font = { bold: true, color: { argb: 'FFC23B22' } };
  const sedeName = (await pool.query('SELECT name FROM sedes WHERE id = $1', [sede])).rows[0]?.name ?? sede;
  ws.addRow([`${sedeName} · del ${d.desde} al ${d.hasta}`]); ws.addRow([]);
  for (const c of d.clients) {
    ws.addRow([c.name]).font = { bold: true, size: 12 };
    const h = ws.addRow(['Proyecto', 'Detalle', 'Unidad', 'Cantidad', 'Cantidad cobrable', 'Tarifa Q', 'Importe Q', 'Observación']); hdr(h);
    for (const r of c.rows) ws.addRow([r.project, r.detail, r.unit, r2(r.qty), r2(r.billableQty), r.rate == null ? 'N/D' : r2(r.rate * 10000) / 10000, r.amount == null ? 'N/D' : r.amount, r.issues.join('; ')]);
    const t = ws.addRow(['', '', '', '', '', `Total ${c.name}`, c.total]); t.font = { bold: true }; ws.addRow([]);
  }
  ws.addRow(['', '', '', '', '', 'TOTAL GENERAL', d.total]).font = { bold: true };
  ws.addRow([]); ws.addRow([d.nota]).font = { italic: true, size: 9 };
  [26, 36, 16, 14, 18, 14, 16, 40].forEach((w, i) => (ws.getColumn(i + 1).width = w));
  ws.getColumn(7).numFmt = '#,##0.00'; ws.getColumn(4).numFmt = '#,##0.##'; ws.getColumn(5).numFmt = '#,##0.##';
  return { buf: Buffer.from(await wb.xlsx.writeBuffer()), name: `Cobro_${sede}_${d.tipo === 'semana' ? d.desde : d.desde.slice(0, 7)}.xlsx` };
}

export async function listRates(sede: string) {
  const eng = await getEngine(sede);
  const proj = (await pool.query(`SELECT p.id, p.code, p.name, p.um, p.kinds, c.id AS client_id, c.name AS client FROM projects p JOIN clients c ON c.id = p.client_id WHERE p.active ORDER BY c.sort, p.sort`)).rows;
  const rates = (await pool.query('SELECT id, project_id AS "projectId", rate, unit, valid_from AS "validFrom", valid_to AS "validTo", note FROM billing_rates ORDER BY valid_from DESC')).rows;
  const lines = eng.d.lines.filter((l) => LINE_PROJECT[l.key]).map((l) => ({ key: l.key, name: l.name, project: LINE_PROJECT[l.key], rate: eng.rateOf(l.key, iso(dn(new Date().toISOString().slice(0, 10))!)) }));
  return { projects: proj.map((p) => ({ id: p.id, code: p.code, name: p.name, um: p.um, clientId: p.client_id, client: p.client, motor: p.kinds[0] !== 'gen' })), rates, motor: lines,
    nota: 'Las tarifas de Fritolay vienen del catálogo de estándares (Ajustes); aquí se administran las tarifas de los demás clientes.' };
}

export async function addRate(user: AuthUser, b: { projectId: string; rate: number; unit: string; validFrom: string; note?: string }) {
  return tx(async (c) => {
    const p = (await c.query('SELECT id, kinds FROM projects WHERE id = $1', [b.projectId])).rows[0]; if (!p) throw notFound('Proyecto');
    if (p.kinds[0] !== 'gen') throw bad('Las tarifas de Fritolay se administran en Ajustes → estándares (alimentan el motor de cálculo).');
    const prev = (await c.query(`SELECT * FROM billing_rates WHERE project_id = $1 AND valid_from < $2 AND (valid_to IS NULL OR valid_to >= $2) ORDER BY valid_from DESC LIMIT 1 FOR UPDATE`, [b.projectId, b.validFrom])).rows[0];
    if (prev) await c.query(`UPDATE billing_rates SET valid_to = ($1::date - 1) WHERE id = $2`, [b.validFrom, prev.id]);
    const dup = await c.query('SELECT 1 FROM billing_rates WHERE project_id = $1 AND valid_from >= $2', [b.projectId, b.validFrom]);
    if (dup.rowCount) throw conflict('VIGENCIA_TRASLAPADA', 'Ya hay una tarifa que empieza en esa fecha o después; elige una fecha posterior a la última vigencia.');
    const r = await c.query(`INSERT INTO billing_rates (project_id, rate, unit, valid_from, note, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, project_id AS "projectId", rate, unit, valid_from AS "validFrom", valid_to AS "validTo", note`, [b.projectId, b.rate, b.unit.toUpperCase(), b.validFrom, b.note ?? null, user.id]);
    await audit(c, user, 'tarifa_cobro', r.rows[0].id, 'crear', prev ?? null, r.rows[0], b.note);
    return r.rows[0];
  });
}
