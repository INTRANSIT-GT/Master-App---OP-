import { Router } from 'express';
import { z } from 'zod';
import { need } from '../auth.js';
import { MODULE_ID, MODULE_NAME, config } from '../config.js';
import { pool } from '../db.js';
import { MES, dn, iso, monthKey, period } from '../engine/calendar.js';
import { AREAS, RES_NAME } from '../engine/types.js';
import { HttpError, bad, parse } from '../http.js';
import { ROLE_PERMS } from '../permissions.js';
import { getEngine } from '../services/engineCache.js';
import { excelReport, pdfReport } from '../services/exporter.js';
import { closePeriod, listPeriods, precheck, reopenPeriod, setWeeks } from '../services/periods.js';
import { tzToday } from '../services/records.js';
import { dashboard, monthReport, monthStr, parseMonth } from '../services/reports.js';
import { getSettings } from '../services/store.js';

export const reportsRouter = Router();
const semana = (req: any) => { const w = req.query.semana; return typeof w === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(w) ? w : undefined; };
const mes = (req: any) => { try { return parseMonth(String(req.query.mes ?? req.params.mes ?? '')); } catch { throw bad('Indica el mes como AAAA-MM.'); } };

async function defaultMonth() {
  const eng = await getEngine(), t = dn(tzToday())!; let k = monthKey(t);
  const ws = eng.d && period(k, eng.d.mw).ws;
  if (ws.length && t < ws[0]) k--; else if (ws.length && t > ws[ws.length - 1] + 6) k++;
  const ini = monthKey(dn(eng.d.settings.inicio)! + 3);
  return Math.max(k, ini);
}

reportsRouter.get('/meta', need('ver'), async (req, res) => {
  const s = await getSettings(pool), eng = await getEngine();
  res.json({
    user: { ...req.user, permissions: ROLE_PERMS[req.user!.role] }, demo: s.demo === true, sede: s.sede ?? 'Omnia', inicio: s.inicio, wmDiv: s.wmDiv,
    defaultMonth: monthStr(await defaultMonth()), today: tzToday(), areas: AREAS, summaryNames: RES_NAME,
    lines: eng.d.lines, meses: MES, inventoryBaseDate: eng.d.base.date,
    module: { id: MODULE_ID, name: MODULE_NAME, basePath: config.basePath }, authMode: config.authMode, portalUrl: config.portalUrl,
  });
});
reportsRouter.get('/resultados', need('ver'), async (req, res) => { const r: any = await monthReport(mes(req)); res.json({ month: r.month, status: r.status, frozen: r.frozen, results: r.results }); });
reportsRouter.get('/resumen', need('ver'), async (req, res) => { const r: any = await monthReport(mes(req), semana(req)); const m: any = r.week ? await monthReport(mes(req)) : r; res.json({ month: r.month, week: r.week ?? null, status: r.status, frozen: r.frozen, period: r.results.period, resumen: r.resumen, weeks: m.results.period.weeks, weekly: { HH: r.results.HH, asis: r.results.ASIS, eff: r.results.eff.month } }); });
reportsRouter.get('/inventario', need('ver'), async (req, res) => { const r: any = await monthReport(mes(req), semana(req)); res.json({ month: r.month, status: r.status, frozen: r.frozen, inventory: r.inventory, stock: r.stock ?? (await getEngine()).stock(dn(tzToday())!) }); });
reportsRouter.get('/dashboard', need('ver'), async (req, res) => res.json(await dashboard(mes(req), semana(req))));

reportsRouter.get('/periodos', need('ver'), async (_req, res) => res.json(await listPeriods()));
reportsRouter.get('/periodos/:mes/precierre', need('periodo.cerrar'), async (req, res) => { const p = await precheck(mes(req)); res.json({ period: p.period, blockers: p.blockers, warnings: p.warnings, summary: p.summary }); });
reportsRouter.post('/periodos/:mes/cerrar', need('periodo.cerrar'), async (req, res) => {
  const b = parse(z.object({ acknowledgeWarnings: z.boolean().optional(), notes: z.string().max(500).optional() }), req.body ?? {});
  res.json(await closePeriod(req.user!, mes(req), b));
});
reportsRouter.post('/periodos/:mes/reabrir', need('periodo.reabrir'), async (req, res) => res.json(await reopenPeriod(req.user!, mes(req), String(req.body?.reason ?? ''))));
reportsRouter.put('/periodos/:mes/semanas', need('periodo.semanas'), async (req, res) => {
  const b = parse(z.object({ from: z.coerce.number().int(), to: z.coerce.number().int() }), req.body);
  await setWeeks(req.user!, mes(req), b.from, b.to); res.json({ ok: true });
});

reportsRouter.get('/auditoria', need('auditoria.ver'), async (req, res) => {
  const f = parse(z.object({ entity: z.string().optional(), entityId: z.string().optional(), user: z.string().optional(), limit: z.coerce.number().int().max(500).optional() }), req.query);
  const r = await pool.query(`SELECT id, at, user_email AS "userEmail", entity, entity_id AS "entityId", action, reason, before, after FROM audit_log
    WHERE ($1::text IS NULL OR entity = $1) AND ($2::text IS NULL OR entity_id = $2) AND ($3::text IS NULL OR user_email = $3) ORDER BY id DESC LIMIT $4`, [f.entity ?? null, f.entityId ?? null, f.user ?? null, f.limit ?? 100]);
  res.json(r.rows);
});

reportsRouter.get('/exportar/excel', need('exportar'), async (req, res) => {
  const k = mes(req), buf = await excelReport(k);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="InTransit_Operaciones_${monthStr(k)}.xlsx"`); res.send(buf);
});
reportsRouter.get('/exportar/pdf', need('exportar'), async (req, res) => {
  const k = mes(req), buf = await pdfReport(k);
  res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Content-Disposition', `attachment; filename="InTransit_Operaciones_${monthStr(k)}.pdf"`); res.send(buf);
});
void HttpError; void iso;
