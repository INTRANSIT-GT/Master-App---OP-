export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: any) { super(message); }
}
import { apiBase, cfg } from './module';
import { accessToken } from './sso';

let token: string | null = null;
try { token = localStorage.getItem('omnia_token'); } catch { /* sin almacenamiento */ }
export const setToken = (t: string | null) => { token = t; try { t ? localStorage.setItem('omnia_token', t) : localStorage.removeItem('omnia_token'); } catch { /* noop */ } };
export const hasToken = () => cfg.authMode === 'sso' || !!token;   // en sso la sesión la aporta el portal

// Indicador de sincronización: cuántas escrituras están en vuelo y si hay conexión.
type SyncState = { pending: number; offline: boolean; lastSaved: number | null };
let sync: SyncState = { pending: 0, offline: false, lastSaved: null };
const subs = new Set<() => void>();
const setSync = (p: Partial<SyncState>) => { sync = { ...sync, ...p }; subs.forEach((f) => f()); };
export const syncStore = { get: () => sync, subscribe: (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; } };
let onUnauthorized: () => void = () => {};
export const setUnauthorizedHandler = (f: () => void) => { onUnauthorized = f; };

export const newKey = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now());

async function call<T>(method: string, path: string, body?: unknown, opts: { idem?: string; form?: FormData } = {}): Promise<T> {
  const write = method !== 'GET';
  if (write) setSync({ pending: sync.pending + 1 });
  try {
    const headers: Record<string, string> = {};
    const t = cfg.authMode === 'sso' ? await accessToken() : token;
    if (cfg.authMode === 'sso' && !t) { onUnauthorized(); throw new ApiError(401, 'NO_AUTENTICADO', 'Inicia sesión desde el portal.'); }
    if (t) headers.Authorization = 'Bearer ' + t;
    if (opts.idem) headers['Idempotency-Key'] = opts.idem;
    let payload: BodyInit | undefined;
    if (opts.form) payload = opts.form; else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
    let res: Response;
    try { res = await fetch(apiBase + path, { method, headers, body: payload }); }
    catch { setSync({ offline: true }); throw new ApiError(0, 'SIN_CONEXION', 'No hay conexión con el servidor. Tus cambios NO se guardaron.'); }
    setSync({ offline: false });
    if ((res.headers.get('content-type') ?? '').includes('application/json')) {
      const j = await res.json();
      if (!res.ok) {
        if (res.status === 401 && path !== '/auth/login') onUnauthorized();
        throw new ApiError(res.status, j.error ?? 'ERROR', j.message ?? 'Error', j.details);
      }
      if (write) setSync({ lastSaved: Date.now() });
      return j as T;
    }
    if (!res.ok) throw new ApiError(res.status, 'ERROR', 'Error del servidor');
    return (await res.blob()) as unknown as T;
  } finally { if (write) setSync({ pending: Math.max(0, sync.pending - 1) }); }
}
export const api = {
  get: <T = any>(p: string) => call<T>('GET', p),
  post: <T = any>(p: string, b?: unknown, idem?: string) => call<T>('POST', p, b ?? {}, { idem }),
  put: <T = any>(p: string, b?: unknown) => call<T>('PUT', p, b ?? {}),
  patch: <T = any>(p: string, b?: unknown) => call<T>('PATCH', p, b ?? {}),
  del: <T = any>(p: string) => call<T>('DELETE', p),
  upload: <T = any>(p: string, f: FormData) => call<T>('POST', p, undefined, { form: f }),
  download: async (p: string, filename: string) => {
    const blob = await call<Blob>('GET', p);
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  },
};
