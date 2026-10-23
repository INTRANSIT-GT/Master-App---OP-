import { createHash } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { pool } from './db.js';
import { HttpError } from './http.js';

/** Header «Idempotency-Key»: un reintento (doble clic, red caída) devuelve la respuesta original y no crea otro registro. */
export async function idempotent(req: Request, res: Response, next: NextFunction) {
  const key = req.header('Idempotency-Key');
  if (!key || !req.user) return next();
  if (key.length > 100) throw new HttpError(400, 'VALIDACION', 'Idempotency-Key demasiado larga.');
  const hash = createHash('sha256').update(req.method + req.originalUrl + JSON.stringify(req.body ?? {})).digest('hex');
  const ins = await pool.query(`INSERT INTO idempotency_keys (key, user_id, request_hash, status_code, response) VALUES ($1,$2,$3,0,'{}') ON CONFLICT DO NOTHING RETURNING key`, [key, req.user.id, hash]);
  if (!ins.rowCount) {
    const prev = (await pool.query('SELECT request_hash, status_code, response FROM idempotency_keys WHERE key = $1 AND user_id = $2', [key, req.user.id])).rows[0];
    if (prev.request_hash !== hash) throw new HttpError(422, 'IDEMPOTENCIA_DISTINTA', 'Esa Idempotency-Key ya se usó con otra solicitud.');
    if (prev.status_code === 0) throw new HttpError(409, 'EN_PROCESO', 'La solicitud original sigue en proceso.');
    res.setHeader('Idempotent-Replay', 'true');
    return void res.status(prev.status_code).json(prev.response);
  }
  const json = res.json.bind(res);
  res.json = (body: any) => {
    const code = res.statusCode;
    const done = code >= 500 || code === 401 || code === 403
      ? pool.query('DELETE FROM idempotency_keys WHERE key = $1 AND user_id = $2', [key, req.user!.id])
      : pool.query('UPDATE idempotency_keys SET status_code = $3, response = $4 WHERE key = $1 AND user_id = $2', [key, req.user!.id, code, JSON.stringify(body ?? {})]);
    done.catch(() => {});
    return json(body);
  };
  next();
}
