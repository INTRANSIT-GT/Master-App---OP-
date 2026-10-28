import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import { config, MODULE_ID } from './config.js';
import { HttpError } from './http.js';
import type { Role } from './permissions.js';

export const ROLES: Role[] = ['administrador', 'supervisor', 'operador', 'consulta', 'comercial', 'coordinador', 'gerente_op', 'supervisor_op', 'jefatura_op', 'validador', 'facturacion', 'cobros'];

export interface SsoUser { sub: string; email: string; name: string; role: Role }

/**
 * Asignación de módulos en el token de Supabase (app_metadata.modulos):
 *   { "operaciones": "supervisor", "transportes": "ADMIN" }   → módulo + rol dentro de cada módulo
 *   ["operaciones", "transportes"]                              → módulo asignado; rol mínimo (consulta)
 * El módulo solo interpreta su propia entrada; las demás las usa cada módulo.
 */
export function moduleAccess(appMeta: unknown): { assigned: boolean; role?: Role } {
  const m = (appMeta as { modulos?: unknown } | null | undefined)?.modulos;
  if (Array.isArray(m)) return m.includes(MODULE_ID) ? { assigned: true, role: 'consulta' } : { assigned: false };
  if (m && typeof m === 'object' && MODULE_ID in m) {
    const r = String((m as Record<string, unknown>)[MODULE_ID]).toLowerCase();
    return { assigned: true, role: (ROLES as string[]).includes(r) ? (r as Role) : undefined };
  }
  return { assigned: false };
}

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
const verifyKey = () => {
  if (config.supabaseJwtSecret) return new TextEncoder().encode(config.supabaseJwtSecret);   // proyectos con clave compartida (HS256)
  return (jwks ??= createRemoteJWKSet(new URL(`${config.supabaseUrl}/auth/v1/.well-known/jwks.json`)));  // claves asimétricas
};

/**
 * Valida firma, vigencia, emisor y audiencia del token de Supabase y devuelve usuario y rol del módulo.
 * appMetaOf: lee la asignación vigente (auth.users) en lugar de la que trae el token, que puede tener hasta una hora.
 */
export async function verifySupabaseToken(token: string, appMetaOf?: (sub: string) => Promise<unknown>): Promise<SsoUser> {
  let p: JWTPayload & { email?: string; app_metadata?: unknown; user_metadata?: { full_name?: string; name?: string } };
  try {
    const opts = { issuer: `${config.supabaseUrl}/auth/v1`, audience: 'authenticated' };
    const k = verifyKey();
    p = (k instanceof Uint8Array ? await jwtVerify(token, k, opts) : await jwtVerify(token, k, opts)).payload as typeof p;
  } catch { throw new HttpError(401, 'SESION_INVALIDA', 'Tu sesión expiró. Vuelve a entrar desde el portal.'); }
  if (!p.sub || !p.email) throw new HttpError(401, 'SESION_INVALIDA', 'La sesión no incluye un usuario válido.');
  const a = moduleAccess(appMetaOf ? await appMetaOf(p.sub) : p.app_metadata);
  if (!a.assigned) throw new HttpError(403, 'MODULO_NO_ASIGNADO', 'Tu usuario no tiene asignado el módulo Operaciones. Pide acceso a un administrador.');
  if (!a.role) throw new HttpError(403, 'ROL_INVALIDO', `El rol asignado en Operaciones no es válido. Roles permitidos: ${ROLES.join(', ')}.`);
  const name = p.user_metadata?.full_name ?? p.user_metadata?.name ?? p.email.split('@')[0]!;
  return { sub: p.sub, email: p.email, name: name.length >= 2 ? name : p.email, role: a.role };
}
