import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { NextFunction, Request, Response } from 'express';
import { config } from './config.js';
import { pool } from './db.js';
import { HttpError } from './http.js';
import { can, type Perm, type Role } from './permissions.js';
import { verifySupabaseToken, type SsoUser } from './sso.js';

export interface AuthUser { id: string; email: string; name: string; role: Role }
declare global { namespace Express { interface Request { user?: AuthUser } } }

export const signToken = (u: { id: string; token_version: number }) => jwt.sign({ sub: u.id, tv: u.token_version }, config.jwtSecret, { expiresIn: `${config.jwtTtlHours}h` });

async function authenticateLocal(req: Request) {
  const h = req.headers.authorization;
  if (!h?.startsWith('Bearer ')) throw new HttpError(401, 'NO_AUTENTICADO', 'Inicia sesión para continuar.');
  let payload: any;
  try { payload = jwt.verify(h.slice(7), config.jwtSecret); } catch { throw new HttpError(401, 'SESION_INVALIDA', 'Tu sesión expiró. Inicia sesión de nuevo.'); }
  const r = await pool.query('SELECT id, email, name, role, active, token_version FROM users WHERE id = $1', [payload.sub]);
  const u = r.rows[0];
  if (!u || !u.active || u.token_version !== payload.tv) throw new HttpError(401, 'SESION_INVALIDA', 'Tu sesión ya no es válida. Inicia sesión de nuevo.');
  req.user = { id: u.id, email: u.email, name: u.name, role: u.role };
}

/** Modo sso: el usuario existe en Supabase; aquí se refleja en `users` (necesario para la bitácora y las llaves foráneas). */
const synced = new Map<string, { key: string; id: string; until: number }>();
async function syncSsoUser(u: SsoUser): Promise<AuthUser> {
  const key = `${u.email}|${u.name}|${u.role}`, hit = synced.get(u.sub);
  if (hit && hit.key === key && hit.until > Date.now()) return { id: hit.id, email: u.email, name: u.name, role: u.role };
  const cur = (await pool.query('SELECT id, active FROM users WHERE id = $1 OR lower(email) = lower($2) ORDER BY (id = $1) DESC LIMIT 1', [u.sub, u.email])).rows[0];
  let id: string;
  if (!cur) {
    id = (await pool.query(`INSERT INTO users (id, email, name, role, password_hash) VALUES ($1,$2,$3,$4::user_role,'!sso') RETURNING id`, [u.sub, u.email, u.name, u.role])).rows[0].id;
  } else {
    if (!cur.active) throw new HttpError(403, 'USUARIO_INACTIVO', 'Tu usuario está suspendido en Operaciones.');
    id = cur.id;
    await pool.query('UPDATE users SET name = $2, role = $3::user_role, updated_at = now() WHERE id = $1 AND (name <> $2 OR role <> $3::user_role)', [id, u.name, u.role]);
  }
  synced.set(u.sub, { key, id, until: Date.now() + 60_000 });
  return { id, email: u.email, name: u.name, role: u.role };
}
/** SSO_USUARIOS=modulo: la asignación se lee de auth.users (misma base), así un cambio de rol aplica en segundos. */
const metas = new Map<string, { meta: unknown; until: number }>();
async function appMetaFromDb(sub: string) {
  const hit = metas.get(sub);
  if (hit && hit.until > Date.now()) return hit.meta;
  const meta = (await pool.query('SELECT raw_app_meta_data AS m FROM auth.users WHERE id = $1', [sub])).rows[0]?.m ?? null;
  metas.set(sub, { meta, until: Date.now() + 30_000 });
  return meta;
}
export const resetSsoCache = (sub?: string) => { if (sub) { synced.delete(sub); metas.delete(sub); } else { synced.clear(); metas.clear(); } };

async function authenticateSso(req: Request) {
  const h = req.headers.authorization;
  if (!h?.startsWith('Bearer ')) throw new HttpError(401, 'NO_AUTENTICADO', 'Inicia sesión para continuar.');
  req.user = await syncSsoUser(await verifySupabaseToken(h.slice(7), config.ssoUsers === 'modulo' ? appMetaFromDb : undefined));
}

export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  if (config.authMode === 'sso') await authenticateSso(req); else await authenticateLocal(req);
  next();
}
export const need = (p: Perm) => (req: Request, _res: Response, next: NextFunction) => {
  if (!req.user || !can(req.user.role, p)) throw new HttpError(403, 'SIN_PERMISO', 'Tu rol no tiene permiso para esta acción.');
  next();
};
export const hashPassword = (p: string) => bcrypt.hash(p, 10);
export const checkPassword = (p: string, h: string) => bcrypt.compare(p, h);
export function validatePasswordStrength(p: string) {
  if (p.length < 10) throw new HttpError(400, 'CLAVE_DEBIL', 'La contraseña debe tener al menos 10 caracteres.');
  if (!/[A-Za-z]/.test(p) || !/\d/.test(p)) throw new HttpError(400, 'CLAVE_DEBIL', 'La contraseña debe combinar letras y números.');
}
