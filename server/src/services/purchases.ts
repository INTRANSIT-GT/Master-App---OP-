// Órdenes de compra y/o requerimiento de pago (formato interno Intransit).
// borrador → emitida → completada (al completar: ingresa inventario y se generan requerimientos) | anulada (revierte lo generado).
import { z } from 'zod';
import type { PoolClient } from 'pg';
import type { AuthUser } from '../auth.js';
import { pool, tx } from '../db.js';
import { AREAS } from '../engine/types.js';
import { bad, conflict, notFound, parse } from '../http.js';
import { audit } from './audit.js';
import { tzToday } from './records.js';

const r2 = (x: number) => Math.round(x * 100) / 100;
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'fecha AAAA-MM-DD');
const s = (max = 300) => z.preprocess((v) => (v === '' || v == null ? undefined : v), z.string().trim().max(max).optional());
const n0 = z.preprocess((v) => (v === '' || v == null ? undefined : v), z.coerce.number().finite().min(0).optional());

export const lineSchema = z.object({
  code: s(60), matType: z.enum(['Etiqueta', 'Ribbon', 'Bolsa', 'Insumo', 'Directo', 'Otro']).default('Otro'), matRef: s(120),
  description: z.string().trim().min(2, 'describe el bien o servicio').max(400), qty: z.coerce.number().positive('la cantidad debe ser mayor a 0'),
  unitPrice: z.coerce.number().min(0).default(0), area: s(10),
}).strict();
const header = {
  prefix: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{2,8}$/, 'prefijo de 2 a 8 letras/números').default('OC'),
  poDate: isoDate, costCenter: s(), serviceType: s(), clientId: z.preprocess((v) => (v === '' ? undefined : v), z.string().uuid().optional()),
  paymentCondition: z.enum(['CONTADO', 'CREDITO']).default('CONTADO'), currency: z.enum(['GTQ', 'USD']).default('GTQ'), exchangeRate: z.coerce.number().positive().default(1),
  supplier: z.string().trim().min(2, 'indica el proveedor').max(200), supplierContact: s(), supplierAddress: s(), supplierNit: s(60), supplierPhone: s(60),
  creditDays: s(60), advancePct: n0, advanceAmount: n0, paymentMethod: s(), bankAccount: s(), bank: s(), accountType: s(), instructions: s(500),
  requestedBy: s(), deliverTo: s(), deliveryPlace: s(), preparedBy: s(), preparedPosition: s(), approvedBy: s(), approvedPosition: s(), lot: s(60), checkNo: s(60), notes: s(500),
};
export const poSchema = z.object({ ...header, lines: z.array(lineSchema).min(1, 'agrega al menos una línea') }).strict();
const COL: Record<string, string> = {
  prefix: 'prefix', poDate: 'po_date', costCenter: 'cost_center', serviceType: 'service_type', clientId: 'client_id', paymentCondition: 'payment_condition', currency: 'currency', exchangeRate: 'exchange_rate',
  supplier: 'supplier', supplierContact: 'supplier_contact', supplierAddress: 'supplier_address', supplierNit: 'supplier_nit', supplierPhone: 'supplier_phone', creditDays: 'credit_days',
  advancePct: 'advance_pct', advanceAmount: 'advance_amount', paymentMethod: 'payment_method', bankAccount: 'bank_account', bank: 'bank', accountType: 'account_type', instructions: 'instructions',
  requestedBy: 'requested_by', deliverTo: 'deliver_to', deliveryPlace: 'delivery_place', preparedBy: 'prepared_by', preparedPosition: 'prepared_position', approvedBy: 'approved_by',
  approvedPosition: 'approved_position', lot: 'lot', checkNo: 'check_no', notes: 'notes',
};
const camel = (x: string) => x.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
const toApi = (r: Record<string, any>) => Object.fromEntries(Object.entries(r).map(([k, v]) => [camel(k), v]));

