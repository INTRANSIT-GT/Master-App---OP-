// Maquilas: base operativa propia de Operaciones.
// Personas, programación (órdenes), asignaciones, inicio/cierre y visibilidad de secciones.
// La facturación NO vive aquí: la orden validada se agrupa en un cargo (fase posterior) y el
// número de factura se genera en el módulo comercial. Ver docs/10-maquilas-e-integracion.md.
import { z } from 'zod';
import { pool, tx, type Q } from '../db.js';
import type { AuthUser } from '../auth.js';
import { HttpError, bad, conflict, notFound } from '../http.js';
import { SECCIONES_MAQUILA, SECCION_KEYS, can, type SeccionMaquila } from '../permissions.js';
import { ROLES } from '../sso.js';
import { sedeDe } from '../sede.js';
import { audit } from './audit.js';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'fecha AAAA-MM-DD');
const isoDateTime = z.string().refine((s) => !isNaN(Date.parse(s)), 'fecha y hora inválidas');
const txt = (max = 200) => z.string().trim().max(max);
const num0 = z.coerce.number().finite().min(0);

export const personSchema = z.object({
  code: txt(30).min(1),
  name: txt(120).min(2),
  position: txt(80).optional().default(''),
  active: z.boolean().optional(),
}).strict();
export const personPatchSchema = personSchema.partial().strict();

export const orderSchema = z.object({
  date: isoDate,
  shift: z.enum(['DIA', 'TARDE', 'NOCHE']).default('DIA'),
  clientId: z.string().uuid(),
  projectId: z.string().uuid(),
  activityId: z.string().uuid().nullable().optional(),
  clientConfirmation: txt(300).optional(),
  sap: txt(40).optional(),
  productName: txt(200).optional(),
  unit: txt(20).optional(),
  targetQty: num0.default(0),
  notes: txt(500).optional(),
}).strict();
export const orderPatchSchema = orderSchema.partial().extend({
  clientId: z.string().uuid().optional(),
  projectId: z.string().uuid().optional(),
  version: z.number().int().optional(),
}).strict();

export const assignmentsSchema = z.object({
  personas: z.array(z.object({
    personId: z.string().uuid(),
    qtyAssigned: num0.default(0),
    qtyDone: num0.default(0),
    startedAt: isoDateTime.optional(),
    finishedAt: isoDateTime.optional(),
    notes: txt(300).optional(),
  })).max(300),
}).strict();

export const startSchema = z.object({ startedAt: isoDateTime.optional() }).strict();
// Confirmación que da el cliente antes de iniciar (p. ej. el exportador, o el producto y la fecha validados por WhatsApp).
export const confirmSchema = z.object({ text: txt(300).min(2), confirmedAt: isoDateTime.optional() }).strict();
export const closeSchema = z.object({
  producedQty: num0.optional(),
  producedDetail: z.record(z.string().trim().min(1).max(40), num0).optional(),   // por parte del desglose del proyecto (p. ej. cartón A/B/C)
  finishedAt: isoDateTime.optional(),
  notes: txt(500).optional(),
  personas: z.array(z.object({ personId: z.string().uuid(), qtyDone: num0 })).max(300).optional(),
  version: z.number().int().optional(),
}).strict();

export const validateSchema = z.object({
  decision: z.enum(['APROBADA', 'RECHAZADA']),
  reason: txt(500).optional(),
}).strict().refine((v) => v.decision !== 'RECHAZADA' || (v.reason?.trim().length ?? 0) >= 5,
  { message: 'El rechazo exige un motivo (mínimo 5 caracteres).', path: ['reason'] });

export const reopenSchema = z.object({ reason: txt(500).min(5) }).strict();

export const statementSchema = z.object({
  clientId: z.string().uuid().optional(),
  periodKind: z.enum(['SEMANA', 'MES', 'DEMANDA']),
  periodKey: txt(20).min(1),
  orderIds: z.array(z.string().uuid()).min(1).max(300),
  notes: txt(500).optional(),
}).strict();

export const annulSchema = z.object({ reason: txt(500).min(5) }).strict();

const r2 = (x: number) => Math.round(x * 100) / 100;

const ORDER_COLS = `o.id, o.order_date AS "date", o.shift, o.status, o.sap, o.product_name AS "productName",
  o.unit, o.target_qty AS "targetQty", o.produced_qty AS "producedQty",
  o.started_at AS "startedAt", o.finished_at AS "finishedAt", o.closed_at AS "closedAt",
  o.validated_at AS "validatedAt", o.statement_id AS "statementId", o.invoice_id AS "invoiceId",
  o.notes, o.version, o.client_id AS "clientId", c.name AS "clientName",
  o.project_id AS "projectId", p.name AS "projectName",
  o.activity_id AS "activityId", a.name AS "activityName", o.produced_detail AS "producedDetail",
  o.client_confirmation AS "clientConfirmation", o.confirmed_at AS "confirmedAt",
  p.category, p.alt_units AS "altUnits", p.confirm_label AS "confirmLabel", p.output_parts AS "outputParts", p.process_notes AS "processNotes",
  (SELECT count(*)::int FROM maquila_assignments a WHERE a.order_id = o.id AND a.active) AS "people"`;
