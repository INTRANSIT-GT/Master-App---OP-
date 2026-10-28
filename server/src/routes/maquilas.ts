import { Router } from 'express';
import { z } from 'zod';
import { need } from '../auth.js';
import { parse } from '../http.js';
import { idempotent } from '../idempotency.js';
import {
  assignmentsSchema, closeOrder, closeSchema, createOrder, createPerson, getOrder, listOrders, listPeople,
  listPorFacturar, matrizSecciones, orderPatchSchema, orderSchema, personPatchSchema, personSchema,
  replaceAssignments, seccionesDe, setSeccion, startOrder, startSchema, updateOrder, updatePerson,
} from '../services/maquilas.js';

export const maquilasRouter = Router();

const activeQ = z.enum(['true', 'false']).optional().transform((v) => (v === undefined ? undefined : v === 'true'));
const listQ = z.object({
  from: z.string().optional(), to: z.string().optional(), status: z.string().optional(),
  clientId: z.string().uuid().optional(), projectId: z.string().uuid().optional(),
  q: z.string().optional(), limit: z.coerce.number().int().optional(), offset: z.coerce.number().int().optional(),
});

// ───────── personas ─────────
maquilasRouter.get('/maquila/personas', need('maquila.ver'), async (req, res) => {
  const q = parse(z.object({ q: z.string().optional(), active: activeQ, limit: z.coerce.number().int().optional() }), req.query);
  res.json(await listPeople(req.sede!, q));
});
maquilasRouter.post('/maquila/personas', need('maquila.personas'), idempotent, async (req, res) => {
  res.status(201).json(await createPerson(req.user!, parse(personSchema, req.body)));
});
maquilasRouter.patch('/maquila/personas/:id', need('maquila.personas'), async (req, res) => {
  res.json(await updatePerson(req.user!, req.params.id as string, parse(personPatchSchema, req.body)));
});

// ───────── órdenes ─────────
maquilasRouter.get('/maquila/ordenes', need('maquila.ver'), async (req, res) => {
  res.json(await listOrders(req.sede!, parse(listQ, req.query)));
});
maquilasRouter.get('/maquila/ordenes/:id', need('maquila.ver'), async (req, res) => {
  res.json(await getOrder(req.sede!, req.params.id as string));
});
maquilasRouter.post('/maquila/ordenes', need('maquila.programar'), idempotent, async (req, res) => {
  res.status(201).json(await createOrder(req.user!, parse(orderSchema, req.body)));
});
maquilasRouter.patch('/maquila/ordenes/:id', need('maquila.editar'), async (req, res) => {
  res.json(await updateOrder(req.user!, req.params.id as string, parse(orderPatchSchema, req.body)));
});
maquilasRouter.put('/maquila/ordenes/:id/asignaciones', need('maquila.asignar'), async (req, res) => {
  res.json(await replaceAssignments(req.user!, req.params.id as string, parse(assignmentsSchema, req.body)));
});
maquilasRouter.post('/maquila/ordenes/:id/iniciar', need('maquila.iniciar'), async (req, res) => {
  const b = parse(startSchema, req.body ?? {});
  res.json(await startOrder(req.user!, req.params.id as string, b.startedAt));
});
maquilasRouter.post('/maquila/ordenes/:id/cerrar', need('maquila.cerrar'), async (req, res) => {
  res.json(await closeOrder(req.user!, req.params.id as string, parse(closeSchema, req.body ?? {})));
});

// ───────── por facturar ─────────
maquilasRouter.get('/maquila/por-facturar', need('maquila.ver'), async (req, res) => {
  res.json(await listPorFacturar(req.sede!, parse(z.object({
    from: z.string().optional(), to: z.string().optional(),
    clientId: z.string().uuid().optional(), projectId: z.string().uuid().optional(), limit: z.coerce.number().int().optional(),
  }), req.query)));
});

// ───────── secciones visibles ─────────
maquilasRouter.get('/maquila/secciones', need('maquila.ver'), async (req, res) => {
  res.json({ secciones: await seccionesDe(req.user!.role) });
});
maquilasRouter.get('/maquila/admin/secciones', need('ajustes.editar'), async (_req, res) => {
  res.json(await matrizSecciones());
});
maquilasRouter.put('/maquila/admin/secciones/:perfil/:seccion', need('ajustes.editar'), async (req, res) => {
  const b = parse(z.object({ habilitado: z.boolean() }), req.body);
  res.json(await setSeccion(req.user!, req.params.perfil as string, req.params.seccion as string, b.habilitado));
});
