// Acceso a datos para el motor y escritura masiva de registros (siembra e importación).
import type { Q } from '../db.js';
import type { EngineData, EngineSettings } from '../engine/types.js';
import type { HoursRow, ProdRow } from '../seed/bundle.js';

const iso = (v: unknown) => (typeof v === 'string' ? v.slice(0, 10) : new Date(v as Date).toISOString().slice(0, 10));

export async function getSettings(q: Q): Promise<Record<string, any>> {
  const r = await q.query('SELECT key, value FROM settings');
  return Object.fromEntries(r.rows.map((x) => [x.key, x.value]));
}

export async function loadEngineData(q: Q): Promise<EngineData> {
  const [lines, products, standards, items, bag, counts, settings, prod, hours, att, reqs, scrap, periods, supply] = await Promise.all([
    q.query('SELECT * FROM process_lines ORDER BY sort'),
    q.query('SELECT * FROM products WHERE active ORDER BY sort, sap'),
    q.query('SELECT * FROM standards ORDER BY valid_from'),
    q.query('SELECT * FROM inv_items ORDER BY sort, id'),
    q.query('SELECT * FROM bag_usage'),
    q.query('SELECT DISTINCT ON (item_id) item_id, count_date, qty FROM inventory_counts ORDER BY item_id, count_date DESC'),
    getSettings(q),
    q.query(`SELECT kind, record_date, sap, product_name, boxes, units, units_per_box, billable_boxes, labels_used, label_id, review_units, bad_boxes, container_type
             FROM production_records WHERE status = 'confirmado' AND kind <> 'gen'`),
    q.query(`SELECT kind, record_date, hours_day, hours_night FROM hours_records WHERE status = 'confirmado' AND kind = 'imp'`),
    q.query('SELECT week_monday, paid_hours FROM attendance'),
    q.query(`SELECT request_date, area, amount, mat_type, mat_ref, qty FROM requirements WHERE status = 'confirmado'`),
    q.query(`SELECT scrap_date, item_id, units FROM inventory_scrap WHERE status = 'confirmado'`),
    q.query('SELECT month_key, week_from, week_to FROM periods WHERE week_from IS NOT NULL AND week_to IS NOT NULL'),
    q.query(`SELECT move_date, item_id, kind, qty, area FROM supply_movements WHERE status = 'confirmado'`),
  ]);
  const st: EngineSettings = {
    inicio: settings.inicio ?? '2026-10-05', wmDiv: settings.wmDiv ?? 19, crkDefaultUnitsPerBox: settings.crkDefaultUnitsPerBox ?? 64,
    sunLabels: settings.sunLabels ?? ['1X1', '4X2', '1.25X0.5'], wmLabel: settings.wmLabel ?? '3X2', uniLabel: settings.uniLabel ?? '3X2',
  };
  // el conteo base es el más reciente; todos los artículos comparten fecha en la práctica (se avisa si no)
  const baseDate = counts.rows.length ? iso(counts.rows.map((c) => iso(c.count_date)).sort().pop()) : null;
  return {
    lines: lines.rows.map((l) => ({ key: l.key, resultsGroup: l.results_group, summaryGroup: l.summary_group, name: l.name, um: l.um, mode: l.mode, billableLabel: l.billable_label, sort: l.sort })),
    products: products.rows.map((p) => ({ sap: p.sap, name: p.name, sort: p.sort })),
    standards: standards.rows.map((s) => ({ scope: s.scope, key: s.key, tt: s.tt, unitsPerPallet: s.units_per_pallet, unitRate: s.unit_rate, validFrom: iso(s.valid_from), validTo: s.valid_to ? iso(s.valid_to) : null })),
    settings: st,
    items: items.rows.map((i) => ({ id: i.id, kind: i.kind, code: i.code, name: i.name, unitsPerRoll: i.units_per_roll, ribbonId: i.ribbon_id, ribbonYield: i.ribbon_yield, price: i.price })),
    bagUsage: Object.fromEntries(bag.rows.map((b) => [b.sap, b.bags_per_box])),
    base: { date: baseDate, qty: Object.fromEntries(counts.rows.map((c) => [c.item_id, c.qty])) },
    prod: prod.rows.map((r) => ({ kind: r.kind, date: iso(r.record_date), sap: r.sap, productName: r.product_name, boxes: r.boxes, units: r.units, unitsPerBox: r.units_per_box, billableBoxes: r.billable_boxes, labelsUsed: r.labels_used, labelId: r.label_id, reviewUnits: r.review_units, badBoxes: r.bad_boxes, containerType: r.container_type })),
    hours: hours.rows.map((h) => ({ kind: h.kind, date: iso(h.record_date), hoursDay: h.hours_day, hoursNight: h.hours_night })),
    attendance: Object.fromEntries(att.rows.map((a) => [iso(a.week_monday), a.paid_hours])),
    reqs: reqs.rows.map((r) => ({ date: iso(r.request_date), area: r.area, amount: r.amount, matType: r.mat_type, matRef: r.mat_ref, qty: r.qty })),
    scrap: scrap.rows.map((s) => ({ date: iso(s.scrap_date), itemId: s.item_id, units: s.units })),
    supply: supply.rows.map((m) => ({ date: iso(m.move_date), itemId: m.item_id, kind: m.kind, qty: m.qty, area: m.area })),
    mw: Object.fromEntries(periods.rows.map((p) => [String(p.month_key), [p.week_from, p.week_to] as [number, number]])),
  };
}

