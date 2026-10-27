import { Router } from 'express';
import { z } from 'zod';
import { need } from '../auth.js';
import { pool, tx } from '../db.js';
import { bad, conflict, notFound, parse } from '../http.js';
import { audit } from '../services/audit.js';
import { getSettings } from '../services/store.js';

export const catalogRouter = Router();

catalogRouter.get('/catalogo', need('ver'), async (_req, res) => {
  const [lines, products, standards, items, bag, mats, settings, clients, projects] = await Promise.all([
    pool.query('SELECT key, results_group AS "resultsGroup", summary_group AS "summaryGroup", name, um, mode, billable_label AS "billableLabel", sort FROM process_lines ORDER BY sort'),
    pool.query('SELECT sap, name, active, sort FROM products ORDER BY sort, sap'),
    pool.query('SELECT id, scope, key, tt, units_per_pallet AS "unitsPerPallet", unit_rate AS "unitRate", valid_from AS "validFrom", valid_to AS "validTo", note FROM standards ORDER BY scope, key, valid_from'),
    pool.query('SELECT id, kind, code, name, units_per_roll AS "unitsPerRoll", ribbon_id AS "ribbonId", ribbon_yield AS "ribbonYield", price, use_text AS "useText", notes, unit FROM inv_items ORDER BY sort, id'),
    pool.query('SELECT sap, bags_per_box AS "bagsPerBox" FROM bag_usage ORDER BY sap'),
    pool.query('SELECT id, sap, name, label, confirmed, aliases FROM material_labels ORDER BY confirmed, name'),
    getSettings(pool),
    pool.query('SELECT id, code, name, active, sort FROM clients ORDER BY sort, name'),
    pool.query('SELECT id, client_id AS "clientId", code, name, kinds, um, active, sort FROM projects ORDER BY sort, name'),
  ]);
  res.json({ clients: clients.rows, projects: projects.rows, lines: lines.rows, products: products.rows, standards: standards.rows, items: items.rows, bagUsage: bag.rows, materialLabels: mats.rows, settings });
});

catalogRouter.post('/catalogo/productos', need('catalogo.editar'), async (req, res) => {
  const b = parse(z.object({ sap: z.string().trim().regex(/^\d{5,12}$/, 'SAP numérico de 5 a 12 dígitos'), name: z.string().trim().min(3).max(200) }), req.body);
  res.status(201).json(await tx(async (c) => {
    const sort = (await c.query('SELECT coalesce(max(sort),0)+1 n FROM products')).rows[0].n;
    const r = await c.query('INSERT INTO products (sap, name, sort) VALUES ($1,$2,$3) RETURNING sap, name, active, sort', [b.sap, b.name, sort]);
    await audit(c, req.user!, 'producto', b.sap, 'crear', null, r.rows[0]);
    return r.rows[0];
  }));
});
catalogRouter.patch('/catalogo/productos/:sap', need('catalogo.editar'), async (req, res) => {
  const b = parse(z.object({ name: z.string().trim().min(3).max(200).optional(), active: z.boolean().optional() }), req.body);
  res.json(await tx(async (c) => {
    const cur = (await c.query('SELECT * FROM products WHERE sap = $1 FOR UPDATE', [req.params.sap])).rows[0]; if (!cur) throw notFound('Producto');
    const r = await c.query('UPDATE products SET name = coalesce($2,name), active = coalesce($3,active) WHERE sap = $1 RETURNING sap, name, active, sort', [req.params.sap, b.name ?? null, b.active ?? null]);
    await audit(c, req.user!, 'producto', cur.sap, 'editar', cur, r.rows[0]);
    return r.rows[0];
  }));
});

