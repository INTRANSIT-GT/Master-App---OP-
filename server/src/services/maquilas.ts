// Maquilas: base operativa propia de Operaciones.
// Personas, programación (órdenes), asignaciones, inicio/cierre y visibilidad de secciones.
// La facturación NO vive aquí: la orden validada se agrupa en un cargo (fase posterior) y el
// número de factura se genera en el módulo comercial. Ver docs/10-maquilas-e-integracion.md.
import { z } from 'zod';
import { pool, tx, type Q } from '../db.js';
import type { AuthUser } from '../auth.js';
import { bad, conflict, notFound } from '../http.js';
import { SECCIONES_MAQUILA, SECCION_KEYS, type SeccionMaquila } from '../permissions.js';
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
export const closeSchema = z.object({
  producedQty: num0.optional(),
  finishedAt: isoDateTime.optional(),
  notes: txt(500).optional(),
  personas: z.array(z.object({ personId: z.string().uuid(), qtyDone: num0 })).max(300).optional(),
  version: z.number().int().optional(),
}).strict();

const ORDER_COLS = `o.id, o.order_date AS "date", o.shift, o.status, o.sap, o.product_name AS "productName",
  o.unit, o.target_qty AS "targetQty", o.produced_qty AS "producedQty",
  o.started_at AS "startedAt", o.finished_at AS "finishedAt", o.closed_at AS "closedAt",
  o.validated_at AS "validatedAt", o.statement_id AS "statementId", o.invoice_id AS "invoiceId",
  o.notes, o.version, o.client_id AS "clientId", c.name AS "clientName",
  o.project_id AS "projectId", p.name AS "projectName",
  (SELECT count(*)::int FROM maquila_assignments a WHERE a.order_id = o.id AND a.active) AS "people"`;
const ORDER_FROM = `FROM maquila_orders o JOIN clients c ON c.id = o.client_id JOIN projects p ON p.id = o.project_id`;

async function assertProject(c: Q, clientId: string, projectId: string) {
  const p = (await c.query(
    `SELECT p.id, p.name, p.um, p.active, c.name AS client_name, c.active AS client_active
     FROM projects p JOIN clients c ON c.id = p.client_id
     WHERE p.id = $1 AND p.client_id = $2`,
    [projectId, clientId],
  )).rows[0];
  if (!p) throw bad('El proyecto no pertenece al cliente seleccionado.');
  if (!p.active) throw bad(`El proyecto «${p.name}» está inactivo.`);
  if (!p.client_active) throw bad(`El cliente «${p.client_name}» está inactivo.`);
  return p;
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
    const p = await assertProject(c, b.clientId, b.projectId);
    const r = await c.query(
      `INSERT INTO maquila_orders (sede_id, client_id, project_id, order_date, shift, sap, product_name, unit, target_qty, notes, status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'PROGRAMADA',$11) RETURNING id`,
      [sede, b.clientId, b.projectId, b.date, b.shift, b.sap || null, b.productName || null, (b.unit || p.um).toUpperCase(), b.targetQty, b.notes || null, user.id],
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
    if (b.clientId || b.projectId) await assertProject(c, clientId, projectId);
    const r = await c.query(
      `UPDATE maquila_orders SET
         order_date = coalesce($3::date, order_date), shift = coalesce($4, shift),
         sap = CASE WHEN $5::text IS NULL THEN sap ELSE $5 END,
         product_name = CASE WHEN $6::text IS NULL THEN product_name ELSE $6 END,
         unit = CASE WHEN $7::text IS NULL THEN unit ELSE $7 END,
         target_qty = coalesce($8::numeric, target_qty),
         notes = CASE WHEN $9::text IS NULL THEN notes ELSE $9 END,
         client_id = coalesce($10::uuid, client_id), project_id = coalesce($11::uuid, project_id),
         version = version + 1, updated_at = now()
       WHERE id = $1 AND sede_id = $2 RETURNING *`,
      [id, sede, b.date ?? null, b.shift ?? null, b.sap ?? null, b.productName ?? null, b.unit ?? null, b.targetQty ?? null, b.notes ?? null, b.clientId ?? null, b.projectId ?? null],
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
    const at = startedAt ? new Date(startedAt) : new Date();
    await c.query('UPDATE maquila_orders SET status = $3, started_at = $4, version = version + 1, updated_at = now() WHERE id = $1 AND sede_id = $2', [id, sede, 'EN_PROCESO', at]);
    await c.query('UPDATE maquila_assignments SET started_at = coalesce(started_at, $2), updated_at = now() WHERE order_id = $1 AND active', [id, at]);
    await audit(c, user, 'maquila_orden', id, 'iniciar', { status: cur.status }, { status: 'EN_PROCESO', startedAt: at.toISOString() });
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
    const produced = b.producedQty ?? (await c.query('SELECT coalesce(sum(qty_done),0) AS q FROM maquila_assignments WHERE order_id = $1 AND active', [id])).rows[0].q;
    const r = await c.query(
      `UPDATE maquila_orders SET status = 'CERRADA', produced_qty = $3, finished_at = $4, closed_at = now(), closed_by = $5,
         notes = CASE WHEN $6::text IS NULL THEN notes ELSE $6 END, version = version + 1, updated_at = now()
       WHERE id = $1 AND sede_id = $2 RETURNING *`,
      [id, sede, produced, fin, user.id, b.notes ?? null],
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
            order_date AS "date", shift, sap, product_name AS "productName", unit, produced_qty AS "producedQty", validated_at AS "validatedAt"
     FROM maquila_por_facturar
     WHERE sede_id = $1
       AND ($2::date IS NULL OR order_date >= $2) AND ($3::date IS NULL OR order_date <= $3)
       AND ($4::uuid IS NULL OR client_id = $4) AND ($5::uuid IS NULL OR project_id = $5)
     ORDER BY order_date, client_name LIMIT $6`,
    [sede, f.from ?? null, f.to ?? null, f.clientId ?? null, f.projectId ?? null, limit],
  )).rows;
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
