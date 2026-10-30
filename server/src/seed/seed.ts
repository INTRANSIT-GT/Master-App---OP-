// Siembra: catálogos (siempre), usuarios iniciales y datos de demostración (opcional, etiquetados is_demo).
//   npm run seed                 → catálogos + usuarios de demo + datos demo
//   npm run seed -- --catalog    → solo catálogos (+ administrador si hay ADMIN_EMAIL/ADMIN_PASSWORD)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import type { PoolClient } from 'pg';
import { pool, tx } from '../db.js';
import { iso, period } from '../engine/calendar.js';
import { insertHoursRows, insertProdRows } from '../services/store.js';
import { naturalKey } from '../services/keys.js';
import { completePO, createPO, emitPO } from '../services/purchases.js';
import type { AuthUser } from '../auth.js';
import { validatePasswordStrength } from '../auth.js';
import { bundleRows, catalogData, LINE_DEFS, type Bundle } from './bundle.js';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'data');
const readJson = (f: string) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
// el conteo base, las semanas ajustadas y los datos de demostración vienen del Excel de Omnia: van a esa sede
const SEDE = 'OMNIA';

export async function seedCatalog(c: PoolClient) {
  const cfg = readJson('catalog.json').cfg as Bundle['cfg'];
  const cat = catalogData(cfg);
  for (const l of LINE_DEFS)
    await c.query(`INSERT INTO process_lines (key, results_group, summary_group, name, um, mode, billable_label, sort) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (key) DO NOTHING`,
      [l.key, l.resultsGroup, l.summaryGroup, l.name, l.um, l.mode, l.billableLabel ?? null, l.sort]);
  for (const p of cat.products) await c.query('INSERT INTO products (sap, name, sort) VALUES ($1,$2,$3) ON CONFLICT (sap) DO NOTHING', [p.sap, p.name, p.sort]);
  for (const s of cat.standards)
    await c.query(`INSERT INTO standards (scope, key, tt, units_per_pallet, unit_rate, valid_from, valid_to, note) VALUES ($1,$2,$3,$4,$5,$6,$7,'Carga inicial desde Resultados Omnia')
                   ON CONFLICT DO NOTHING`, [s.scope, s.key, s.tt, s.unitsPerPallet, s.unitRate, s.validFrom, s.validTo]).catch((e) => { if (e.code !== '23P01') throw e; });
  const useText = readJson('catalog.json').cfg.itemUse as Record<string, string>;
  let sort = 0;
  for (const it of [...cat.items.filter((i) => i.kind === 'rib'), ...cat.items.filter((i) => i.kind === 'lab'), ...cat.items.filter((i) => i.kind === 'bag')])
    await c.query(`INSERT INTO inv_items (id, kind, code, name, units_per_roll, ribbon_id, ribbon_yield, price, use_text, sort) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (id) DO NOTHING`,
      [it.id, it.kind, it.code, it.name, it.unitsPerRoll, it.ribbonId, it.ribbonYield, it.price, useText[it.id] ?? null, sort++]);
  for (const [sap, n] of Object.entries(cat.bagUsage)) await c.query('INSERT INTO bag_usage (sap, bags_per_box) VALUES ($1,$2) ON CONFLICT (sap) DO NOTHING', [sap, n]);
  for (const m of cfg.matLab)
    await c.query(`INSERT INTO material_labels (sap, name, label, confirmed, aliases) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`, [m.sap || null, m.n, m.lab ?? '', !!m.ok, m.al ?? []]);
  for (const [id, qty] of Object.entries(cat.base.qty))
    await c.query('INSERT INTO inventory_counts (count_date, item_id, qty, sede_id) VALUES ($1,$2,$3,$4) ON CONFLICT (sede_id, count_date, item_id) DO NOTHING', [cat.base.date, id, qty, SEDE]);
  for (const [k, v] of Object.entries({ ...cat.settings, itemUse: useText }))
    await c.query('INSERT INTO settings (key, value) VALUES ($1,$2) ON CONFLICT (key) DO NOTHING', [k, JSON.stringify(v)]);
  for (const [k, w] of Object.entries(cat.mw)) {
    const p = period(+k, cat.mw), y = Math.floor(+k / 12);
    await c.query(`INSERT INTO periods (month_key, year, month, week_from, week_to, start_date, end_date, sede_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (sede_id, month_key) DO NOTHING`,
      [+k, y, (+k % 12) + 1, w[0], w[1], iso(p.s), iso(p.e), SEDE]);
  }
}

export const DEMO_USERS = [
  { email: 'admin@omnia.local', name: 'Administrador Demo', role: 'administrador' },
  { email: 'supervisor@omnia.local', name: 'Supervisor Demo', role: 'supervisor' },
  { email: 'operador@omnia.local', name: 'Operador Demo', role: 'operador' },
  { email: 'consulta@omnia.local', name: 'Consulta Demo', role: 'consulta' },
  { email: 'comercial@omnia.local', name: 'Comercial Demo', role: 'comercial' },
] as const;
export const DEMO_PASSWORD = 'Omnia2026!demo';