async function validateLines(c: PoolClient, lines: z.infer<typeof lineSchema>[]) {
  const seen = new Set<string>();
  for (const [i, l] of lines.entries()) {
    const n = i + 1;
    if (l.matType === 'Etiqueta') { if (!l.matRef || !(await c.query(`SELECT 1 FROM inv_items WHERE kind='lab' AND upper(replace(code,' ','')) = upper(replace($1,' ',''))`, [l.matRef.replace(/\*/g, 'X')])).rowCount) throw bad(`Línea ${n}: la etiqueta «${l.matRef ?? ''}» no existe en el catálogo.`); }
    else if (l.matType === 'Ribbon') { if (!l.matRef || !(await c.query(`SELECT 1 FROM inv_items WHERE id = $1 AND kind='rib'`, ['R:' + l.matRef])).rowCount) throw bad(`Línea ${n}: el ribbon «${l.matRef ?? ''}» no existe.`); }
    else if (l.matType === 'Bolsa') l.matRef = 'BOLSA';
    else if (l.matType === 'Insumo') { if (!l.matRef || !(await c.query(`SELECT 1 FROM inv_items WHERE id = $1 AND kind='ins'`, [l.matRef])).rowCount) throw bad(`Línea ${n}: selecciona un insumo del catálogo.`); }
    else if (l.area && !AREAS.some((a) => a[0] === l.area)) throw bad(`Línea ${n}: área inválida.`);
    const key = l.matType + '|' + (l.matRef ?? l.description.toLowerCase());
    if (seen.has(key)) throw bad(`Línea ${n}: repetida (mismo tipo y material); combínala con la anterior.`);
    seen.add(key);
  }
}
const withAmounts = (lines: z.infer<typeof lineSchema>[]) => lines.map((l) => ({ ...l, amount: r2(l.qty * l.unitPrice) }));

