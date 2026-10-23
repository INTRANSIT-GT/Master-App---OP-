import { vi, beforeEach, describe, expect, it } from 'vitest';
const store = vi.hoisted(() => {
  const m = new Map<string, string>();
  (globalThis as any).window = { OPERACIONES_CONFIG: { authMode: 'sso', basePath: '/operaciones', supabaseUrl: 'https://ref.supabase.co', supabaseKey: 'pk', storageKey: 'sb-ref-auth-token', portalUrl: '/' } };
  (globalThis as any).localStorage = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
  return m;
});
import { accessToken, decodeClaims } from './sso';

const jwt = (claims: object) => 'x.' + btoa(JSON.stringify(claims)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_') + '.y';
const now = () => Math.floor(Date.now() / 1000);
const put = (s: object) => store.set('sb-ref-auth-token', JSON.stringify(s));
beforeEach(() => { store.clear(); vi.restoreAllMocks(); });

describe('sesión compartida de Supabase', () => {
  it('decodifica los datos del token', () => expect(decodeClaims(jwt({ sub: 'u1', app_metadata: { modulos: { operaciones: 'supervisor' } } })).app_metadata.modulos.operaciones).toBe('supervisor'));
  it('devuelve null si no hay sesión', async () => expect(await accessToken()).toBeNull());
  it('usa el token vigente sin llamar a Supabase', async () => {
    const f = vi.fn(); vi.stubGlobal('fetch', f);
    put({ access_token: 'vigente', refresh_token: 'r', expires_at: now() + 3000 });
    expect(await accessToken()).toBe('vigente'); expect(f).not.toHaveBeenCalled();
  });
  it('renueva el token que vence en menos de un minuto y guarda la nueva sesión', async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ access_token: 'nuevo', refresh_token: 'r2', expires_in: 3600, user: { id: 'u1' } }) }); vi.stubGlobal('fetch', f);
    put({ access_token: 'viejo', refresh_token: 'r1', expires_at: now() + 20 });
    expect(await accessToken()).toBe('nuevo');
    expect(f.mock.calls[0][0]).toBe('https://ref.supabase.co/auth/v1/token?grant_type=refresh_token');
    expect(JSON.parse(f.mock.calls[0][1].body)).toEqual({ refresh_token: 'r1' });
    expect(JSON.parse(store.get('sb-ref-auth-token')!)).toMatchObject({ access_token: 'nuevo', refresh_token: 'r2' });
  });
  it('varias llamadas a la vez renuevan una sola vez (el token de renovación rota)', async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ access_token: 'nuevo', refresh_token: 'r2', expires_in: 3600 }) }); vi.stubGlobal('fetch', f);
    put({ access_token: 'viejo', refresh_token: 'r1', expires_at: now() - 5 });
    const r = await Promise.all([accessToken(), accessToken(), accessToken()]);
    expect(r).toEqual(['nuevo', 'nuevo', 'nuevo']); expect(f).toHaveBeenCalledTimes(1);
  });
  it('si Supabase rechaza la renovación devuelve null (hay que pasar por el portal)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }));
    put({ access_token: 'viejo', refresh_token: 'r1', expires_at: now() - 5 });
    expect(await accessToken()).toBeNull();
  });
});
