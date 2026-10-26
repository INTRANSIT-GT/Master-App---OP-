/** Configuración que el servidor publica en /config.js (sin secretos). Sin ella (desarrollo) el módulo funciona de forma independiente. */
export interface ModuleConfig {
  moduleId: string; basePath: string; authMode: 'local' | 'sso'; portalUrl: string; supabaseUrl?: string; supabaseKey?: string; storageKey?: string;
  /** modulo: Operaciones administra su acceso y tiene su propia entrada con cuentas de Supabase (GitHub Pages + Supabase). */
  ssoUsers?: 'portal' | 'modulo';
  /** API en otro origen (la Edge Function de Supabase); sin ella, la API vive junto a la web en basePath/api. */
  apiUrl?: string;
}
declare global { interface Window { OPERACIONES_CONFIG?: Partial<ModuleConfig> } }
export const cfg: ModuleConfig = { moduleId: 'operaciones', basePath: '', authMode: 'local', portalUrl: '/', ...(typeof window !== 'undefined' ? window.OPERACIONES_CONFIG : {}) };
export const apiBase = cfg.apiUrl ?? cfg.basePath + '/api';
export const asset = (name: string) => `${cfg.basePath}/${name}`;
/** Entrada propia con la cuenta de Supabase (en vez de volver al portal de la app principal). */
export const ownLogin = cfg.authMode === 'sso' && cfg.ssoUsers === 'modulo';
