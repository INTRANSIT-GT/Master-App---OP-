import { Router } from 'express';
import { z } from 'zod';
import { need } from '../auth.js';
import { pool, tx } from '../db.js';
import { HttpError, bad, parse } from '../http.js';
import { idempotent } from '../idempotency.js';
import { can, type Perm } from '../permissions.js';
import { audit } from '../services/audit.js';
import { confirmRecord, createRecord, getRecord, listRecords, updateRecord, voidRecord, type EntKey } from '../services/records.js';

export const recordsRouter = Router();
const PATHS: [string, EntKey, Perm, Perm][] = [
  ['produccion', 'production', 'registro.crear', 'registro.anular'],
  ['horas', 'hours', 'registro.crear', 'registro.anular'],
  ['requerimientos', 'requirements', 'requerimiento.gestionar', 'requerimiento.gestionar'],
  ['merma', 'scrap', 'inventario.gestionar', 'inventario.gestionar'],
  ['insumos/movimientos', 'supply', 'inventario.gestionar', 'inventario.gestionar'],
];
const q = z.object({ from: z.string().optional(), to: z.string().optional(), kind: z.string().optional(), status: z.enum(['borrador', 'confirmado', 'anulado']).optional(), q: z.string().optional(), project: z.string().optional(), limit: z.coerce.number().optional(), offset: z.coerce.number().optional() });

for (const [path, key, createPerm, voidPerm] of PATHS) {
  recordsRouter.get(`/${path}`, need('ver'), async (req, res) => res.json(await listRecords(key, parse(q, req.query))));
  recordsRouter.get(`/${path}/:id`, need('ver'), async (req, res) => res.json(await getRecord(key, req.params.id as string)));
  recordsRouter.post(`/${path}`, need(createPerm), idempotent, async (req, res) => res.status(201).json(await createRecord(key, req.user!, req.body)));
  recordsRouter.patch(`/${path}/:id`, async (req, res, next) => {
    // permisos finos (propio/ajeno) se resuelven en el servicio; aquí solo se exige estar autenticado con rol de captura
    if (!can(req.user!.role, 'registro.editar') && !can(req.user!.role, 'registro.editar_propio')) throw new HttpError(403, 'SIN_PERMISO', 'Tu rol no puede editar registros.');
    if (['requirements', 'scrap', 'supply'].includes(key) && !can(req.user!.role, createPerm)) throw new HttpError(403, 'SIN_PERMISO', 'Tu rol no tiene permiso para esta acción.');
    next();
  }, async (req, res) => res.json(await updateRecord(key, req.user!, req.params.id as string, req.body)));
  recordsRouter.post(`/${path}/:id/anular`, need(voidPerm), async (req, res) => res.json(await voidRecord(key, req.user!, req.params.id as string, req.body?.reason)));
  recordsRouter.post(`/${path}/:id/confirmar`, need('registro.crear'), async (req, res) => res.json(await confirmRecord(key, req.user!, req.params.id as string)));
}

// asistencia semanal (horas pagadas)
recordsRouter.get('/asistencia', need('ver'), async (req, res) => {
  const { from, to } = parse(z.object({ from: z.string().optional(), to: z.string().optional() }), req.query);
  const r = await pool.query('SELECT week_monday AS "weekMonday", paid_hours AS "paidHours", is_demo AS "isDemo", version FROM attendance WHERE ($1::date IS NULL OR week_monday >= $1) AND ($2::date IS NULL OR week_monday <= $2) ORDER BY week_monday', [from ?? null, to ?? null]);
  res.json(r.rows);
});
recordsRouter.put('/asistencia/:monday', need('registro.editar'), async (req, res) => {
  const { paidHours, version } = parse(z.object({ paidHours: z.coerce.number().min(0).max(100000), version: z.number().int().optional() }), req.body);
  const monday = req.params.monday as string;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(monday) || new Date(monday + 'T00:00:00Z').getUTCDay() !== 1) throw bad('La semana debe identificarse por su lunes (AAAA-MM-DD).');
  res.json(await tx(async (c) => {
    const cur = (await c.query('SELECT * FROM attendance WHERE week_monday = $1 FOR UPDATE', [monday])).rows[0];
    if (cur && version !== undefined && version !== cur.version) throw new HttpError(409, 'CONFLICTO_VERSION', 'Otra persona modificó esta asistencia. Recarga.');
    const r = await c.query(`INSERT INTO attendance (week_monday, paid_hours, updated_by) VALUES ($1,$2,$3)
      ON CONFLICT (week_monday) DO UPDATE SET paid_hours = $2, updated_by = $3, updated_at = now(), version = attendance.version + 1 RETURNING week_monday AS "weekMonday", paid_hours AS "paidHours", version`, [monday, paidHours, req.user!.id]);
    await audit(c, req.user!, 'asistencia', monday, cur ? 'editar' : 'crear', cur ? { paidHours: cur.paid_hours } : null, { paidHours });
    return r.rows[0];
  }));
});

// conteos físicos de inventario
recordsRouter.get('/inventario/conteos', need('ver'), async (_req, res) => {
  res.json((await pool.query('SELECT count_date AS date, item_id AS "itemId", qty FROM inventory_counts ORDER BY count_date DESC, item_id')).rows);
});
recordsRouter.put('/inventario/conteo', need('inventario.gestionar'), async (req, res) => {
  const b = parse(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), items: z.record(z.string(), z.coerce.number().finite()) }), req.body);
  res.json(await tx(async (c) => {
    for (const [id, qty] of Object.entries(b.items)) {
      if (!(await c.query('SELECT 1 FROM inv_items WHERE id = $1', [id])).rowCount) throw bad(`Artículo desconocido: ${id}`);
      const prev = (await c.query('SELECT qty FROM inventory_counts WHERE count_date = $1 AND item_id = $2', [b.date, id])).rows[0];
      await c.query(`INSERT INTO inventory_counts (count_date, item_id, qty, created_by) VALUES ($1,$2,$3,$4) ON CONFLICT (count_date, item_id) DO UPDATE SET qty = $3, created_by = $4`, [b.date, id, qty, req.user!.id]);
      await audit(c, req.user!, 'conteo', `${b.date}/${id}`, prev ? 'editar' : 'crear', prev ?? null, { qty });
    }
    return { date: b.date, items: Object.keys(b.items).length };
  }));
});