const ORDER_FROM = `FROM maquila_orders o JOIN clients c ON c.id = o.client_id JOIN projects p ON p.id = o.project_id
  LEFT JOIN project_activities a ON a.id = o.activity_id`;

// El proyecto es del cliente y de la sede de la orden; la actividad es del proyecto y es obligatoria si el proyecto tiene actividades.
async function assertProject(c: Q, sede: string, clientId: string, projectId: string, activityId?: string | null) {
  const p = (await c.query(
    `SELECT p.id, p.name, p.um, p.alt_units, p.active, p.sede_id, c.name AS client_name, c.active AS client_active
     FROM projects p JOIN clients c ON c.id = p.client_id
     WHERE p.id = $1 AND p.client_id = $2`,
    [projectId, clientId],
  )).rows[0];
  if (!p) throw bad('El proyecto no pertenece al cliente seleccionado.');
  if (p.sede_id !== sede) throw bad(`El proyecto «${p.name}» es de otra sede.`);
  if (!p.active) throw bad(`El proyecto «${p.name}» está inactivo.`);
  if (!p.client_active) throw bad(`El cliente «${p.client_name}» está inactivo.`);
  if (activityId) {
    const a = (await c.query('SELECT name, active FROM project_activities WHERE id = $1 AND project_id = $2', [activityId, projectId])).rows[0];
    if (!a) throw bad(`La actividad no pertenece al proyecto «${p.name}».`);
    if (!a.active) throw bad(`La actividad «${a.name}» está inactiva.`);
  } else if ((await c.query('SELECT 1 FROM project_activities WHERE project_id = $1 AND active', [projectId])).rowCount) {
    throw bad(`Selecciona la actividad de «${p.name}».`);
  }
  return p;
}

// Si el proyecto admite otras unidades (p. ej. Cebollines: packs o bandejas), la orden usa una de ellas.
function assertUnit(p: { name: string; um: string; alt_units: string[] }, unit: string) {
  const ok = [p.um, ...(p.alt_units ?? [])].map((x) => x.toUpperCase());
  if (p.alt_units?.length && !ok.includes(unit.toUpperCase())) throw bad(`«${p.name}» se registra en ${ok.join(' o ')}.`);
}

// ───────── personas ─────────
export async function listPeople(sede: string, f: { q?: string; active?: boolean; limit?: number }) {
  const limit = Math.min(Math.max(f.limit ?? 200, 1), 500);
  return (await pool.query(
    `SELECT id, code, name, position, active, source, external_ref AS "externalRef", synced_at AS "syncedAt"
     FROM maquila_people
     WHERE sede_id = $1 AND ($2::boolean IS NULL OR active = $2)
       AND ($3 = '' OR name ILIKE '%' || $3 || '%' OR code ILIKE '%' || $3 || '%')
     ORDER BY active DESC, name LIMIT $4`,
    [sede, f.active ?? null, (f.q ?? '').trim(), limit],
  )).rows;
}

export async function createPerson(user: AuthUser, b: z.infer<typeof personSchema>) {
  const sede = sedeDe(user);
  const row = await tx(async (c) => {
    const dup = await c.query('SELECT 1 FROM maquila_people WHERE sede_id = $1 AND upper(code) = upper($2)', [sede, b.code]);
    if (dup.rowCount) throw conflict('DUPLICADO', `Ya existe una persona con el código ${b.code} en esta sede.`);
    const r = await c.query(
      `INSERT INTO maquila_people (sede_id, code, name, position, active)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING id, code, name, position, active, source, external_ref AS "externalRef", synced_at AS "syncedAt"`,
      [sede, b.code, b.name, b.position ?? '', b.active ?? true],
    );
    await audit(c, user, 'maquila_persona', r.rows[0].id, 'crear', null, r.rows[0]);
    return r.rows[0];
  });
  return row;
}

export async function updatePerson(user: AuthUser, id: string, b: z.infer<typeof personPatchSchema>) {
  const sede = sedeDe(user);
  return tx(async (c) => {
    const cur = (await c.query('SELECT id, code, name, position, active FROM maquila_people WHERE id = $1 AND sede_id = $2 FOR UPDATE', [id, sede])).rows[0];
    if (!cur) throw notFound('Persona de maquila');
    if (b.code && b.code !== cur.code) {
      const dup = await c.query('SELECT 1 FROM maquila_people WHERE sede_id = $1 AND upper(code) = upper($2) AND id <> $3', [sede, b.code, id]);
      if (dup.rowCount) throw conflict('DUPLICADO', `Ya existe una persona con el código ${b.code} en esta sede.`);
    }
    const r = await c.query(
      `UPDATE maquila_people SET
         code = CASE WHEN $3::text IS NULL THEN code ELSE $3 END,
         name = CASE WHEN $4::text IS NULL THEN name ELSE $4 END,
         position = CASE WHEN $5::text IS NULL THEN position ELSE $5 END,
         active = coalesce($6::boolean, active), updated_at = now()
       WHERE id = $1 AND sede_id = $2
       RETURNING id, code, name, position, active, source, external_ref AS "externalRef", synced_at AS "syncedAt"`,
      [id, sede, b.code ?? null, b.name ?? null, b.position ?? null, b.active ?? null],
    );
    await audit(c, user, 'maquila_persona', id, 'editar', cur, r.rows[0]);
    return r.rows[0];
  });
}

