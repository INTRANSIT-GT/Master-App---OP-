import { Router } from 'express';
import { z } from 'zod';
import { need } from '../auth.js';
import { parse } from '../http.js';
import { addRate, cobro, excelCobro, listRates } from '../services/comercial.js';

export const comercialRouter = Router();
const q = z.object({ semana: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), mes: z.string().regex(/^\d{4}-\d{2}$/).optional(), clientId: z.string().uuid().optional() })
  .refine((v) => !!v.semana || !!v.mes, 'Indica semana (AAAA-MM-DD, un día de la semana) o mes (AAAA-MM).');
comercialRouter.get('/comercial/cobro', need('comercial.ver'), async (req, res) => res.json(await cobro(parse(q, req.query), req.sede!)));
comercialRouter.get('/comercial/cobro/excel', need('comercial.ver'), async (req, res) => {
  const { buf, name } = await excelCobro(parse(q, req.query), req.sede!);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); res.setHeader('Content-Disposition', `attachment; filename="${name}"`); res.send(buf);
});
comercialRouter.get('/comercial/tarifas', need('comercial.ver'), async (req, res) => res.json(await listRates(req.sede!)));
comercialRouter.post('/comercial/tarifas', need('comercial.tarifas'), async (req, res) => {
  const b = parse(z.object({ projectId: z.string().uuid(), rate: z.coerce.number().min(0), unit: z.string().trim().min(1).max(20), validFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), note: z.string().max(300).optional() }), req.body);
  res.status(201).json(await addRate(req.user!, b));
});
