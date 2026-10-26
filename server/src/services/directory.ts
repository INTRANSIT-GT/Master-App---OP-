// Usuarios cuando Operaciones corre dentro de Supabase (AUTH_MODE=sso, SSO_USUARIOS=modulo).
// Las cuentas son de Supabase Auth; el rol en Operaciones vive en app_metadata.modulos.operaciones (lo lee el token y auth.ts).
// Solo se toca la entrada «operaciones»: las de otros módulos (p. ej. transportes) se conservan.
import { MODULE_ID, config } from '../config.js';
import type { Q } from '../db.js';
import { HttpError, conflict } from '../http.js';

/** modulos en forma de lista (["operaciones"]) se pasa a objeto, como deploy/supabase/asignar-modulos.sql. */
const MODS = `CASE jsonb_typeof(au.raw_app_meta_data->'modulos')
    WHEN 'object' THEN au.raw_app_meta_data->'modulos'
    WHEN 'array' THEN (SELECT coalesce(jsonb_object_agg(x, 'consulta'), '{}'::jsonb) FROM jsonb_array_elements_text(au.raw_app_meta_data->'modulos') x)
    ELSE '{}'::jsonb END`;
const COLS = `au.id, au.email, coalesce(u.name, au.raw_user_meta_data->>'full_name', au.raw_user_meta_data->>'name', split_part(au.email, '@', 1)) AS name,
  (${MODS})->>'${MODULE_ID}' AS role, coalesce(u.active, true) AS active, au.created_at AS "createdAt"`;

export async function listDirectory(q: Q) {
  return (await q.query(`SELECT ${COLS} FROM auth.users au LEFT JOIN users u ON u.id = au.id WHERE (${MODS}) ? '${MODULE_ID}' ORDER BY 3`)).rows;
}
export async function directoryUser(q: Q, by: { id?: string; email?: string }) {
  return (await q.query(`SELECT ${COLS} FROM auth.users au LEFT JOIN users u ON u.id = au.id WHERE au.id::text = $1 OR lower(au.email) = lower($2) LIMIT 1`, [by.id ?? '', by.email ?? ''])).rows[0] ?? null;
}

/** Asigna (o cambia) el rol en Operaciones y refleja la cuenta en `users` (la bitácora y las llaves foráneas lo necesitan). */
export async function setModuleRole(q: Q, u: { id: string; email: string; name: string }, role: string) {
  await q.query(`UPDATE auth.users au SET raw_app_meta_data = coalesce(au.raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('modulos', (${MODS}) || jsonb_build_object('${MODULE_ID}', $2::text)) WHERE au.id = $1`, [u.id, role]);
  await q.query(`INSERT INTO users (id, email, name, role, password_hash) VALUES ($1, $2, $3, $4::user_role, '!sso')
    ON CONFLICT (id) DO UPDATE SET role = $4::user_role, updated_at = now()`, [u.id, u.email, u.name, role]);
}

/** Cuenta nueva en Supabase Auth (API de administración; la clave de servicio solo existe en el servidor). */
export async function createAuthAccount(b: { email: string; name: string; password: string; role: string }): Promise<string> {
  if (!config.supabaseServiceKey) throw conflict('GESTION_EXTERNA', 'Este servidor no puede crear cuentas de Supabase; crea la cuenta en la app principal y vuelve a asignarla aquí.');
  const r = await fetch(`${config.supabaseUrl}/auth/v1/admin/users`, {
    method: 'POST', headers: { apikey: config.supabaseServiceKey, Authorization: 'Bearer ' + config.supabaseServiceKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: b.email, password: b.password, email_confirm: true, user_metadata: { full_name: b.name }, app_metadata: { modulos: { [MODULE_ID]: b.role } } }),
  });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok || !j.id) throw new HttpError(r.status === 422 ? 400 : 502, 'SUPABASE_AUTH', 'Supabase no creó la cuenta: ' + (j.msg ?? j.message ?? j.error_description ?? r.statusText));
  return j.id;
}
