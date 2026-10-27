// Sedes: cada registro operativo pertenece a una sede y cada usuario trabaja en las que tiene asignadas (el administrador, en todas).
// La web indica la sede con el encabezado X-Sede; sin él se usa la primera asignada. Una sede no asignada se rechaza (nunca se
// cambia en silencio: una pestaña vieja escribiría en otra sede). Las lecturas reciben req.sede; las escrituras, user.sede.
import type { NextFunction, Request, Response } from 'express';
import type { AuthUser } from './auth.js';
import { pool, type Q } from './db.js';
import { HttpError } from './http.js';

export interface Sede { id: string; name: string }
declare global { namespace Express { interface Request { sede?: string; sedes?: Sede[] } } }

const sinSede = () => new HttpError(403, 'SIN_SEDE', 'Tu usuario no tiene una sede asignada en Operaciones. Pide a un administrador que te asigne una.');

export async function sedesOf(q: Q, u: Pick<AuthUser, 'id' | 'role'>): Promise<Sede[]> {
  return (u.role === 'administrador'
    ? await q.query('SELECT id, name FROM sedes WHERE active ORDER BY sort, name')
    : await q.query('SELECT s.id, s.name FROM user_sedes us JOIN sedes s ON s.id = us.sede_id WHERE us.user_id = $1 AND s.active ORDER BY s.sort, s.name', [u.id])).rows;
}

const cache = new Map<string, { sedes: Sede[]; until: number }>();
export const resetSedeCache = () => cache.clear();

/** Después de authenticate: fija req.sede y user.sede. /meta responde aunque no haya sede (la web muestra el aviso). */
export async function sedeScope(req: Request, _res: Response, next: NextFunction) {
  const u = req.user!, key = `${u.id}|${u.role}`, hit = cache.get(key);
  const sedes = hit && hit.until > Date.now() ? hit.sedes : await sedesOf(pool, u);
  if (hit?.sedes !== sedes) cache.set(key, { sedes, until: Date.now() + 30_000 });
  const want = req.get('x-sede'), s = want ? sedes.find((x) => x.id === want) : sedes[0];
  if (want && !s) throw new HttpError(403, 'SEDE_NO_ASIGNADA', 'No tienes acceso a esa sede.');
  req.sedes = sedes;
  if (s) req.sede = u.sede = s.id;
  else if (req.path !== '/meta') throw sinSede();
  next();
}

export const sedeDe = (u: Pick<AuthUser, 'sede'>) => { if (!u.sede) throw sinSede(); return u.sede; };

/** Sedes asignadas a cada usuario, para listas: `${SEDES_DE('u.id')}` dentro de un SELECT. */
export const SEDES_DE = (idCol: string) => `(SELECT coalesce(array_agg(us.sede_id ORDER BY us.sede_id), '{}') FROM user_sedes us WHERE us.user_id = ${idCol}) AS sedes`;

/** Reemplaza las sedes de un usuario (el administrador entra en todas, pero conserva las suyas por si cambia de rol). */
export async function setUserSedes(q: Q, userId: string, ids: string[]) {
  const ok = new Set((await q.query('SELECT id FROM sedes WHERE id = ANY($1::text[])', [ids])).rows.map((r) => r.id));
  const unknown = ids.filter((x) => !ok.has(x));
  if (unknown.length) throw new HttpError(400, 'VALIDACION', `Sede inexistente: ${unknown.join(', ')}`);
  await q.query('DELETE FROM user_sedes WHERE user_id = $1 AND NOT (sede_id = ANY($2::text[]))', [userId, ids]);
  await q.query('INSERT INTO user_sedes (user_id, sede_id) SELECT $1, unnest($2::text[]) ON CONFLICT DO NOTHING', [userId, ids]);
  resetSedeCache();
}
