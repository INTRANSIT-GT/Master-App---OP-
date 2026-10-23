/** Normaliza la ruta base: '' (raíz) o '/operaciones' (sin barra final). */
export const normalizeBase = (p: string) => { const s = ('/' + p.trim()).replace(/\/+/g, '/').replace(/\/$/, ''); return s === '/' ? '' : s; };

export const MODULE_ID = 'operaciones';
export const MODULE_NAME = 'Operaciones';
export const MODULE_VERSION = '1.0.0';

const supabaseUrl = (process.env.SUPABASE_URL ?? '').replace(/\/+$/, '');
/** supabase-js guarda la sesión en localStorage con la clave sb-<ref>-auth-token; <ref> es el primer tramo del host. */
const defaultStorageKey = supabaseUrl ? `sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token` : '';

export const config = {
  port: Number(process.env.PORT ?? 3001),
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://omnia:omnia_dev@localhost:5432/omnia',
  jwtSecret: process.env.JWT_SECRET ?? 'dev-only-secret-change-me',
  jwtTtlHours: Number(process.env.JWT_TTL_HOURS ?? 10),
  env: process.env.NODE_ENV ?? 'development',
  corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',
  webDist: process.env.WEB_DIST ?? '../web/dist',
  /** Ruta donde vive el módulo dentro del servidor común ('' = raíz, uso independiente). */
  basePath: normalizeBase(process.env.BASE_PATH ?? ''),
  /** local: login propio del módulo. sso: sesión compartida de Supabase (módulo dentro de la app principal). */
  authMode: (process.env.AUTH_MODE ?? 'local') as 'local' | 'sso',
  supabaseUrl,
  supabasePublishableKey: process.env.SUPABASE_PUBLISHABLE_KEY ?? '',
  supabaseJwtSecret: process.env.SUPABASE_JWT_SECRET ?? '',
  supabaseStorageKey: process.env.SUPABASE_STORAGE_KEY ?? defaultStorageKey,
  portalUrl: process.env.PORTAL_URL ?? '/',
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

/** Lo único que el navegador recibe de la configuración (sin secretos). */
export const publicConfig = () => ({
  moduleId: MODULE_ID, basePath: config.basePath, authMode: config.authMode, portalUrl: config.portalUrl,
  ...(config.authMode === 'sso' ? { supabaseUrl: config.supabaseUrl, supabaseKey: config.supabasePublishableKey, storageKey: config.supabaseStorageKey } : {}),
});
