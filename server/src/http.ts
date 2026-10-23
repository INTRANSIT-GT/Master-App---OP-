import type { NextFunction, Request, Response } from 'express';
import { ZodError, type ZodTypeAny, type z } from 'zod';

export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) { super(message); }
}
export const bad = (message: string, details?: unknown) => new HttpError(400, 'VALIDACION', message, details);
export const notFound = (what = 'Registro') => new HttpError(404, 'NO_ENCONTRADO', `${what} no encontrado`);
export const conflict = (code: string, message: string, details?: unknown) => new HttpError(409, code, message, details);

export function parse<S extends ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  const r = schema.safeParse(data);
  if (!r.success) throw new HttpError(400, 'VALIDACION', 'Datos inválidos: ' + r.error.issues.map((i) => `${i.path.join('.') || 'cuerpo'}: ${i.message}`).join('; '), r.error.issues);
  return r.data;
}

export function errorHandler(err: any, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.code, message: err.message, details: err.details });
  if (err instanceof ZodError) return res.status(400).json({ error: 'VALIDACION', message: err.message });
  if (err?.code === 'P0001' && String(err.message).startsWith('PERIODO_CERRADO'))
    return res.status(423).json({ error: 'PERIODO_CERRADO', message: String(err.message).replace(/^PERIODO_CERRADO: /, 'Periodo cerrado: ') });
  if (err?.code === 'P0002') return res.status(409).json({ error: 'NO_BORRABLE', message: 'Los registros no se borran: anúlalos con una justificación.' });
  if (err?.code === '23505') return res.status(409).json({ error: 'DUPLICADO', message: 'Ya existe un registro con esos datos.', details: err.detail });
  if (err?.code === '23P01') return res.status(409).json({ error: 'VIGENCIA_TRASLAPADA', message: 'La vigencia se traslapa con otra existente.' });
  if (err?.code === '23503') return res.status(409).json({ error: 'REFERENCIA', message: 'Referencia inexistente o en uso.', details: err.detail });
  if (err?.code === '23514') return res.status(400).json({ error: 'VALIDACION', message: 'Un valor no cumple las reglas de la base de datos.', details: err.constraint });
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON_INVALIDO', message: 'El cuerpo no es JSON válido.' });
  console.error(err);
  res.status(500).json({ error: 'ERROR_INTERNO', message: 'Ocurrió un error inesperado.' });
}
