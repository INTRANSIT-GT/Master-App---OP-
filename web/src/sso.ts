import { cfg } from './module';

/** Sesión que supabase-js guarda en localStorage (la comparten todas las apps del mismo servidor). */
interface Session { access_token: string; refresh_token: string; expires_at?: number; [k: string]: unknown }

export const decodeClaims = (jwt: string): any => { try { return JSON.parse(atob(jwt.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/'))); } catch { return null; } };
const readSession = (): Session | null => { try { const raw = localStorage.getItem(cfg.storageKey ?? ''); const s = raw ? JSON.parse(raw) : null; return s?.access_token ? s : null; } catch { return null; } };
const writeSession = (s: Session) => { try { localStorage.setItem(cfg.storageKey ?? '', JSON.stringify(s)); } catch { /* sin almacenamiento */ } };
export const clearSession = () => { try { localStorage.removeItem(cfg.storageKey ?? ''); } catch { /* noop */ } };

let refreshing: Promise<string | null> | null = null;
async function refresh(s: Session): Promise<string | null> {
  try {
    const r = await fetch(`${cfg.supabaseUrl}/auth/v1/token?grant_type=refresh_token`, { method: 'POST', headers: { apikey: cfg.supabaseKey ?? '', 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: s.refresh_token }) });
    if (!r.ok) return null;
    const j = await r.json();
    const next: Session = { ...s, access_token: j.access_token, refresh_token: j.refresh_token ?? s.refresh_token, expires_at: j.expires_at ?? Math.floor(Date.now() / 1000) + (j.expires_in ?? 3600), user: j.user ?? s.user };
    writeSession(next);
    return next.access_token;
  } catch { return null; }
}
/** Token vigente (lo renueva si le queda menos de un minuto). null = no hay sesión: hay que pasar por el portal. */
export async function accessToken(): Promise<string | null> {
  const s = readSession(); if (!s) return null;
  const exp = s.expires_at ?? decodeClaims(s.access_token)?.exp ?? 0;
  if (exp - 60 > Date.now() / 1000) return s.access_token;
  return (refreshing ??= refresh(s).finally(() => { refreshing = null; }));
}

/** Vuelve al portal. Si ya se volvió hace instantes (la sesión no sirvió), devuelve false para no entrar en un ciclo. */
export function goPortal(opts: { module?: boolean } = {}): boolean {
  try { const last = Number(sessionStorage.getItem('ops_portal_redirect') ?? 0); if (Date.now() - last < 15_000) return false; sessionStorage.setItem('ops_portal_redirect', String(Date.now())); } catch { /* noop */ }
  location.replace(cfg.portalUrl + (opts.module ? (cfg.portalUrl.includes('?') ? '&' : '?') + 'modulo=' + cfg.moduleId : ''));
  return true;
}
export async function signOut() {
  const t = await accessToken().catch(() => null);
  if (t) fetch(`${cfg.supabaseUrl}/auth/v1/logout`, { method: 'POST', headers: { apikey: cfg.supabaseKey ?? '', Authorization: 'Bearer ' + t } }).catch(() => {});
  clearSession();
  try { sessionStorage.removeItem('ops_portal_redirect'); } catch { /* noop */ }
  location.replace(cfg.portalUrl);
}