export interface InsertMeta { userId?: string | null; batchId?: string | null; isDemo?: boolean; status?: 'borrador' | 'confirmado' }

/** Inserta registros de producción ignorando los que ya existen (misma llave natural). Devuelve insertados y omitidos. */
export async function defaultProjectByKind(q: Q): Promise<Record<string, string>> {
  const r = await q.query(`SELECT p.id, p.kinds FROM projects p JOIN clients c ON c.id = p.client_id WHERE c.code = 'FRITOLAY'`);
  const o: Record<string, string> = {}; for (const p of r.rows) for (const k of p.kinds) o[k] = p.id; return o;
}
export async function insertProdRows(q: Q, rows: ProdRow[], m: InsertMeta = {}) {
  let inserted = 0, skipped = 0; const ids: string[] = [], proj = await defaultProjectByKind(q);
  for (const r of rows) {
    const res = await q.query(
      `INSERT INTO production_records (kind, record_date, ref_doc, sap, product_name, boxes, units, units_per_box, billable_boxes, labels_used, label_id, review_units, bad_boxes,
         container_type, presentation, process_status, notes, data, source, import_batch_id, source_key, is_demo, status, created_by, updated_by, project_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$24,$25)
       ON CONFLICT (kind, source_key) WHERE source_key IS NOT NULL AND status <> 'anulado' DO NOTHING RETURNING id`,
      [r.kind, r.date, r.refDoc ?? null, r.sap ?? null, r.productName ?? null, r.boxes, r.units, r.unitsPerBox ?? null, r.billableBoxes ?? null, r.labelsUsed ?? null, r.labelId ?? null,
        r.reviewUnits, r.badBoxes, r.containerType ?? null, r.presentation ?? null, r.processStatus ?? null, r.notes ?? null, JSON.stringify(r.data ?? {}), r.source, m.batchId ?? null, r.sourceKey,
        m.isDemo ?? false, m.status ?? 'confirmado', m.userId ?? null, proj[r.kind] ?? null]);
    if (res.rowCount) { inserted++; ids.push(res.rows[0].id); } else skipped++;
  }
  return { inserted, skipped, ids };
}

export async function insertHoursRows(q: Q, rows: HoursRow[], m: InsertMeta = {}) {
  let inserted = 0, skipped = 0; const ids: string[] = [];
  for (const r of rows) {
    const res = await q.query(
      `INSERT INTO hours_records (kind, record_date, egress_no, area, activity, worker_name, hours_day, hours_night, notes, source, import_batch_id, source_key, is_demo, status, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$15)
       ON CONFLICT (kind, source_key) WHERE source_key IS NOT NULL AND status <> 'anulado' DO NOTHING RETURNING id`,
      [r.kind, r.date, r.egressNo ?? null, r.area ?? null, r.activity ?? null, r.workerName ?? null, r.hoursDay, r.hoursNight, r.notes ?? null, r.source, m.batchId ?? null, r.sourceKey,
        m.isDemo ?? false, m.status ?? 'confirmado', m.userId ?? null]);
    if (res.rowCount) { inserted++; ids.push(res.rows[0].id); } else skipped++;
  }
  return { inserted, skipped, ids };
}