// ───────── órdenes ─────────
export async function listOrders(sede: string, f: { from?: string; to?: string; status?: string; clientId?: string; projectId?: string; q?: string; limit?: number; offset?: number }) {
  const limit = Math.min(Math.max(f.limit ?? 100, 1), 200), offset = Math.max(f.offset ?? 0, 0);
  const r = await pool.query(
    `SELECT ${ORDER_COLS} ${ORDER_FROM}
     WHERE o.sede_id = $1
       AND ($2::date IS NULL OR o.order_date >= $2) AND ($3::date IS NULL OR o.order_date <= $3)
       AND ($4::text IS NULL OR o.status = $4)
       AND ($5::uuid IS NULL OR o.client_id = $5) AND ($6::uuid IS NULL OR o.project_id = $6)
       AND ($7 = '' OR o.sap ILIKE '%' || $7 || '%' OR o.product_name ILIKE '%' || $7 || '%' OR c.name ILIKE '%' || $7 || '%' OR p.name ILIKE '%' || $7 || '%')
     ORDER BY o.order_date DESC, o.created_at DESC LIMIT $8 OFFSET $9`,
    [sede, f.from ?? null, f.to ?? null, f.status ?? null, f.clientId ?? null, f.projectId ?? null, (f.q ?? '').trim(), limit + 1, offset],
  );
  return { rows: r.rows.slice(0, limit), hasMore: r.rows.length > limit };
}

export async function getOrder(sede: string, id: string) {
  const o = (await pool.query(`SELECT ${ORDER_COLS} ${ORDER_FROM} WHERE o.id = $1 AND o.sede_id = $2`, [id, sede])).rows[0];
  if (!o) throw notFound('Orden de maquila');
  const [asg, val] = await Promise.all([
    pool.query(
      `SELECT a.id, a.person_id AS "personId", mp.name AS "personName", mp.code AS "personCode",
              a.qty_assigned AS "qtyAssigned", a.qty_done AS "qtyDone",
              a.started_at AS "startedAt", a.finished_at AS "finishedAt", a.active, a.notes
       FROM maquila_assignments a JOIN maquila_people mp ON mp.id = a.person_id
       WHERE a.order_id = $1 ORDER BY a.active DESC, mp.name`, [id]),
    pool.query(
      `SELECT v.id, v.stage, v.decision, v.reason, v.user_id AS "userId", u.name AS "userName", v.created_at AS "at"
       FROM maquila_validations v LEFT JOIN users u ON u.id = v.user_id
       WHERE v.order_id = $1 ORDER BY v.created_at`, [id]),
  ]);
  return { ...o, assignments: asg.rows, validations: val.rows };
}

export async function createOrder(user: AuthUser, b: z.infer<typeof orderSchema>) {
  const sede = sedeDe(user);
  const id = await tx(async (c) => {
    const p = await assertProject(c, sede, b.clientId, b.projectId, b.activityId);
    assertUnit(p, b.unit || p.um);
    const conf = b.clientConfirmation?.trim() || null;
    const r = await c.query(
      `INSERT INTO maquila_orders (sede_id, client_id, project_id, activity_id, order_date, shift, sap, product_name, unit, target_qty, notes, status, created_by,
                                   client_confirmation, confirmed_at, confirmed_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'PROGRAMADA',$12,$13::text,
               CASE WHEN $13::text IS NULL THEN NULL ELSE now() END, CASE WHEN $13::text IS NULL THEN NULL ELSE $12::uuid END) RETURNING id`,
      [sede, b.clientId, b.projectId, b.activityId || null, b.date, b.shift, b.sap || null, b.productName || null, (b.unit || p.um).toUpperCase(), b.targetQty, b.notes || null, user.id, conf],
    );
    await audit(c, user, 'maquila_orden', r.rows[0].id, 'crear', null, { ...b, sede });
    return r.rows[0].id as string;
  });
  return getOrder(sede, id);
}

