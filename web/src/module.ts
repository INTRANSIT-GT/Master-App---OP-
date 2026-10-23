/** Configuración que el servidor publica en /config.js (sin secretos). Sin ella (desarrollo) el módulo funciona de forma independiente. */
export interface ModuleConfig { moduleId: string; basePath: string; authMode: 'local' | 'sso'; portalUrl: string; supabaseUrl?: string; supabaseKey?: string; storageKey?: string }
declare global { interface Window { OPERACIONES_CONFIG?: Partial<ModuleConfig> } }
export const cfg: ModuleConfig = { moduleId: 'operaciones', basePath: '', authMode: 'local', portalUrl: '/', ...(typeof window !== 'undefined' ? window.OPERACIONES_CONFIG : {}) };
export const apiBase = cfg.basePath + '/api';
export const asset = (name: string) => `${cfg.basePath}/${name}`;