// Estándares y tarifas con vigencia: una nueva vigencia cierra la anterior el día previo; nunca se edita el pasado.
catalogRouter.post('/catalogo/estandares', need('estandar.editar'), async (req, res) => {
  const b = parse(z.object({
    scope: z.enum(['product', 'line']), key: z.string().min(1), validFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), note: z.string().max(300).optional(),
    tt: z.coerce.number().positive().nullable().optional(), unitsPerPallet: z.coerce.number().positive().nullable().optional(), unitRate: z.coerce.number().min(0).nullable().optional(),
  }), req.body);
  if (b.tt == null && b.unitsPerPallet == null && b.unitRate == null) throw bad('Indica al menos TT, cajas por tarima o costo unitario.');
  if (b.scope === 'line' && b.unitsPerPallet != null) throw bad('Cajas por tarima solo aplica a productos de maquila.');
  res.status(201).json(await tx(async (c) => {
    const exists = b.scope === 'product' ? await c.query('SELECT 1 FROM products WHERE sap = $1', [b.key]) : await c.query('SELECT 1 FROM process_lines WHERE key = $1', [b.key]);
    if (!exists.rowCount) throw notFound(b.scope === 'product' ? 'Producto' : 'Línea');
    const closed = await c.query(`SELECT 1 FROM periods WHERE status = 'cerrado' AND end_date >= $1`, [b.validFrom]);
    if (closed.rowCount) throw conflict('PERIODO_CERRADO', 'La vigencia empieza dentro de un periodo cerrado; usa una fecha posterior.');
    const prev = (await c.query(`SELECT * FROM standards WHERE scope = $1 AND key = $2 AND valid_from < $3 AND (valid_to IS NULL OR valid_to >= $3) ORDER BY valid_from DESC LIMIT 1 FOR UPDATE`, [b.scope, b.key, b.validFrom])).rows[0];
    if (prev) await c.query(`UPDATE standards SET valid_to = ($1::date - 1) WHERE id = $2`, [b.validFrom, prev.id]);
    // conserva lo que no se envía (p. ej. cambiar solo el costo no borra el TT)
    const r = await c.query(`INSERT INTO standards (scope, key, tt, units_per_pallet, unit_rate, valid_from, note, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      RETURNING id, scope, key, tt, units_per_pallet AS "unitsPerPallet", unit_rate AS "unitRate", valid_from AS "validFrom", valid_to AS "validTo", note`,
      [b.scope, b.key, b.tt === undefined ? prev?.tt ?? null : b.tt, b.unitsPerPallet === undefined ? prev?.units_per_pallet ?? null : b.unitsPerPallet, b.unitRate === undefined ? prev?.unit_rate ?? null : b.unitRate, b.validFrom, b.note ?? null, req.user!.id]);
    await audit(c, req.user!, 'estandar', `${b.scope}:${b.key}`, 'crear', prev ?? null, r.rows[0], b.note);
    return r.rows[0];
  }));
});

catalogRouter.patch('/catalogo/items/:id', need('catalogo.editar'), async (req, res) => {
  const b = parse(z.object({ name: z.string().trim().min(2).max(200).optional(), unit: z.string().trim().max(20).nullable().optional(), price: z.coerce.number().min(0).nullable().optional(), unitsPerRoll: z.coerce.number().positive().nullable().optional(), ribbonYield: z.coerce.number().positive().nullable().optional(), ribbonId: z.string().nullable().optional(), notes: z.string().max(500).nullable().optional(), useText: z.string().max(500).nullable().optional() }).strict(), req.body);
  res.json(await tx(async (c) => {
    const cur = (await c.query('SELECT * FROM inv_items WHERE id = $1 FOR UPDATE', [req.params.id])).rows[0]; if (!cur) throw notFound('Artículo');
    const map: Record<string, string> = { name: 'name', unit: 'unit', price: 'price', unitsPerRoll: 'units_per_roll', ribbonYield: 'ribbon_yield', ribbonId: 'ribbon_id', notes: 'notes', useText: 'use_text' };
    const sets: string[] = [], vals: unknown[] = [];
    for (const [k, col] of Object.entries(map)) if ((b as any)[k] !== undefined) { vals.push((b as any)[k]); sets.push(`${col} = $${vals.length}`); }
    if (!sets.length) return cur;
    vals.push(req.params.id);
    const r = await c.query(`UPDATE inv_items SET ${sets.join(', ')} WHERE id = $${vals.length} RETURNING *`, vals);
    await audit(c, req.user!, 'articulo', cur.id, 'editar', cur, r.rows[0]);
    return r.rows[0];
  }));
});
catalogRouter.put('/catalogo/bolsa/:sap', need('catalogo.editar'), async (req, res) => {
  const b = parse(z.object({ bagsPerBox: z.coerce.number().positive() }), req.body);
  res.json(await tx(async (c) => {
    if (!(await c.query('SELECT 1 FROM products WHERE sap = $1', [req.params.sap])).rowCount) throw notFound('Producto');
    const prev = (await c.query('SELECT * FROM bag_usage WHERE sap = $1', [req.params.sap])).rows[0];
    await c.query('INSERT INTO bag_usage (sap, bags_per_box) VALUES ($1,$2) ON CONFLICT (sap) DO UPDATE SET bags_per_box = $2', [req.params.sap, b.bagsPerBox]);
    await audit(c, req.user!, 'bolsa', req.params.sap as string, prev ? 'editar' : 'crear', prev ?? null, b);
    return { sap: req.params.sap, bagsPerBox: b.bagsPerBox };
  }));
});
catalogRouter.delete('/catalogo/bolsa/:sap', need('catalogo.editar'), async (req, res) => {
  await tx(async (c) => { const r = await c.query('DELETE FROM bag_usage WHERE sap = $1 RETURNING *', [req.params.sap]); if (!r.rowCount) throw notFound(); await audit(c, req.user!, 'bolsa', req.params.sap as string, 'quitar', r.rows[0], null); });
  res.json({ ok: true });
});