export async function updateOrder(user: AuthUser, id: string, b: z.infer<typeof orderPatchSchema>) {
  const sede = sedeDe(user);
  await tx(async (c) => {
    const cur = (await c.query('SELECT * FROM maquila_orders WHERE id = $1 AND sede_id = $2 FOR UPDATE', [id, sede])).rows[0];
    if (!cur) throw notFound('Orden de maquila');
    if (!['PROGRAMADA', 'EN_PROCESO'].includes(cur.status)) throw conflict('ESTADO_INVALIDO', 'Solo se edita una orden programada o en proceso.');
    if (b.version !== undefined && b.version !== cur.version) throw conflict('CONFLICTO_VERSION', 'Otra persona modificó esta orden. Recarga.');
    const clientId = b.clientId ?? cur.client_id, projectId = b.projectId ?? cur.project_id;
    // al cambiar de proyecto, la actividad anterior deja de valer si no se envía otra
    const activityId = b.activityId !== undefined ? b.activityId || null : projectId !== cur.project_id ? null : cur.activity_id;
    if (b.clientId || b.projectId || b.activityId !== undefined || b.unit) {
      const p = await assertProject(c, sede, clientId, projectId, activityId);
      assertUnit(p, b.unit ?? cur.unit);
    }
    const r = await c.query(
      `UPDATE maquila_orders SET
         order_date = coalesce($3::date, order_date), shift = coalesce($4, shift),
         sap = CASE WHEN $5::text IS NULL THEN sap ELSE $5 END,
         product_name = CASE WHEN $6::text IS NULL THEN product_name ELSE $6 END,
         unit = CASE WHEN $7::text IS NULL THEN unit ELSE $7 END,
         target_qty = coalesce($8::numeric, target_qty),
         notes = CASE WHEN $9::text IS NULL THEN notes ELSE $9 END,
         client_id = coalesce($10::uuid, client_id), project_id = coalesce($11::uuid, project_id), activity_id = $12::uuid,
         version = version + 1, updated_at = now()
       WHERE id = $1 AND sede_id = $2 RETURNING *`,
      [id, sede, b.date ?? null, b.shift ?? null, b.sap ?? null, b.productName ?? null, b.unit ?? null, b.targetQty ?? null, b.notes ?? null, b.clientId ?? null, b.projectId ?? null, activityId],
    );
    await audit(c, user, 'maquila_orden', id, 'editar', cur, r.rows[0]);
  });
  return getOrder(sede, id);
}

// ───────── asignaciones ─────────
export async function replaceAssignments(user: AuthUser, orderId: string, b: z.infer<typeof assignmentsSchema>) {
  const sede = sedeDe(user);
  await tx(async (c) => {
    const cur = (await c.query('SELECT * FROM maquila_orders WHERE id = $1 AND sede_id = $2 FOR UPDATE', [orderId, sede])).rows[0];
    if (!cur) throw notFound('Orden de maquila');
    if (!['PROGRAMADA', 'EN_PROCESO'].includes(cur.status)) throw conflict('ESTADO_INVALIDO', 'Solo se asignan personas a una orden programada o en proceso.');
    const ids = [...new Set(b.personas.map((p) => p.personId))];
    if (ids.length !== b.personas.length) throw bad('La lista tiene personas repetidas.');
    if (ids.length) {
      const ok = (await c.query('SELECT id FROM maquila_people WHERE sede_id = $1 AND id = ANY($2::uuid[]) AND active', [sede, ids])).rows.map((r) => r.id);
      const missing = ids.filter((x) => !ok.includes(x));
      if (missing.length) throw bad(`Persona inexistente, inactiva o de otra sede: ${missing.join(', ')}`);
    }
    await c.query('UPDATE maquila_assignments SET active = false, updated_at = now() WHERE order_id = $1 AND active AND NOT (person_id = ANY($2::uuid[]))', [orderId, ids]);
    for (const p of b.personas) {
      await c.query(
        `INSERT INTO maquila_assignments (order_id, person_id, qty_assigned, qty_done, started_at, finished_at, notes, created_by)
         VALUES ($1,$2,$3,$4,$5::timestamptz,$6::timestamptz,$7,$8)
         ON CONFLICT (order_id, person_id) WHERE active
         DO UPDATE SET qty_assigned = excluded.qty_assigned, qty_done = excluded.qty_done,
           started_at = excluded.started_at, finished_at = excluded.finished_at, notes = excluded.notes, updated_at = now()`,
        [orderId, p.personId, p.qtyAssigned, p.qtyDone, p.startedAt ?? null, p.finishedAt ?? null, p.notes ?? null, user.id],
      );
    }
    await audit(c, user, 'maquila_orden', orderId, 'asignar', null, { personas: b.personas });
  });
  return getOrder(sede, orderId);
}

// ───────── inicio y cierre ─────────
export async function startOrder(user: AuthUser, id: string, startedAt?: string) {
  const sede = sedeDe(user);
  await tx(async (c) => {
    const cur = (await c.query('SELECT * FROM maquila_orders WHERE id = $1 AND sede_id = $2 FOR UPDATE', [id, sede])).rows[0];
    if (!cur) throw notFound('Orden de maquila');
    if (cur.status === 'EN_PROCESO') return;
    if (cur.status !== 'PROGRAMADA') throw conflict('ESTADO_INVALIDO', 'Solo se inicia una orden programada.');
    const label = (await c.query('SELECT confirm_label FROM projects WHERE id = $1', [cur.project_id])).rows[0]?.confirm_label;
    if (label && !cur.client_confirmation) throw conflict('FALTA_CONFIRMACION', `Antes de iniciar registra la confirmación del cliente: ${label.toLowerCase()}.`);
    const at = startedAt ? new Date(startedAt) : new Date();
    await c.query('UPDATE maquila_orders SET status = $3, started_at = $4, version = version + 1, updated_at = now() WHERE id = $1 AND sede_id = $2', [id, sede, 'EN_PROCESO', at]);
    await c.query('UPDATE maquila_assignments SET started_at = coalesce(started_at, $2), updated_at = now() WHERE order_id = $1 AND active', [id, at]);
    await audit(c, user, 'maquila_orden', id, 'iniciar', { status: cur.status }, { status: 'EN_PROCESO', startedAt: at.toISOString() });
  });
  return getOrder(sede, id);
}