export async function seedUsers(c: PoolClient, users: readonly { email: string; name: string; role: string }[], password: string) {
  const hash = await bcrypt.hash(password, 10);
  for (const u of users) {
    await c.query(`INSERT INTO users (email, name, password_hash, role) VALUES ($1,$2,$3,$4::user_role) ON CONFLICT (lower(email)) DO NOTHING`, [u.email, u.name, hash, u.role]);
    await c.query(`INSERT INTO user_sedes (user_id, sede_id) SELECT id, $2 FROM users WHERE lower(email) = lower($1) ON CONFLICT DO NOTHING`, [u.email, SEDE]);
  }
}

export async function seedDemo(c: PoolClient) {
  const demo = readJson('demo-records.json');
  const batch = (await c.query(`INSERT INTO import_batches (source, file_name, status, stats, applied_at, sede_id) VALUES ('demo','demo-records.json','aplicado','{}', now(), $1) RETURNING id`, [SEDE])).rows[0].id;
  const rows = bundleRows(demo, 'demo');
  const meta = { sede: SEDE, batchId: batch, isDemo: true };
  const a = await insertProdRows(c, rows.prod, meta), b = await insertHoursRows(c, rows.hours, meta);
  for (const [w, h] of Object.entries(rows.attendance))
    await c.query('INSERT INTO attendance (week_monday, paid_hours, is_demo, sede_id) VALUES ($1,$2,true,$3) ON CONFLICT (sede_id, week_monday) DO NOTHING', [w, h, SEDE]);
  await c.query(`UPDATE import_batches SET stats = $2 WHERE id = $1`, [batch, JSON.stringify({ produccion: a.inserted, horas: b.inserted })]);
  await c.query(`INSERT INTO settings (key, value) VALUES ('demo', 'true') ON CONFLICT (key) DO UPDATE SET value = 'true'`);
  return { produccion: a.inserted, horas: b.inserted, asistencia: Object.keys(rows.attendance).length };
}

