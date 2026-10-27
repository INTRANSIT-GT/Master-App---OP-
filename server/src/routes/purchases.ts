import { Router } from 'express';
import { z } from 'zod';
import { need } from '../auth.js';
import { parse } from '../http.js';
import { idempotent } from '../idempotency.js';
import { can } from '../permissions.js';
import { excelPO, pdfPO } from '../services/exporter.js';
import { completePO, createPO, emitPO, getPO, listPO, purchaseHistory, purchaseOptions, updatePO, voidPO } from '../services/purchases.js';

export const purchasesRouter = Router();
const f = z.object({ from: z.string().optional(), to: z.string().optional(), status: z.string().optional(), q: z.string().optional(), supplier: z.string().optional(), limit: z.coerce.number().optional() });

purchasesRouter.get('/ordenes-compra', need('ver'), async (req, res) => res.json(await listPO(parse(f, req.query), req.sede!)));
purchasesRouter.get('/ordenes-compra/historial', need('ver'), async (req, res) => res.json(await purchaseHistory(parse(f, req.query), req.sede!)));
purchasesRouter.get('/ordenes-compra/opciones', need('ver'), async (_req, res) => res.json(await purchaseOptions()));
purchasesRouter.get('/ordenes-compra/:id', need('ver'), async (req, res) => res.json(await getPO(req.params.id as string, req.sede!)));
purchasesRouter.post('/ordenes-compra', need('compras.crear'), idempotent, async (req, res) => {
  const { emitir, ...body } = req.body ?? {};
  if (emitir && !can(req.user!.role, 'compras.gestionar')) return res.status(403).json({ error: 'SIN_PERMISO', message: 'Solo un supervisor puede emitir la orden.' });
  res.status(201).json(await createPO(req.user!, body, !!emitir));
});
purchasesRouter.patch('/ordenes-compra/:id', need('compras.crear'), async (req, res) => res.json(await updatePO(req.user!, req.params.id as string, req.body)));
purchasesRouter.post('/ordenes-compra/:id/emitir', need('compras.gestionar'), async (req, res) => res.json(await emitPO(req.user!, req.params.id as string)));
purchasesRouter.post('/ordenes-compra/:id/completar', need('compras.completar'), async (req, res) => res.json(await completePO(req.user!, req.params.id as string, req.body?.receivedDate)));
purchasesRouter.post('/ordenes-compra/:id/anular', need('compras.gestionar'), async (req, res) => res.json(await voidPO(req.user!, req.params.id as string, req.body?.reason)));
purchasesRouter.get('/ordenes-compra/:id/excel', need('exportar'), async (req, res) => {
  const { buf, name } = await excelPO(req.params.id as string, req.sede!);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); res.setHeader('Content-Disposition', `attachment; filename="${name}"`); res.send(buf);
});
purchasesRouter.get('/ordenes-compra/:id/pdf', need('exportar'), async (req, res) => {
  const { buf, name } = await pdfPO(req.params.id as string, req.sede!);
  res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Content-Disposition', `attachment; filename="${name}"`); res.send(buf);
});