export async function confirmOrder(user: AuthUser, id: string, b: z.infer<typeof confirmSchema>) {
  const sede = sedeDe(user);
  await tx(async (c) => {
    const cur = (await c.query('SELECT * FROM maquila_orders WHERE id = $1 AND sede_id = $2 FOR UPDATE', [id, sede])).rows[0];
    if (!cur) throw notFound('Orden de maquila');
    if (!['PROGRAMADA', 'EN_PROCESO'].includes(cur.status)) throw conflict('ESTADO_INVALIDO', 'La confirmación del cliente se registra en una orden programada o en proceso.');
    const at = b.confirmedAt ? new Date(b.confirmedAt) : new Date();
    await c.query(`UPDATE maquila_orders SET client_confirmation = $3, confirmed_at = $4, confirmed_by = $5, version = version + 1, updated_at = now()
      WHERE id = $1 AND sede_id = $2`, [id, sede, b.text.trim(), at, user.id]);
    await audit(c, user, 'maquila_orden', id, 'confirmar_cliente', { clientConfirmation: cur.client_confirmation }, { clientConfirmation: b.text.trim(), confirmedAt: at.toISOString() });
  });
  return getOrder(sede, id);
}

export async function closeOrder(user: AuthUser, id: string, b: z.infer<typeof closeSchema>) {
  const sede = sedeDe(user);
  await tx(async (c) => {
    const cur = (await c.query('SELECT * FROM maquila_orders WHERE id = $1 AND sede_id = $2 FOR UPDATE', [id, sede])).rows[0];
    if (!cur) throw notFound('Orden de maquila');
    if (cur.status !== 'EN_PROCESO') throw conflict('ESTADO_INVALIDO', 'Solo se cierra una orden en proceso.');
    if (b.version !== undefined && b.version !== cur.version) throw conflict('CONFLICTO_VERSION', 'Otra persona modificó esta orden. Recarga.');
    if (!cur.started_at) throw bad('La orden no tiene hora de inicio.');
    const fin = b.finishedAt ? new Date(b.finishedAt) : new Date();
    if (!(fin.getTime() > new Date(cur.started_at).getTime())) throw bad('La hora de fin debe ser posterior a la de inicio.');
    for (const p of b.personas ?? []) {
      const r = await c.query('UPDATE maquila_assignments SET qty_done = $3, updated_at = now() WHERE order_id = $1 AND person_id = $2 AND active', [id, p.personId, p.qtyDone]);
      if (!r.rowCount) throw bad('La persona no está asignada a esta orden.');
    }
    // Con desglose (p. ej. cartón A/B/C) la cantidad producida es la suma de sus partes.
    const parts: string[] = (await c.query('SELECT output_parts FROM projects WHERE id = $1', [cur.project_id])).rows[0]?.output_parts ?? [];
    let detail: Record<string, number> = {}, produced: number;
    if (parts.length) {
      if (!b.producedDetail) throw bad(`Indica la cantidad de cada parte: ${parts.join(', ')}.`);
      const extra = Object.keys(b.producedDetail).filter((k) => !parts.includes(k));
      if (extra.length) throw bad(`Partes que no son del proyecto: ${extra.join(', ')}.`);
      detail = Object.fromEntries(parts.map((k) => [k, b.producedDetail![k] ?? 0]));
      produced = r2(Object.values(detail).reduce((a, x) => a + x, 0));
      if (b.producedQty !== undefined && r2(b.producedQty) !== produced) throw bad(`La cantidad producida (${b.producedQty}) no coincide con la suma del desglose (${produced}).`);
    } else {
      if (b.producedDetail && Object.keys(b.producedDetail).length) throw bad('Este proyecto no tiene desglose de la cantidad producida.');
      produced = b.producedQty ?? Number((await c.query('SELECT coalesce(sum(qty_done),0) AS q FROM maquila_assignments WHERE order_id = $1 AND active', [id])).rows[0].q);
    }
    const r = await c.query(
      `UPDATE maquila_orders SET status = 'CERRADA', produced_qty = $3, produced_detail = $7::jsonb, finished_at = $4, closed_at = now(), closed_by = $5,
         notes = CASE WHEN $6::text IS NULL THEN notes ELSE $6 END, version = version + 1, updated_at = now()
       WHERE id = $1 AND sede_id = $2 RETURNING *`,
      [id, sede, produced, fin, user.id, b.notes ?? null, JSON.stringify(detail)],
    );
    await audit(c, user, 'maquila_orden', id, 'cerrar', { status: cur.status, producedQty: cur.produced_qty }, r.rows[0]);
  });
  return getOrder(sede, id);
}

// ───────── por facturar y secciones ─────────
export async function listPorFacturar(sede: string, f: { from?: string; to?: string; clientId?: string; projectId?: string; limit?: number }) {
  const limit = Math.min(Math.max(f.limit ?? 200, 1), 500);
  return (await pool.query(
    `SELECT id, client_id AS "clientId", client_name AS "clientName", project_id AS "projectId", project_name AS "projectName",
            activity_name AS "activityName", produced_detail AS "producedDetail", order_date AS "date", shift, sap, product_name AS "productName", unit, produced_qty AS "producedQty", validated_at AS "validatedAt"
     FROM maquila_por_facturar
     WHERE sede_id = $1
       AND ($2::date IS NULL OR order_date >= $2) AND ($3::date IS NULL OR order_date <= $3)
       AND ($4::uuid IS NULL OR client_id = $4) AND ($5::uuid IS NULL OR project_id = $5)
     ORDER BY order_date, client_name LIMIT $6`,
    [sede, f.from ?? null, f.to ?? null, f.clientId ?? null, f.projectId ?? null, limit],
  )).rows;
}

