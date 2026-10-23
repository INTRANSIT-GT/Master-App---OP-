// CRUD de registros operativos con: validación, prevención de duplicados, bloqueo optimista (version),
// anulación con justificación (nunca se borra), confirmación de borradores y bitácora de cambios.
import { z } from 'zod';
import type { PoolClient } from 'pg';
import type { AuthUser } from '../auth.js';
import { pool, tx } from '../db.js';
import { HttpError, bad, conflict, notFound, parse } from '../http.js';
import { can } from '../permissions.js';
import { AREAS } from '../engine/types.js';
import { audit } from './audit.js';
import { naturalKey } from './keys.js';
import { getSettings } from './store.js';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'fecha AAAA-MM-DD').refine((s) => !isNaN(Date.parse(s + 'T00:00:00Z')), 'fecha inválida');
const num0 = z.coerce.number().finite().min(0, 'no puede ser negativo');
const optNum = z.preprocess((v) => (v === '' || v === null ? undefined : v), z.coerce.number().finite().min(0).optional());
const optStr = z.preprocess((v) => (v === '' ? undefined : v), z.string().trim().max(300).optional());
const statusIn = z.enum(['borrador', 'confirmado']).default('confirmado');

export const tzToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: process.env.TZ_NEGOCIO ?? 'America/Guatemala' }).format(new Date());
const addDays = (s: string, n: number) => new Date(Date.parse(s + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);

// ───────── esquemas por entidad ─────────
const PROD_KINDS = ['maq', 'wm', 'cob', 'desc', 'uni', 'dc', 'revm', 'etq', 'noc', 'qua', 'sun', 'crk', 'gen'] as const;
const uuid = z.preprocess((v) => (v === '' ? undefined : v), z.string().uuid().optional());
export const prodSchema = z.object({
  kind: z.enum(PROD_KINDS), projectId: uuid, date: isoDate, refDoc: optStr, sap: optStr, productName: optStr,
  boxes: num0.default(0), units: num0.default(0), unitsPerBox: optNum, billableBoxes: optNum, labelsUsed: optNum, labelId: optStr,
  reviewUnits: num0.default(0), badBoxes: num0.default(0), containerType: optStr, presentation: optStr,
  processStatus: z.enum(['FINALIZADO', 'PARCIAL', 'PROCESO']).optional(), notes: optStr, data: z.record(z.string(), z.unknown()).optional(),
  status: statusIn, allowDuplicate: z.boolean().optional(),
}).strict();
const HOURS_KINDS = ['imp', 'maqp'] as const;   // v2: impresión y personal de maquila (se retiraron administración, outsourcing, EVN y coordinador)
export const hoursSchema = z.object({
  kind: z.enum(HOURS_KINDS), projectId: uuid, date: isoDate, egressNo: optStr, area: optStr, activity: optStr, workerName: optStr,
  hoursDay: num0.max(1000, 'máximo 1000 h').default(0), hoursNight: num0.max(1000, 'máximo 1000 h').default(0), notes: optStr,
  status: statusIn, allowDuplicate: z.boolean().optional(),
}).strict();
export const reqSchema = z.object({
  date: isoDate, area: z.enum(AREAS.map((a) => a[0]) as [string, ...string[]]), oc: optStr, amount: num0.default(0), supplier: optStr, qty: num0.default(0),
  matType: z.enum(['Etiqueta', 'Ribbon', 'Bolsa', 'Directo', 'Otro']), matRef: optStr, notes: optStr, status: statusIn,
}).strict();
export const supplySchema = z.object({ date: isoDate, itemId: z.string().min(1), kind: z.enum(['ingreso', 'consumo']), qty: z.coerce.number().positive('debe ser mayor a 0'), projectId: uuid, area: optStr, notes: optStr, status: statusIn }).strict();
export const scrapSchema = z.object({ date: isoDate, itemId: z.string().min(1), units: z.coerce.number().int().positive('debe ser mayor a 0'), reason: optStr, status: statusIn }).strict();

interface Ent {
  entity: string; table: string; dateCol: string; schema: z.ZodObject<any>;
  map: Record<string, string>;                 // campo API → columna
  json?: string[];                              // columnas jsonb
  natural?: (b: any) => unknown[];              // huella natural para detectar duplicados de captura
  keyed?: boolean;                              // la tabla tiene source_key
  check?: (b: any, c: PoolClient, s: Record<string, any>) => Promise<void> | void;
  lock?: (row: any) => string | null;           // motivo por el que el registro no se puede editar/anular directamente
  searchCol?: string;
}
const prodMap = { kind: 'kind', projectId: 'project_id', date: 'record_date', refDoc: 'ref_doc', sap: 'sap', productName: 'product_name', boxes: 'boxes', units: 'units', unitsPerBox: 'units_per_box', billableBoxes: 'billable_boxes', labelsUsed: 'labels_used', labelId: 'label_id', reviewUnits: 'review_units', badBoxes: 'bad_boxes', containerType: 'container_type', presentation: 'presentation', processStatus: 'process_status', notes: 'notes', data: 'data' };
const hoursMap = { kind: 'kind', projectId: 'project_id', date: 'record_date', egressNo: 'egress_no', area: 'area', activity: 'activity', workerName: 'worker_name', hoursDay: 'hours_day', hoursNight: 'hours_night', notes: 'notes' };
const reqMap = { date: 'request_date', area: 'area', oc: 'oc', amount: 'amount', supplier: 'supplier', qty: 'qty', matType: 'mat_type', matRef: 'mat_ref', notes: 'notes' };
const supplyMap = { date: 'move_date', itemId: 'item_id', kind: 'kind', qty: 'qty', projectId: 'project_id', area: 'area', notes: 'notes' };
const scrapMap = { date: 'scrap_date', itemId: 'item_id', units: 'units', reason: 'reason' };

async function resolveProject(c: PoolClient, b: any) {
  if (b.projectId) {
    const p = (await c.query('SELECT id, name, kinds, active FROM projects WHERE id = $1', [b.projectId])).rows[0];
    if (!p) throw bad('El proyecto no existe.');
    if (!p.active) throw bad(`El proyecto «${p.name}» está inactivo.`);
    if (b.kind && !p.kinds.includes(b.kind)) throw bad(`El proyecto «${p.name}» no admite registros de tipo ${b.kind}.`);
    return p;
  }
  if (b.kind === 'gen') throw bad('Selecciona el cliente y el proyecto.');
  const p = (await c.query(`SELECT p.id FROM projects p JOIN clients cl ON cl.id = p.client_id WHERE cl.code = 'FRITOLAY' AND $1 = ANY(p.kinds)`, [b.kind])).rows[0];
  if (p) b.projectId = p.id;
  return p;
}
async function checkLabel(c: PoolClient, code?: string | null) {
  if (!code) return;
  const r = await c.query(`SELECT 1 FROM inv_items WHERE kind='lab' AND upper(replace(code,' ','')) = upper(replace($1,' ',''))`, [code.replace(/\*/g, 'X')]);
  if (!r.rowCount) throw bad(`La etiqueta «${code}» no existe en el catálogo.`);
}
function prodRules(b: any) {
  const need = (cond: boolean, msg: string) => { if (!cond) throw bad(msg); };
  switch (b.kind) {
    case 'maq': need(!!b.sap, 'La maquila requiere el código SAP.'); need(b.boxes > 0, 'Las cajas deben ser mayores a 0.'); break;
    case 'wm': need(b.boxes > 0 || b.units > 0, 'Walmart requiere cajas o unidades.'); break;
    case 'cob': case 'dc': need(b.boxes > 0, 'Las cajas deben ser mayores a 0.'); break;
    case 'desc': need(['GALLETA', 'SALADO', 'FLUS', 'QUAKER'].includes(String(b.containerType ?? '').toUpperCase()), 'Tipo de descarga: GALLETA, SALADO, FLUS o QUAKER.'); break;
    case 'uni': need(b.boxes > 0 || b.units > 0, 'Unisuper requiere cajas o unidades.'); break;
    case 'revm': need(b.units > 0, 'La revisión requiere unidades.'); break;
    case 'etq': case 'noc': case 'qua': need(b.units > 0 || b.boxes > 0, 'Indica unidades etiquetadas o cajas.'); break;
    case 'sun': need(b.units > 0 || b.boxes > 0, 'Indica unidades etiquetadas o cajas.'); break;
    case 'crk': need(b.boxes + b.badBoxes > 0, 'Indica cajas buenas o en mal estado.'); break;
    case 'gen': need(b.boxes > 0, 'La cantidad debe ser mayor a 0.'); break;
  }
  if (b.kind === 'desc') b.containerType = String(b.containerType).toUpperCase();
}
function derive(b: any, s: Record<string, any>) {         // valores derivados igual que el lector del HTML (R6)
  if (b.kind === 'wm') {
    if (!b.units && b.boxes && b.unitsPerBox) b.units = b.boxes * b.unitsPerBox;
    if (b.billableBoxes == null) {
      const div = s.wmDiv || 19, uxc = b.unitsPerBox ?? 0;
      b.billableBoxes = Math.round((uxc >= div ? b.units / div : uxc ? b.units / uxc : b.boxes) * 100) / 100;
    }
  }
  if (b.kind === 'uni' && !b.units && b.boxes && b.unitsPerBox) b.units = b.boxes * b.unitsPerBox;
}

export const ENTITIES: Record<'production' | 'hours' | 'requirements' | 'scrap' | 'supply', Ent> = {
  production: {
    entity: 'produccion', table: 'production_records', dateCol: 'record_date', schema: prodSchema, map: prodMap, json: ['data'], keyed: true,
    natural: (b) => [b.kind, b.projectId, b.date, b.refDoc, b.sap, b.productName, b.boxes, b.units, b.labelId, b.reviewUnits, b.badBoxes, b.containerType],
    check: async (b, c) => {
      await resolveProject(c, b); prodRules(b); await checkLabel(c, b.labelId);
      if (['maq', 'dc', 'uni'].includes(b.kind) && b.sap && !b.productName) b.productName = (await c.query('SELECT name FROM products WHERE sap = $1', [b.sap])).rows[0]?.name;   // la descripción sale del catálogo SAP
    },
  },
  hours: {
    entity: 'horas', table: 'hours_records', dateCol: 'record_date', schema: hoursSchema, map: hoursMap, keyed: true,
    natural: (b) => [b.kind, b.projectId, b.date, b.egressNo, b.area, b.activity, b.workerName, b.hoursDay, b.hoursNight],
    check: async (b, c) => {
      if (!(b.hoursDay > 0 || b.hoursNight > 0)) throw bad('Indica horas diurnas o nocturnas.');
      if (b.kind === 'imp' && b.hoursDay + b.hoursNight > 24) throw bad('Máximo 24 horas por día.');
      if (b.projectId && !(await c.query('SELECT 1 FROM projects WHERE id = $1 AND active', [b.projectId])).rowCount) throw bad('El proyecto no existe o está inactivo.');
    },
  },
  requirements: {
    entity: 'requerimiento', table: 'requirements', dateCol: 'request_date', schema: reqSchema, map: reqMap,
    lock: (r) => (r.po_line_id ? 'Este requerimiento lo generó una orden de compra completada; anula la orden para revertirlo.' : null),
    check: async (b, c) => {
      if (b.matType === 'Etiqueta') await checkLabel(c, b.matRef);
      if (b.matType === 'Ribbon' && !(await c.query(`SELECT 1 FROM inv_items WHERE id = $1 AND kind='rib'`, ['R:' + b.matRef])).rowCount) throw bad(`El ribbon «${b.matRef}» no existe.`);
      if (b.matType === 'Bolsa') b.matRef = 'BOLSA';
      if (['Otro', 'Directo'].includes(b.matType) && !b.matRef) throw bad('Describe el material.');
      if (['Etiqueta', 'Ribbon', 'Bolsa'].includes(b.matType) && !(b.qty > 0)) throw bad('La cantidad debe ser mayor a 0 para que entre al inventario.');
    },
  },
  supply: {
    entity: 'insumo_mov', table: 'supply_movements', dateCol: 'move_date', schema: supplySchema, map: supplyMap, searchCol: 'notes',
    lock: (r) => (r.po_line_id ? 'Este movimiento lo generó una orden de compra completada; anula la orden para revertirlo.' : null),
    check: async (b, c) => {
      if (!(await c.query(`SELECT 1 FROM inv_items WHERE id = $1 AND kind = 'ins'`, [b.itemId])).rowCount) throw bad('Selecciona un insumo del catálogo.');
      if (b.projectId && !(await c.query('SELECT 1 FROM projects WHERE id = $1', [b.projectId])).rowCount) throw bad('El proyecto no existe.');
      if (b.area && !AREAS.some((a) => a[0] === b.area)) throw bad('Área inválida.');
    },
  },
  scrap: {
    entity: 'merma', table: 'inventory_scrap', dateCol: 'scrap_date', schema: scrapSchema, map: scrapMap,
    check: async (b, c) => { if (!(await c.query(`SELECT 1 FROM inv_items WHERE id = $1 AND kind <> 'rib'`, [b.itemId])).rowCount) throw bad('Artículo de merma inválido (etiqueta o bolsa).'); },
  },
};
export type EntKey = keyof typeof ENTITIES;

const camel = (s: string) => s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
export const toApi = (row: Record<string, any>) => Object.fromEntries(Object.entries(row).filter(([k]) => k !== 'source_key').map(([k, v]) => [camel(k), v]));

function dbVals(e: Ent, b: any) {
  const cols: string[] = [], vals: unknown[] = [];
  for (const [k, col] of Object.entries(e.map)) if (k in b && b[k] !== undefined) { cols.push(col); vals.push(e.json?.includes(col) ? JSON.stringify(b[k]) : b[k]); }
  return { cols, vals };
}
async function assertDateOk(d: string, settings: Record<string, any>) {
  if (d > addDays(tzToday(), 7)) throw bad('La fecha no puede ser mayor a 7 días a futuro.');
  if (settings.inicio && d < settings.inicio) throw bad(`Los registros inician el ${settings.inicio}; la fecha es anterior.`);
}

export async function createRecord(key: EntKey, user: AuthUser, body: unknown) {
  const e = ENTITIES[key];
  return tx(async (c) => {
    const b: any = parse(e.schema, body), s = await getSettings(c);
    await assertDateOk(b.date, s);
    await e.check?.(b, c, s);
    derive(b, s);
    const status = b.status ?? 'confirmado';
    let sourceKey: string | null = null;
    if (e.keyed && e.natural) {
      const base = naturalKey(e.natural(b));
      let n = 1;
      const exist = await c.query(`SELECT id FROM ${e.table} WHERE source_key LIKE $1 AND status <> 'anulado' ORDER BY source_key`, [base + '#%']);
      if (exist.rowCount) {
        if (!b.allowDuplicate) throw conflict('DUPLICADO', 'Ya existe un registro idéntico. Si de verdad es otro, confirma el duplicado.', { existingId: exist.rows[0].id });
        if (!can(user.role, 'registro.confirmar')) throw new HttpError(403, 'SIN_PERMISO', 'Solo un supervisor puede registrar un duplicado intencional.');
        n = exist.rowCount! + 1;
      }
      sourceKey = base + '#' + n;
    }
    const { cols, vals } = dbVals(e, b);
    cols.push('status', 'created_by'); vals.push(status, user.id);
    if (e.table !== 'attendance') { cols.push('updated_by'); vals.push(user.id); }
    if (e.keyed) { cols.push('source', 'source_key'); vals.push('captura', sourceKey); }
    const r = await c.query(`INSERT INTO ${e.table} (${cols.join(',')}) VALUES (${cols.map((_, i) => '$' + (i + 1)).join(',')}) RETURNING *`, vals);
    await audit(c, user, e.entity, r.rows[0].id, 'crear', null, toApi(r.rows[0]));
    return toApi(r.rows[0]);
  });
}

export async function updateRecord(key: EntKey, user: AuthUser, id: string, body: any) {
  const e = ENTITIES[key];
  return tx(async (c) => {
    const cur = (await c.query(`SELECT * FROM ${e.table} WHERE id = $1 FOR UPDATE`, [id])).rows[0];
    if (!cur) throw notFound();
    if (cur.status === 'anulado') throw conflict('ANULADO', 'El registro está anulado y no puede editarse.');
    { const why = e.lock?.(cur); if (why) throw conflict('BLOQUEADO', why); }
    const own = cur.created_by === user.id && cur.status === 'borrador' && can(user.role, 'registro.editar_propio');
    if (!can(user.role, 'registro.editar') && !own) throw new HttpError(403, 'SIN_PERMISO', 'Solo puedes editar tus borradores.');
    const { version, reason, ...patch } = body ?? {};
    if (!Number.isInteger(version)) throw bad('Falta la versión del registro (para evitar pisar cambios de otra persona).');
    if (version !== cur.version) throw conflict('CONFLICTO_VERSION', 'Otra persona modificó este registro. Recarga y vuelve a intentar.', { actual: cur.version });
    if (cur.status === 'confirmado' && !coalesceReason(reason)) throw bad('Para editar un registro confirmado escribe el motivo del cambio.');
    // validar solo los campos enviados y mezclarlos con el registro actual
    const curApi: any = {}; for (const [k, col] of Object.entries(e.map)) if (cur[col] !== null && cur[col] !== undefined) curApi[k] = cur[col];
    const keys = Object.keys(patch), editable = Object.keys(e.schema.shape).filter((k) => k !== 'status' && k !== 'allowDuplicate');
    const unknown = keys.filter((k) => !editable.includes(k));
    if (unknown.length) throw bad(`Campos no editables: ${unknown.join(', ')}`);
    const parsedPatch: any = parse(e.schema.pick(Object.fromEntries(keys.map((k) => [k, true])) as any), patch);
    const full: any = { ...curApi, ...parsedPatch };
    const s = await getSettings(c);
    await assertDateOk(full.date, s);
    await e.check?.(full, c, s);
    derive(full, s);
    const sets: string[] = [], vals: unknown[] = [];
    for (const [k, col] of Object.entries(e.map)) if (k in full && JSON.stringify(full[k]) !== JSON.stringify(curApi[k])) { sets.push(`${col} = $${vals.length + 1}`); vals.push(e.json?.includes(col) ? JSON.stringify(full[k]) : full[k]); }
    if (!sets.length) return toApi(cur);
    if (e.keyed && e.natural) {
      const base = naturalKey(e.natural(full));
      const dup = await c.query(`SELECT id FROM ${e.table} WHERE source_key LIKE $1 AND status <> 'anulado' AND id <> $2`, [base + '#%', id]);
      if (dup.rowCount) throw conflict('DUPLICADO', 'Con ese cambio quedaría idéntico a otro registro existente.', { existingId: dup.rows[0].id });
      sets.push(`source_key = $${vals.length + 1}`); vals.push(base + '#1');
    }
    sets.push(`updated_by = $${vals.length + 1}`); vals.push(user.id);
    sets.push('updated_at = now()', 'version = version + 1');
    vals.push(id);
    const r = await c.query(`UPDATE ${e.table} SET ${sets.join(', ')} WHERE id = $${vals.length} RETURNING *`, vals);
    await audit(c, user, e.entity, id, 'editar', toApi(cur), toApi(r.rows[0]), reason);
    return toApi(r.rows[0]);
  });
}
const coalesceReason = (r: unknown) => (typeof r === 'string' && r.trim().length >= 5 ? r.trim() : null);

export async function voidRecord(key: EntKey, user: AuthUser, id: string, reason: unknown) {
  const e = ENTITIES[key];
  const why = coalesceReason(reason); if (!why) throw bad('La anulación requiere una justificación (mínimo 5 caracteres).');
  return tx(async (c) => {
    const cur = (await c.query(`SELECT * FROM ${e.table} WHERE id = $1 FOR UPDATE`, [id])).rows[0];
    if (!cur) throw notFound();
    if (cur.status === 'anulado') throw conflict('ANULADO', 'El registro ya estaba anulado.');
    { const why = e.lock?.(cur); if (why) throw conflict('BLOQUEADO', why); }
    const r = await c.query(`UPDATE ${e.table} SET status = 'anulado', void_reason = $2, voided_by = $3, voided_at = now(), version = version + 1 WHERE id = $1 RETURNING *`, [id, why, user.id]);
    await audit(c, user, e.entity, id, 'anular', toApi(cur), toApi(r.rows[0]), why);
    return toApi(r.rows[0]);
  });
}

export async function confirmRecord(key: EntKey, user: AuthUser, id: string) {
  const e = ENTITIES[key];
  return tx(async (c) => {
    const cur = (await c.query(`SELECT * FROM ${e.table} WHERE id = $1 FOR UPDATE`, [id])).rows[0];
    if (!cur) throw notFound();
    if (cur.status !== 'borrador') throw conflict('ESTADO', 'Solo los borradores se pueden confirmar.');
    if (!can(user.role, 'registro.confirmar') && cur.created_by !== user.id) throw new HttpError(403, 'SIN_PERMISO', 'Solo puedes confirmar tus propios borradores.');
    const r = await c.query(`UPDATE ${e.table} SET status = 'confirmado', version = version + 1 WHERE id = $1 RETURNING *`, [id]);
    await audit(c, user, e.entity, id, 'confirmar', { status: 'borrador' }, { status: 'confirmado' });
    return toApi(r.rows[0]);
  });
}

export interface ListQuery { from?: string; to?: string; kind?: string; status?: string; q?: string; project?: string; limit?: number; offset?: number }
export async function listRecords(key: EntKey, f: ListQuery) {
  const e = ENTITIES[key], where: string[] = [], vals: unknown[] = [];
  const add = (sql: string, v: unknown) => { vals.push(v); where.push(sql.replaceAll('?', '$' + vals.length)); };
  if (f.from) add(`${e.dateCol} >= ?`, f.from);
  if (f.to) add(`${e.dateCol} <= ?`, f.to);
  if (f.kind && 'kind' in e.map) { const ks = f.kind.split(',').filter(Boolean); if (ks.length > 1) add('kind = ANY(?::text[])', ks); else add('kind = ?', ks[0]); }
  if (f.project && 'projectId' in e.map) add('project_id = ANY(?::uuid[])', f.project.split(',').filter(Boolean));
  if (f.status) add('status = ?::record_status', f.status);
  if (f.q) add(`(coalesce(notes,'') ILIKE ? OR coalesce(${e.searchCol ?? (key === 'production' ? 'product_name' : key === 'hours' ? 'worker_name' : key === 'requirements' ? 'supplier' : 'reason')},'') ILIKE ?)`, '%' + f.q + '%');
  const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const lim = Math.min(Math.max(f.limit ?? 200, 1), 1000), off = Math.max(f.offset ?? 0, 0);
  const total = (await pool.query(`SELECT count(*)::int AS n FROM ${e.table} ${w}`, vals)).rows[0].n;
  const rows = (await pool.query(`SELECT * FROM ${e.table} ${w} ORDER BY ${e.dateCol} DESC, created_at DESC LIMIT ${lim} OFFSET ${off}`, vals)).rows;
  return { total, rows: rows.map(toApi) };
}
export async function getRecord(key: EntKey, id: string) {
  const r = await pool.query(`SELECT * FROM ${ENTITIES[key].table} WHERE id = $1`, [id]);
  if (!r.rowCount) throw notFound();
  return toApi(r.rows[0]);
}