const matSchema = z.object({ sap: z.string().trim().regex(/^\d{5,12}$/).optional().or(z.literal('')), name: z.string().trim().min(3).max(200), label: z.string().max(20).default(''), aliases: z.array(z.string()).optional() });
catalogRouter.post('/catalogo/materiales', need('catalogo.editar'), async (req, res) => {
  const b = parse(matSchema, req.body);
  res.status(201).json(await tx(async (c) => {
    const r = await c.query(`INSERT INTO material_labels (sap, name, label, confirmed, aliases) VALUES ($1,$2,$3,$4,$5) RETURNING id, sap, name, label, confirmed, aliases`, [b.sap || null, b.name.toUpperCase(), b.label, !!b.label, b.aliases ?? []]);
    await audit(c, req.user!, 'material', r.rows[0].id, 'crear', null, r.rows[0]); return r.rows[0];
  }));
});
catalogRouter.patch('/catalogo/materiales/:id', need('catalogo.editar'), async (req, res) => {
  const b = parse(z.object({ label: z.string().max(20).optional(), confirmed: z.boolean().optional(), name: z.string().trim().min(3).optional() }), req.body);
  res.json(await tx(async (c) => {
    const cur = (await c.query('SELECT * FROM material_labels WHERE id = $1 FOR UPDATE', [req.params.id])).rows[0]; if (!cur) throw notFound('Material');
    const label = b.label ?? cur.label, confirmed = b.confirmed ?? (b.label !== undefined ? !!b.label : cur.confirmed);
    const r = await c.query('UPDATE material_labels SET label=$2, confirmed=$3, name=coalesce($4,name) WHERE id=$1 RETURNING id, sap, name, label, confirmed, aliases', [req.params.id, label, confirmed, b.name ?? null]);
    await audit(c, req.user!, 'material', cur.id, 'editar', cur, r.rows[0]); return r.rows[0];
  }));
});
catalogRouter.delete('/catalogo/materiales/:id', need('catalogo.editar'), async (req, res) => {
  await tx(async (c) => { const r = await c.query('DELETE FROM material_labels WHERE id = $1 RETURNING *', [req.params.id]); if (!r.rowCount) throw notFound('Material'); await audit(c, req.user!, 'material', r.rows[0].id, 'quitar', r.rows[0], null); });
  res.json({ ok: true });
});

catalogRouter.put('/ajustes', need('ajustes.editar'), async (req, res) => {
  const b = parse(z.object({ inicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), wmDiv: z.coerce.number().positive().optional(), crkDefaultUnitsPerBox: z.coerce.number().positive().optional() }).strict(), req.body);
  res.json(await tx(async (c) => {
    const before = await getSettings(c);
    for (const [k, v] of Object.entries(b)) await c.query('INSERT INTO settings (key, value, updated_by) VALUES ($1,$2,$3) ON CONFLICT (key) DO UPDATE SET value = $2, updated_by = $3, updated_at = now()', [k, JSON.stringify(v), req.user!.id]);
    await audit(c, req.user!, 'ajustes', 'general', 'editar', before, b);
    return getSettings(c);
  }));
});