// ───────── validaciones ─────────
const ETAPA = {
  SOP: { desde: 'CERRADA', hacia: 'VALIDADA_SOP' },
  JEFATURA: { desde: 'VALIDADA_SOP', hacia: 'VALIDADA_JEFATURA' },
  VALIDADOR: { desde: 'VALIDADA_JEFATURA', hacia: 'VALIDADA' },
} as const;
export type Etapa = keyof typeof ETAPA;

export async function validateOrder(user: AuthUser, id: string, etapa: Etapa, b: z.infer<typeof validateSchema>) {
  const sede = sedeDe(user);
  await tx(async (c) => {
    const cur = (await c.query('SELECT * FROM maquila_orders WHERE id = $1 AND sede_id = $2 FOR UPDATE', [id, sede])).rows[0];
    if (!cur) throw notFound('Orden de maquila');
    const t = ETAPA[etapa];
    if (cur.status !== t.desde) throw conflict('ESTADO_INVALIDO', `La orden está en ${cur.status}; para ${etapa} debe estar en ${t.desde}.`);
    if (b.decision === 'RECHAZADA' && (b.reason?.trim().length ?? 0) < 5) throw bad('El rechazo exige un motivo (mínimo 5 caracteres).');
    await c.query('INSERT INTO maquila_validations (order_id, stage, decision, reason, user_id) VALUES ($1,$2,$3,$4,$5)',
      [id, etapa, b.decision, b.reason?.trim() || null, user.id]);
    const status = b.decision === 'APROBADA' ? t.hacia : 'RECHAZADA';
    const final = etapa === 'VALIDADOR' && b.decision === 'APROBADA';
    await c.query(`UPDATE maquila_orders SET status = $3,
        validated_at = CASE WHEN $4::boolean THEN now() ELSE NULL END,
        validated_by = CASE WHEN $4::boolean THEN $5::uuid ELSE NULL END,
        version = version + 1, updated_at = now()
      WHERE id = $1 AND sede_id = $2`, [id, sede, status, final, user.id]);
    await audit(c, user, 'maquila_orden', id, b.decision === 'APROBADA' ? `validar_${etapa.toLowerCase()}` : `rechazar_${etapa.toLowerCase()}`,
      { status: cur.status }, { status, decision: b.decision, reason: b.reason?.trim() || null });
  });
  return getOrder(sede, id);
}

export async function reopenOrder(user: AuthUser, id: string, reason: string) {
  const sede = sedeDe(user);
  await tx(async (c) => {
    const cur = (await c.query('SELECT * FROM maquila_orders WHERE id = $1 AND sede_id = $2 FOR UPDATE', [id, sede])).rows[0];
    if (!cur) throw notFound('Orden de maquila');
    if (['EN_CARGO', 'FACTURADA', 'COBRADA'].includes(cur.status)) throw conflict('ESTADO_INVALIDO', 'Anula el cargo o la factura antes de reabrir esta maquila.');
    if (!['RECHAZADA', 'VALIDADA_SOP', 'VALIDADA_JEFATURA', 'VALIDADA'].includes(cur.status)) throw conflict('ESTADO_INVALIDO', 'Solo se reabre una maquila rechazada o validada.');
    if (cur.status !== 'RECHAZADA' && !can(user.role, 'maquila.reabrir')) throw new HttpError(403, 'SIN_PERMISO', 'Tu rol no puede reabrir una maquila ya validada.');
    await c.query(`UPDATE maquila_orders SET status = 'EN_PROCESO', finished_at = NULL, closed_at = NULL, closed_by = NULL,
        validated_at = NULL, validated_by = NULL, version = version + 1, updated_at = now()
      WHERE id = $1 AND sede_id = $2`, [id, sede]);
    await audit(c, user, 'maquila_orden', id, 'reabrir', { status: cur.status }, { status: 'EN_PROCESO', reason });
  });
  return getOrder(sede, id);
}

export async function listValidacion(sede: string, f: { from?: string; to?: string; limit?: number }) {
  const limit = Math.min(Math.max(f.limit ?? 200, 1), 200);
  const out: Record<'SOP' | 'JEFATURA' | 'VALIDADOR' | 'RECHAZADA', any[]> = { SOP: [], JEFATURA: [], VALIDADOR: [], RECHAZADA: [] };
  const stages: [keyof typeof out, string][] = [['SOP', 'CERRADA'], ['JEFATURA', 'VALIDADA_SOP'], ['VALIDADOR', 'VALIDADA_JEFATURA'], ['RECHAZADA', 'RECHAZADA']];
  for (const [key, status] of stages) {
    out[key] = (await pool.query(
      `SELECT ${ORDER_COLS} ${ORDER_FROM}
       WHERE o.sede_id = $1 AND o.status = $2
         AND ($3::date IS NULL OR o.order_date >= $3) AND ($4::date IS NULL OR o.order_date <= $4)
       ORDER BY o.order_date, o.created_at LIMIT $5`,
      [sede, status, f.from ?? null, f.to ?? null, limit],
    )).rows;
  }
  return out;
}