async function insertLines(c: PoolClient, poId: string, lines: ReturnType<typeof withAmounts>) {
  for (const [i, l] of lines.entries())
    await c.query(`INSERT INTO purchase_order_lines (po_id, line_no, code, mat_type, mat_ref, description, qty, unit_price, amount, area) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [poId, i + 1, l.code ?? null, l.matType, l.matRef ?? null, l.description, l.qty, l.unitPrice, l.amount, l.area ?? null]);
}
async function loadPO(c: PoolClient | typeof pool, id: string, lock = false) {
  const po = (await c.query(`SELECT * FROM purchase_orders WHERE id = $1${lock ? ' FOR UPDATE' : ''}`, [id])).rows[0];
  if (!po) throw notFound('Orden de compra');
  const lines = (await c.query('SELECT * FROM purchase_order_lines WHERE po_id = $1 ORDER BY line_no', [id])).rows;
  return { po, lines };
}
const full = (x: { po: any; lines: any[] }) => ({ ...toApi(x.po), lines: x.lines.map(toApi) });

export async function createPO(user: AuthUser, body: unknown, emit = false) {
  const b = parse(poSchema, body);
  if (b.currency === 'GTQ') b.exchangeRate = 1;
  return tx(async (c) => {
    await validateLines(c, b.lines);
    const lines = withAmounts(b.lines), total = r2(lines.reduce((a, l) => a + l.amount, 0));
    const seq = (await c.query(`INSERT INTO counters (key, value) VALUES ($1, 1) ON CONFLICT (key) DO UPDATE SET value = counters.value + 1 RETURNING value`, ['po:' + b.prefix])).rows[0].value;
    const cols = ['seq', 'number', 'total', 'status', 'created_by', 'updated_by'], vals: unknown[] = [seq, `${b.prefix}-${seq}`, total, emit ? 'emitida' : 'borrador', user.id, user.id];
    for (const [k, col] of Object.entries(COL)) if ((b as any)[k] !== undefined) { cols.push(col); vals.push((b as any)[k]); }
    if (emit) cols.push('issued_at'), vals.push(new Date());
    const po = (await c.query(`INSERT INTO purchase_orders (${cols.join(',')}) VALUES (${cols.map((_, i) => '$' + (i + 1)).join(',')}) RETURNING *`, vals)).rows[0];
    await insertLines(c, po.id, lines);
    const out = full(await loadPO(c, po.id));
    await audit(c, user, 'orden_compra', po.id, 'crear', null, out);
    return out;
  });
}

export async function updatePO(user: AuthUser, id: string, body: any) {
  const { version, reason, ...rest } = body ?? {};
  if (!Number.isInteger(version)) throw bad('Falta la versión de la orden (para no pisar cambios de otra persona).');
  return tx(async (c) => {
    const cur = await loadPO(c, id, true);
    if (['completada', 'anulada'].includes(cur.po.status)) throw conflict('ESTADO', `Una orden ${cur.po.status} no se edita${cur.po.status === 'completada' ? '; anúlala para revertir sus efectos en el inventario' : ''}.`);
    if (version !== cur.po.version) throw conflict('CONFLICTO_VERSION', 'Otra persona modificó esta orden. Recarga y vuelve a intentar.', { actual: cur.po.version });
    if (cur.po.status === 'emitida' && !(typeof reason === 'string' && reason.trim().length >= 5)) throw bad('Para editar una orden emitida escribe el motivo del cambio.');
    if (cur.po.status === 'borrador' && cur.po.created_by !== user.id && !['supervisor', 'administrador'].includes(user.role)) throw conflict('PROPIEDAD', 'Solo quien creó el borrador (o un supervisor) puede editarlo.');
    if ('prefix' in rest && rest.prefix !== cur.po.prefix) throw bad('El prefijo de la orden no se puede cambiar.');
    delete rest.prefix;
    const merged = { ...toApi(cur.po), ...rest, lines: rest.lines ?? cur.lines.map(toApi) };
    const clean = Object.fromEntries(Object.entries(merged).filter(([k, v]) => (k in header || k === 'lines') && v !== null));
    const b = parse(poSchema, { ...clean, prefix: cur.po.prefix, poDate: String(clean.poDate).slice(0, 10) });
    if (b.currency === 'GTQ') b.exchangeRate = 1;
    await validateLines(c, b.lines);
    const lines = withAmounts(b.lines), total = r2(lines.reduce((a, l) => a + l.amount, 0));
    const sets: string[] = ['total = $1', 'updated_by = $2', 'updated_at = now()', 'version = version + 1'], vals: unknown[] = [total, user.id];
    for (const [k, col] of Object.entries(COL)) if (k !== 'prefix' && (k in rest || (b as any)[k] !== undefined)) { vals.push((b as any)[k] ?? null); sets.push(`${col} = $${vals.length}`); }
    vals.push(id);
    await c.query(`UPDATE purchase_orders SET ${sets.join(', ')} WHERE id = $${vals.length}`, vals);
    await c.query('DELETE FROM purchase_order_lines WHERE po_id = $1', [id]);
    await insertLines(c, id, lines);
    const out = full(await loadPO(c, id));
    await audit(c, user, 'orden_compra', id, 'editar', full(cur), out, typeof reason === 'string' ? reason.trim() : null);
    return out;
  });
}

export async function emitPO(user: AuthUser, id: string) {
  return tx(async (c) => {
    const cur = await loadPO(c, id, true);
    if (cur.po.status !== 'borrador') throw conflict('ESTADO', 'Solo los borradores se pueden emitir.');
    await c.query(`UPDATE purchase_orders SET status = 'emitida', issued_at = now(), updated_by = $2, updated_at = now(), version = version + 1 WHERE id = $1`, [id, user.id]);
    const out = full(await loadPO(c, id));
    await audit(c, user, 'orden_compra', id, 'emitir', { status: 'borrador' }, { status: 'emitida', number: cur.po.number });
    return out;
  });
}

/** Completar = se recibió lo solicitado: entra a inventario (insumos, etiquetas, ribbon, bolsa) y los costos directos restan al área. */
export async function completePO(user: AuthUser, id: string, receivedDate?: string) {
  const date = receivedDate ?? tzToday();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw bad('Fecha de recepción inválida.');
  if (date > tzToday()) throw bad('La fecha de recepción no puede ser futura.');
  return tx(async (c) => {
    const { po, lines } = await loadPO(c, id, true);
    if (po.status !== 'emitida') throw conflict('ESTADO', po.status === 'borrador' ? 'Primero emite la orden.' : `La orden ya está ${po.status}.`);
    if (date < String(po.po_date).slice(0, 10)) throw bad('La recepción no puede ser anterior a la fecha de la orden.');
    const rate = +po.exchange_rate || 1, created: { requirements: string[]; supply: string[] } = { requirements: [], supply: [] };
    for (const l of lines) {
      const amountQ = r2(+l.amount * rate);
      if (l.mat_type === 'Insumo') {
        const m = (await c.query(`INSERT INTO supply_movements (move_date, item_id, kind, qty, notes, po_line_id, is_demo, created_by, updated_by) VALUES ($1,$2,'ingreso',$3,$4,$5,$6,$7,$7) RETURNING id`,
          [date, l.mat_ref, l.qty, `OC ${po.number}`, l.id, po.is_demo, user.id])).rows[0];
        created.supply.push(m.id);
      } else {
        const ref = l.mat_type === 'Etiqueta' ? l.mat_ref.replace(/\*/g, 'X') : l.mat_type === 'Bolsa' ? 'BOLSA' : l.mat_ref ?? l.description;
        const r = (await c.query(`INSERT INTO requirements (request_date, area, oc, amount, supplier, qty, mat_type, mat_ref, notes, po_line_id, is_demo, created_by, updated_by)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12) RETURNING id`,
          [date, l.area || 'gen', po.number, amountQ, po.supplier, l.qty, l.mat_type, ref, l.description, l.id, po.is_demo, user.id])).rows[0];
        created.requirements.push(r.id);
      }
    }
    await c.query(`UPDATE purchase_orders SET status = 'completada', received_date = $2, completed_at = now(), completed_by = $3, updated_by = $3, updated_at = now(), version = version + 1 WHERE id = $1`, [id, date, user.id]);
    await audit(c, user, 'orden_compra', id, 'completar', { status: 'emitida' }, { status: 'completada', receivedDate: date, ...created });
    return full(await loadPO(c, id));
  });
}

export async function voidPO(user: AuthUser, id: string, reason: unknown) {
  const why = typeof reason === 'string' && reason.trim().length >= 5 ? reason.trim() : null;
  if (!why) throw bad('Anular una orden requiere justificación (mínimo 5 caracteres).');
  return tx(async (c) => {
    const cur = await loadPO(c, id, true);
    if (cur.po.status === 'anulada') throw conflict('ANULADO', 'La orden ya estaba anulada.');
    let reverted = { requirements: 0, supply: 0 };
    if (cur.po.status === 'completada') {
      const ids = cur.lines.map((l) => l.id);
      const q = (t: string) => `UPDATE ${t} SET status = 'anulado', void_reason = $2, voided_by = $3, voided_at = now(), version = version + 1 WHERE po_line_id = ANY($1::uuid[]) AND status <> 'anulado'`;
      const txt = `OC ${cur.po.number} anulada: ${why}`;
      reverted = { requirements: (await c.query(q('requirements'), [ids, txt, user.id])).rowCount ?? 0, supply: (await c.query(q('supply_movements'), [ids, txt, user.id])).rowCount ?? 0 };
    }
    await c.query(`UPDATE purchase_orders SET status = 'anulada', void_reason = $2, voided_by = $3, voided_at = now(), updated_by = $3, updated_at = now(), version = version + 1 WHERE id = $1`, [id, why, user.id]);
    const out = full(await loadPO(c, id));
    await audit(c, user, 'orden_compra', id, 'anular', { status: cur.po.status }, { status: 'anulada', revertido: reverted }, why);
    return out;
  });
}

export async function listPO(f: { from?: string; to?: string; status?: string; q?: string; limit?: number }) {
  const w: string[] = [], v: unknown[] = [];
  if (f.from) { v.push(f.from); w.push(`po_date >= $${v.length}`); }
  if (f.to) { v.push(f.to); w.push(`po_date <= $${v.length}`); }
  if (f.status) { v.push(f.status); w.push(`status = $${v.length}`); }
  if (f.q) { v.push('%' + f.q + '%'); w.push(`(number ILIKE $${v.length} OR supplier ILIKE $${v.length} OR EXISTS (SELECT 1 FROM purchase_order_lines l WHERE l.po_id = purchase_orders.id AND l.description ILIKE $${v.length}))`); }
  const rows = (await pool.query(`SELECT po.*, (SELECT count(*)::int FROM purchase_order_lines l WHERE l.po_id = po.id) AS line_count, c.name AS client_name FROM purchase_orders po LEFT JOIN clients c ON c.id = po.client_id
    ${w.length ? 'WHERE ' + w.join(' AND ').replaceAll('purchase_orders.', 'po.') : ''} ORDER BY po.po_date DESC, po.seq DESC LIMIT ${Math.min(f.limit ?? 200, 500)}`, v)).rows;
  return rows.map(toApi);
}
export async function getPO(id: string) {
  const x = await loadPO(pool, id);
  const history = (await pool.query(`SELECT id, at, user_email AS "userEmail", action, reason FROM audit_log WHERE entity = 'orden_compra' AND entity_id = $1 ORDER BY id`, [id])).rows;
  const client = x.po.client_id ? (await pool.query('SELECT name FROM clients WHERE id = $1', [x.po.client_id])).rows[0]?.name : null;
  return { ...full(x), clientName: client, history };
}
export async function purchaseHistory(f: { from?: string; to?: string; supplier?: string }) {
  // historial de qué material se solicitó, cantidad, monto y proveedor (una fila por línea)
  const v: unknown[] = [], w = [`po.status <> 'anulada'`];
  if (f.from) { v.push(f.from); w.push(`po.po_date >= $${v.length}`); }
  if (f.to) { v.push(f.to); w.push(`po.po_date <= $${v.length}`); }
  if (f.supplier) { v.push('%' + f.supplier + '%'); w.push(`po.supplier ILIKE $${v.length}`); }
  return (await pool.query(`SELECT po.number, po.po_date, po.status, po.supplier, po.currency, po.exchange_rate, l.code, l.description, l.mat_type, l.mat_ref, l.qty, l.unit_price, l.amount, round(l.amount * po.exchange_rate, 2) AS amount_gtq
    FROM purchase_order_lines l JOIN purchase_orders po ON po.id = l.po_id WHERE ${w.join(' AND ')} ORDER BY po.po_date DESC, po.seq DESC, l.line_no`, v)).rows.map(toApi);
}

// Listas desplegables del formulario: los valores ya usados en órdenes no anuladas (los más usados primero).
const OPTION_FIELDS = ['costCenter', 'serviceType', 'paymentMethod', 'bank', 'accountType', 'requestedBy', 'deliverTo', 'deliveryPlace',
  'preparedBy', 'preparedPosition', 'approvedBy', 'approvedPosition'] as const;
const SUPPLIER_FIELDS = ['supplierContact', 'supplierAddress', 'supplierNit', 'supplierPhone', 'creditDays', 'paymentMethod', 'bankAccount', 'bank', 'accountType'] as const;
export async function purchaseOptions() {
  const out: Record<string, unknown[]> = {};
  for (const k of OPTION_FIELDS)
    out[k] = (await pool.query(`SELECT trim(${COL[k]}) AS v FROM purchase_orders WHERE status <> 'anulada' AND nullif(trim(${COL[k]}), '') IS NOT NULL
      GROUP BY 1 ORDER BY count(*) DESC, 1 LIMIT 200`)).rows.map((r) => r.v);
  // un proveedor por nombre, con los datos de su orden más reciente: el formulario los copia al elegirlo
  out.suppliers = (await pool.query(`SELECT DISTINCT ON (upper(trim(supplier))) trim(supplier) AS supplier, ${SUPPLIER_FIELDS.map((k) => COL[k]).join(', ')}
    FROM purchase_orders WHERE status <> 'anulada' ORDER BY upper(trim(supplier)), po_date DESC, seq DESC`)).rows.map(toApi);
  return out;
}