/** Datos de demostración v2 (clientes distintos de Fritolay, tarifas de cobro, insumos y órdenes de compra). Solo desde `npm run seed`. */
export async function seedDemoV2(c: PoolClient) {
  const proj = (await c.query(`SELECT p.id, p.code, p.sede_id, c.code AS ccode FROM projects p JOIN clients c ON c.id = p.client_id WHERE p.kinds[1] = 'gen'`)).rows;
  const P = (cc: string, code: string) => proj.find((x) => x.ccode === cc && x.code === code)!.id as string;
  const sedeOf = (pid: string) => proj.find((x) => x.id === pid)!.sede_id as string;   // cada registro va a la sede de su proyecto
  const gen: [string, string, string, number, string][] = [
    ['COCACOLA', 'ENV', '2026-10-06', 1200, 'TR-001'], ['COCACOLA', 'ENV', '2026-10-13', 1850, 'TR-002'], ['COCACOLA', 'TAR', '2026-10-08', 64, 'TR-003'], ['COCACOLA', 'PACKS', '2026-10-15', 420, 'PK-010'],
    ['COCACOLA', 'DESARME', '2026-10-20', 36, 'DS-004'], ['ALNOST', 'VF', '2026-10-07', 310, 'VF-101'], ['ALNOST', 'VF', '2026-10-14', 275, 'VF-102'], ['XPORTA', 'VF', '2026-10-09', 540, 'XP-201'],
    ['LICORERA', 'ETQ', '2026-10-12', 2400, 'LC-301'], ['LICORERA', 'PACKS', '2026-10-19', 150, 'LC-302'],
  ];
  const batch = (await c.query(`INSERT INTO import_batches (source, file_name, status, stats, applied_at, sede_id) VALUES ('demo','demo-v2','aplicado','{}', now(), $1) RETURNING id`, [SEDE])).rows[0].id;
  for (const [cc, code, date, qty, ref] of gen) {
    const pid = P(cc, code), key = naturalKey(['gen', pid, date, ref, qty]) + '#1';
    await c.query(`INSERT INTO production_records (kind, project_id, record_date, ref_doc, boxes, source, source_key, is_demo, import_batch_id, notes, sede_id) VALUES ('gen',$1,$2,$3,$4,'demo',$5,true,$6,'Registro de demostración',$7) ON CONFLICT DO NOTHING`, [pid, date, ref, qty, key, batch, sedeOf(pid)]);
  }
  const rates: [string, string, string, number, string][] = [['COCACOLA', 'ENV', 'UNIDAD', 0.35, ''], ['COCACOLA', 'TAR', 'TARIMA', 18, ''], ['COCACOLA', 'PACKS', 'PACK', 1.9, ''], ['ALNOST', 'VF', 'CAJA', 0.8, ''], ['LICORERA', 'ETQ', 'UNIDAD', 0.22, '']];
  for (const [cc, code, unit, rate] of rates)
    await c.query(`INSERT INTO billing_rates (project_id, rate, unit, valid_from, note) VALUES ($1,$2,$3,'2026-10-05','TARIFA DE DEMOSTRACIÓN (no real)') ON CONFLICT DO NOTHING`, [P(cc, code), rate, unit]).catch((e) => { if (e.code !== '23P01') throw e; });
  const ins: [string, string, string, number, number][] = [['TARIMA', 'Tarima plástica', 'UNIDAD', 85, 120], ['FILM', 'Film stretch', 'ROLLO', 120, 60], ['CINTA', 'Cinta de empaque', 'ROLLO', 14, 300], ['CAJA-PACK', 'Caja corrugada para pack', 'UNIDAD', 3.5, 2000]];
  let sort = 100;
  for (const [code, name, unit, price, qty] of ins) {
    await c.query(`INSERT INTO inv_items (id, kind, code, name, unit, price, sort) VALUES ($1,'ins',$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING`, ['I:' + code, code, name, unit, price, sort++]);
    await c.query(`INSERT INTO inventory_counts (count_date, item_id, qty, sede_id) SELECT max(count_date), $1, $2, $3 FROM inventory_counts WHERE sede_id = $3 HAVING max(count_date) IS NOT NULL ON CONFLICT DO NOTHING`, ['I:' + code, qty, SEDE]);
  }
}
/** Órdenes de compra de demostración (usa los servicios reales: emitir y completar ingresan inventario y requerimientos). */
export async function seedDemoOrders() {
  const row = (await pool.query(`SELECT id, email, name, role FROM users WHERE lower(email) = 'supervisor@omnia.local'`)).rows[0] as AuthUser | undefined;
  if (!row) return 'sin usuario supervisor: órdenes omitidas';
  const u: AuthUser = { ...row, sede: SEDE };
  if ((await pool.query(`SELECT 1 FROM purchase_orders WHERE is_demo`)).rowCount) return 'órdenes demo ya existen';
  const lab = (await pool.query(`SELECT code, price FROM inv_items WHERE kind='lab' ORDER BY sort LIMIT 1`)).rows[0], rib = (await pool.query(`SELECT code FROM inv_items WHERE kind='rib' ORDER BY sort LIMIT 1`)).rows[0];
  const base = { poDate: '2026-10-14', costCenter: '2 EMBOCEN', serviceType: '08-TRANSPORTE', paymentCondition: 'CONTADO', currency: 'GTQ', requestedBy: 'Coordinador de proyecto (demo)', deliverTo: 'Bodega de insumos', deliveryPlace: 'Sede Omnia', preparedBy: 'Coordinador (demo)', preparedPosition: 'Desarrollador de Proyectos', approvedBy: 'Supervisor (demo)', approvedPosition: 'Gerente de Operaciones' };
  const mark = (id: string) => pool.query('UPDATE purchase_orders SET is_demo = true WHERE id = $1', [id]);
  const o1: any = await createPO(u, { ...base, supplier: 'PROVEEDOR DEMO, S. A.', prefix: 'OCD', lines: [{ matType: 'Insumo', matRef: 'I:TARIMA', code: 'TAR-01', description: 'Tarima plástica 1.2 x 1.0', qty: 40, unitPrice: 85 }, { matType: 'Insumo', matRef: 'I:FILM', code: 'FIL-02', description: 'Film stretch 18"', qty: 20, unitPrice: 120 }] });
  await mark(o1.id); await emitPO(u, o1.id); await completePO(u, o1.id, '2026-10-15');
  const o2: any = await createPO(u, { ...base, poDate: '2026-10-19', supplier: 'ETIQUETAS DEMO', prefix: 'OCD', lines: [{ matType: 'Etiqueta', matRef: lab.code, description: `Etiqueta ${lab.code} (rollos)`, qty: 5, unitPrice: lab.price ?? 100 }, { matType: 'Ribbon', matRef: rib.code, description: `Ribbon ${rib.code}`, qty: 4, unitPrice: 60 }] });
  await mark(o2.id); await emitPO(u, o2.id);
  const o3: any = await createPO(u, { ...base, poDate: '2026-10-21', supplier: 'SERVICIOS DEMO', prefix: 'OCD', currency: 'USD', exchangeRate: 7.7, lines: [{ matType: 'Otro', area: 'gen', description: 'Suscripción mensual de sistema (demo)', qty: 100, unitPrice: 0.6 }] });
  await mark(o3.id);
  return 'órdenes demo: 1 completada, 1 emitida, 1 borrador';
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const catalogOnly = process.argv.includes('--catalog');
  tx(async (c) => {
    await seedCatalog(c);
    if (catalogOnly) {
      if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) { validatePasswordStrength(process.env.ADMIN_PASSWORD); await seedUsers(c, [{ email: process.env.ADMIN_EMAIL, name: 'Administrador', role: 'administrador' }], process.env.ADMIN_PASSWORD); }
      return 'Catálogos cargados.';
    }
    await seedUsers(c, DEMO_USERS, process.env.DEMO_PASSWORD ?? DEMO_PASSWORD);
    const r = await seedDemo(c); await seedDemoV2(c);
    return `Catálogos, 5 usuarios de demo y datos DEMO cargados: ${JSON.stringify(r)}`;
  }).then(async (m) => { console.log(m); if (!catalogOnly) console.log(await seedDemoOrders()); return pool.end(); }).catch((e) => { console.error(e); process.exit(1); });
}