// ───────── cargos de facturación ─────────
export async function createStatement(user: AuthUser, b: z.infer<typeof statementSchema>) {
  const sede = sedeDe(user);
  const id = await tx(async (c) => {
    const ids = [...new Set(b.orderIds)];
    if (ids.length !== b.orderIds.length) throw bad('La selección contiene maquilas repetidas.');
    const orders = (await c.query('SELECT * FROM maquila_orders WHERE sede_id = $1 AND id = ANY($2::uuid[]) FOR UPDATE', [sede, ids])).rows;
    if (orders.length !== ids.length) throw bad('Alguna maquila no existe o es de otra sede.');
    const clientId = b.clientId ?? orders[0].client_id;
    if (orders.some((o) => o.client_id !== clientId)) throw bad('Todas las maquilas del cargo deben ser del mismo cliente.');
    for (const o of orders) {
      if (o.status !== 'VALIDADA') throw conflict('ESTADO_INVALIDO', `La maquila ${o.id} no está validada (${o.status}).`);
      if (o.statement_id) throw conflict('ESTADO_INVALIDO', `La maquila ${o.id} ya está en un cargo.`);
    }
    const dup = await c.query(`SELECT id FROM maquila_statements WHERE sede_id = $1 AND client_id = $2 AND period_kind = $3 AND period_key = $4 AND status <> 'ANULADO'`, [sede, clientId, b.periodKind, b.periodKey]);
    if (dup.rowCount) throw conflict('DUPLICADO', 'Ya existe un cargo para ese cliente y periodo.');
    const lineas: { orderId: string; qty: number; rate: number; amount: number }[] = [];
    for (const o of orders) {
      const rate = (await c.query(`SELECT rate FROM billing_rates WHERE project_id = $1 AND $2::date BETWEEN valid_from AND coalesce(valid_to, 'infinity'::date) ORDER BY valid_from DESC LIMIT 1`, [o.project_id, o.order_date])).rows[0];
      if (!rate) throw bad(`La maquila ${o.id} no tiene tarifa vigente para su fecha (${o.order_date}). Define la tarifa en Comercial › Tarifas.`);
      const qty = Number(o.produced_qty), amount = r2(qty * Number(rate.rate));
      lineas.push({ orderId: o.id, qty, rate: Number(rate.rate), amount });
    }
    const total = r2(lineas.reduce((a, l) => a + l.amount, 0));
    const st = (await c.query(`INSERT INTO maquila_statements (sede_id, client_id, period_kind, period_key, status, total, notes, created_by)
        VALUES ($1,$2,$3,$4,'ABIERTO',$5,$6,$7) RETURNING id`, [sede, clientId, b.periodKind, b.periodKey, total, b.notes || null, user.id])).rows[0];
    for (const l of lineas) {
      await c.query('INSERT INTO maquila_statement_lines (statement_id, order_id, qty, rate, amount) VALUES ($1,$2,$3,$4,$5)', [st.id, l.orderId, l.qty, l.rate, l.amount]);
      await c.query(`UPDATE maquila_orders SET statement_id = $2, status = 'EN_CARGO', version = version + 1, updated_at = now() WHERE id = $1`, [l.orderId, st.id]);
    }
    await audit(c, user, 'maquila_cargo', st.id, 'crear', null, { clientId, periodKind: b.periodKind, periodKey: b.periodKey, total, orders: ids });
    return st.id as string;
  });
  return getStatement(sede, id);
}

export async function listStatements(sede: string, f: { status?: string; clientId?: string; limit?: number }) {
  const limit = Math.min(Math.max(f.limit ?? 100, 1), 200);
  return (await pool.query(
    `SELECT s.id, s.client_id AS "clientId", c.name AS "clientName", s.period_kind AS "periodKind", s.period_key AS "periodKey",
            s.status, s.total, s.invoice_id AS "invoiceId", s.closed_at AS "closedAt", s.void_reason AS "voidReason", s.created_at AS "createdAt",
            (SELECT count(*)::int FROM maquila_statement_lines l WHERE l.statement_id = s.id AND l.active) AS "lines"
     FROM maquila_statements s JOIN clients c ON c.id = s.client_id
     WHERE s.sede_id = $1 AND ($2::text IS NULL OR s.status = $2) AND ($3::uuid IS NULL OR s.client_id = $3)
     ORDER BY s.created_at DESC LIMIT $4`, [sede, f.status ?? null, f.clientId ?? null, limit])).rows;
}

