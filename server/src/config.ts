/** Normaliza la ruta base: '' (raíz) o '/operaciones' (sin barra final). */
export const normalizeBase = (p: string) => { const s = ('/' + p.trim()).replace(/\/+/g, '/').replace(/\/$/, ''); return s === '/' ? '' : s; };

export const MODULE_ID = 'operaciones';
export const MODULE_NAME = 'Operaciones';
export const MODULE_VERSION = '1.0.0';

/** Variables de entorno; la Edge Function de Supabase aporta sus valores en OPERACIONES_ENV (ver edge.ts). */
const env: Record<string, string | undefined> = { ...(globalThis as { OPERACIONES_ENV?: Record<string, string> }).OPERACIONES_ENV, ...process.env };

const supabaseUrl = (env.SUPABASE_URL ?? '').replace(/\/+$/, '');
/** supabase-js guarda la sesión en localStorage con la clave sb-<ref>-auth-token; <ref> es el primer tramo del host. */
const defaultStorageKey = supabaseUrl ? `sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token` : '';

export const config = {
  port: Number(env.PORT ?? 3001),
  // dentro de Supabase Edge Functions la conexión llega como SUPABASE_DB_URL
  databaseUrl: env.DATABASE_URL ?? env.SUPABASE_DB_URL ?? 'postgres://omnia:omnia_dev@localhost:5432/omnia',
  /** Esquema propio del módulo cuando comparte base con otra app (Supabase: 'operaciones'); vacío = el predeterminado. */
  dbSchema: env.DB_SCHEMA ?? '',
  dbPoolMax: Number(env.DB_POOL_MAX ?? 10),
  jwtSecret: env.JWT_SECRET ?? 'dev-only-secret-change-me',
  jwtTtlHours: Number(env.JWT_TTL_HOURS ?? 10),
  env: env.NODE_ENV ?? 'development',
  corsOrigin: env.CORS_ORIGIN ?? 'http://localhost:5173',
  webDist: env.WEB_DIST ?? '../web/dist',
  /** Ruta donde vive el módulo dentro del servidor común ('' = raíz, uso independiente). */
  basePath: normalizeBase(env.BASE_PATH ?? ''),
  /** local: login propio del módulo. sso: sesión compartida de Supabase (módulo dentro de la app principal). */
  authMode: (env.AUTH_MODE ?? 'local') as 'local' | 'sso',
  supabaseUrl,
  supabasePublishableKey: env.SUPABASE_PUBLISHABLE_KEY ?? env.SUPABASE_ANON_KEY ?? '',
  supabaseJwtSecret: env.SUPABASE_JWT_SECRET ?? '',
  supabaseStorageKey: env.SUPABASE_STORAGE_KEY ?? defaultStorageKey,
  /** Solo en el servidor (Edge Functions la inyecta): crear cuentas de Supabase desde Operaciones. */
  supabaseServiceKey: env.SUPABASE_SERVICE_ROLE_KEY ?? '',
  /**
   * Con sso, quién administra usuarios y roles:
   *   portal → la app principal; aquí solo se suspende (el rol viaja en el token).
   *   modulo → Operaciones, que corre dentro de Supabase: lee el rol de auth.users (aplica al instante) y da acceso a otras cuentas.
   */
  ssoUsers: (env.SSO_USUARIOS ?? 'portal') as 'portal' | 'modulo',
  portalUrl: env.PORTAL_URL ?? '/',
};
if (config.env === 'production' && config.jwtSecret === 'dev-only-secret-change-me') {
  throw new Error('JWT_SECRET es obligatorio en producción');
}
if (config.env === 'production' && config.jwtSecret.length < 32) {
  throw new Error('JWT_SECRET debe tener al menos 32 caracteres en producción');
}
if (!['local', 'sso'].includes(config.authMode)) throw new Error('AUTH_MODE debe ser local o sso');
if (config.authMode === 'sso' && (!config.supabaseUrl || !config.supabasePublishableKey)) {
  throw new Error('AUTH_MODE=sso requiere SUPABASE_URL y SUPABASE_PUBLISHABLE_KEY');
}
if (!['portal', 'modulo'].includes(config.ssoUsers)) throw new Error('SSO_USUARIOS debe ser portal o modulo');
if (config.dbSchema && !/^[a-z_][a-z0-9_]{0,62}$/.test(config.dbSchema)) throw new Error('DB_SCHEMA no es un nombre de esquema válido');

/** Lo único que el navegador recibe de la configuración (sin secretos). */
export const publicConfig = () => ({
  moduleId: MODULE_ID, basePath: config.basePath, authMode: config.authMode, portalUrl: config.portalUrl, ssoUsers: config.ssoUsers,
  ...(config.authMode === 'sso' ? { supabaseUrl: config.supabaseUrl, supabaseKey: config.supabasePublishableKey, storageKey: config.supabaseStorageKey } : {}),
});