// ───────── clientes, proyectos e insumos ─────────
const codeOf = (n: string) => n.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, '').slice(0, 12) || 'X';
catalogRouter.post('/catalogo/clientes', need('catalogo.editar'), async (req, res) => {
  const b = parse(z.object({ name: z.string().trim().min(2).max(100) }), req.body);
  res.status(201).json(await tx(async (c) => {
    const sort = (await c.query('SELECT coalesce(max(sort),0)+1 n FROM clients')).rows[0].n;
    const r = await c.query('INSERT INTO clients (code, name, sort) VALUES ($1,$2,$3) RETURNING id, code, name, active, sort', [codeOf(b.name), b.name, sort]);
    await audit(c, req.user!, 'cliente', r.rows[0].id, 'crear', null, r.rows[0]); return r.rows[0];
  }));
});
catalogRouter.patch('/catalogo/clientes/:id', need('catalogo.editar'), async (req, res) => {
  const b = parse(z.object({ name: z.string().trim().min(2).max(100).optional(), active: z.boolean().optional() }).strict(), req.body);
  res.json(await tx(async (c) => {
    const cur = (await c.query('SELECT * FROM clients WHERE id = $1 FOR UPDATE', [req.params.id])).rows[0]; if (!cur) throw notFound('Cliente');
    const r = await c.query('UPDATE clients SET name = coalesce($2,name), active = coalesce($3,active) WHERE id = $1 RETURNING id, code, name, active, sort', [req.params.id, b.name ?? null, b.active ?? null]);
    await audit(c, req.user!, 'cliente', cur.id, 'editar', cur, r.rows[0]); return r.rows[0];
  }));
});
catalogRouter.post('/catalogo/proyectos', need('catalogo.editar'), async (req, res) => {
  const b = parse(z.object({ clientId: z.string().uuid(), name: z.string().trim().min(2).max(120), um: z.string().trim().min(1).max(20).default('UNIDAD') }), req.body);
  res.status(201).json(await tx(async (c) => {
    if (!(await c.query('SELECT 1 FROM clients WHERE id = $1', [b.clientId])).rowCount) throw notFound('Cliente');
    const sort = (await c.query('SELECT coalesce(max(sort),0)+1 n FROM projects WHERE client_id = $1', [b.clientId])).rows[0].n;
    const r = await c.query(`INSERT INTO projects (client_id, code, name, kinds, um, sort) VALUES ($1,$2,$3,ARRAY['gen'],$4,$5) RETURNING id, client_id AS "clientId", code, name, kinds, um, active, sort`, [b.clientId, codeOf(b.name), b.name, b.um.toUpperCase(), sort]);
    await audit(c, req.user!, 'proyecto', r.rows[0].id, 'crear', null, r.rows[0]); return r.rows[0];
  }));
});
catalogRouter.patch('/catalogo/proyectos/:id', need('catalogo.editar'), async (req, res) => {
  const b = parse(z.object({ name: z.string().trim().min(2).max(120).optional(), um: z.string().trim().min(1).max(20).optional(), active: z.boolean().optional() }).strict(), req.body);
  res.json(await tx(async (c) => {
    const cur = (await c.query('SELECT * FROM projects WHERE id = $1 FOR UPDATE', [req.params.id])).rows[0]; if (!cur) throw notFound('Proyecto');
    const r = await c.query(`UPDATE projects SET name = coalesce($2,name), um = coalesce($3,um), active = coalesce($4,active) WHERE id = $1 RETURNING id, client_id AS "clientId", code, name, kinds, um, active, sort`, [req.params.id, b.name ?? null, b.um?.toUpperCase() ?? null, b.active ?? null]);
    await audit(c, req.user!, 'proyecto', cur.id, 'editar', cur, r.rows[0]); return r.rows[0];
  }));
});
// insumos (inventario de insumos conectado a órdenes de compra y producción)
catalogRouter.post('/catalogo/insumos', need('inventario.gestionar'), async (req, res) => {
  const b = parse(z.object({ code: z.string().trim().regex(/^[A-Za-z0-9._-]{2,30}$/, 'código de 2 a 30 caracteres (letras, números, . _ -)'), name: z.string().trim().min(2).max(200), unit: z.string().trim().min(1).max(20).default('UNIDAD'), price: z.coerce.number().min(0).nullable().optional() }), req.body);
  res.status(201).json(await tx(async (c) => {
    const id = 'I:' + b.code.toUpperCase();
    if ((await c.query('SELECT 1 FROM inv_items WHERE id = $1', [id])).rowCount) throw conflict('DUPLICADO', 'Ya existe un insumo con ese código.');
    const sort = (await c.query('SELECT coalesce(max(sort),0)+1 n FROM inv_items')).rows[0].n;
    const r = await c.query(`INSERT INTO inv_items (id, kind, code, name, unit, price, sort) VALUES ($1,'ins',$2,$3,$4,$5,$6) RETURNING id, kind, code, name, unit, price`, [id, b.code.toUpperCase(), b.name, b.unit.toUpperCase(), b.price ?? null, sort]);
    await audit(c, req.user!, 'insumo', id, 'crear', null, r.rows[0]); return r.rows[0];
  }));
});