export async function getStatement(sede: string, id: string) {
  const s = (await pool.query(`SELECT s.id, s.client_id AS "clientId", c.name AS "clientName", s.period_kind AS "periodKind", s.period_key AS "periodKey",
      s.status, s.total, s.invoice_id AS "invoiceId", s.closed_at AS "closedAt", s.void_reason AS "voidReason", s.created_at AS "createdAt"
    FROM maquila_statements s JOIN clients c ON c.id = s.client_id WHERE s.id = $1 AND s.sede_id = $2`, [id, sede])).rows[0];
  if (!s) throw notFound('Cargo de maquila');
  const lines = (await pool.query(`SELECT l.id, l.order_id AS "orderId", l.qty, l.rate, l.amount, l.active,
      o.order_date AS "date", o.sap, o.product_name AS "productName", o.unit, o.produced_qty AS "producedQty",
      o.produced_detail AS "producedDetail", a.name AS "activityName"
    FROM maquila_statement_lines l JOIN maquila_orders o ON o.id = l.order_id LEFT JOIN project_activities a ON a.id = o.activity_id
    WHERE l.statement_id = $1 ORDER BY o.order_date`, [id])).rows;
  return { ...s, lines };
}

export async function closeStatement(user: AuthUser, id: string) {
  const sede = sedeDe(user);
  await tx(async (c) => {
    const cur = (await c.query('SELECT * FROM maquila_statements WHERE id = $1 AND sede_id = $2 FOR UPDATE', [id, sede])).rows[0];
    if (!cur) throw notFound('Cargo de maquila');
    if (cur.status !== 'ABIERTO') throw conflict('ESTADO_INVALIDO', 'Solo se cierra un cargo abierto.');
    if (!(Number(cur.total) > 0)) throw bad('El cargo no tiene importe; revisa las tarifas antes de cerrarlo.');
    await c.query(`UPDATE maquila_statements SET status = 'CERRADO', closed_at = now(), closed_by = $3, updated_at = now() WHERE id = $1 AND sede_id = $2`, [id, sede, user.id]);
    await audit(c, user, 'maquila_cargo', id, 'cerrar', { status: cur.status }, { status: 'CERRADO', total: cur.total });
  });
  return getStatement(sede, id);
}

export async function annulStatement(user: AuthUser, id: string, reason: string) {
  const sede = sedeDe(user);
  await tx(async (c) => {
    const cur = (await c.query('SELECT * FROM maquila_statements WHERE id = $1 AND sede_id = $2 FOR UPDATE', [id, sede])).rows[0];
    if (!cur) throw notFound('Cargo de maquila');
    if (['FACTURADO', 'COBRADO'].includes(cur.status)) throw conflict('ESTADO_INVALIDO', 'Un cargo facturado o cobrado se anula desde el módulo comercial.');
    if (cur.status === 'ANULADO') throw conflict('ESTADO_INVALIDO', 'El cargo ya está anulado.');
    await c.query(`UPDATE maquila_statements SET status = 'ANULADO', void_reason = $3, voided_by = $4, voided_at = now(), updated_at = now() WHERE id = $1 AND sede_id = $2`, [id, sede, reason.trim(), user.id]);
    await c.query('UPDATE maquila_statement_lines SET active = false WHERE statement_id = $1 AND active', [id]);
    await c.query(`UPDATE maquila_orders SET statement_id = NULL, status = 'VALIDADA', version = version + 1, updated_at = now() WHERE statement_id = $1`, [id]);
    await audit(c, user, 'maquila_cargo', id, 'anular', { status: cur.status }, { status: 'ANULADO', reason: reason.trim() });
  });
  return getStatement(sede, id);
}

export async function seccionesDe(role: string): Promise<SeccionMaquila[]> {
  const off = new Set((await pool.query('SELECT seccion FROM perfil_secciones WHERE perfil = $1 AND NOT habilitado', [role])).rows.map((r) => r.seccion));
  return SECCION_KEYS.filter((k) => !off.has(k));
}

export async function matrizSecciones() {
  const rows = (await pool.query('SELECT perfil, seccion, habilitado FROM perfil_secciones')).rows;
  const map = new Map<string, Map<string, boolean>>();
  for (const r of rows) { if (!map.has(r.perfil)) map.set(r.perfil, new Map()); map.get(r.perfil)!.set(r.seccion, r.habilitado); }
  return {
    perfiles: ROLES.map((r) => ({ key: r, label: r })),
    secciones: SECCIONES_MAQUILA.map(([key, label]) => ({ key, label })),
    matriz: ROLES.map((perfil) => ({ perfil, secciones: Object.fromEntries(SECCION_KEYS.map((s) => [s, map.get(perfil)?.get(s) ?? true])) })),
  };
}

export async function setSeccion(user: AuthUser, perfil: string, seccion: string, habilitado: boolean) {
  if (!(ROLES as string[]).includes(perfil)) throw bad('Perfil no válido.');
  if (!SECCION_KEYS.includes(seccion as SeccionMaquila)) throw bad('Sección no válida.');
  await tx(async (c) => {
    const prev = (await c.query('SELECT habilitado FROM perfil_secciones WHERE perfil = $1 AND seccion = $2', [perfil, seccion])).rows[0];
    await c.query(
      `INSERT INTO perfil_secciones (perfil, seccion, habilitado, updated_by) VALUES ($1,$2,$3,$4)
       ON CONFLICT (perfil, seccion) DO UPDATE SET habilitado = excluded.habilitado, updated_by = excluded.updated_by, updated_at = now()`,
      [perfil, seccion, habilitado, user.id],
    );
    await audit(c, user, 'maquila_seccion', `${perfil}/${seccion}`, 'editar', prev ?? { habilitado: true }, { habilitado });
  });
  return { perfil, seccion, habilitado };
}
