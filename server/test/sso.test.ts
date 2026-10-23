// Sesión compartida con Supabase (AUTH_MODE=sso): el token de Supabase decide si entra, con qué rol y qué módulo.
import { vi } from 'vitest';
vi.hoisted(() => {
  Object.assign(process.env, { AUTH_MODE: 'sso', BASE_PATH: '', SUPABASE_URL: 'https://refprueba.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_prueba', SUPABASE_JWT_SECRET: 'secreto-de-prueba-supabase-0123456789abcdef', PORTAL_URL: '/' });
});
import { SignJWT } from 'jose';
import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { resetSsoCache } from '../src/auth.js';
import { pool } from '../src/db.js';
import { app, resetDb } from './helpers.js';

const KEY = new TextEncoder().encode(process.env.SUPABASE_JWT_SECRET!);
const SUB_SUP = '11111111-1111-4111-8111-111111111111', SUB_ADM = '22222222-2222-4222-8222-222222222222', SUB_NEW = '33333333-3333-4333-8333-333333333333';
async function tok(o: { sub?: string; email?: string; modulos?: unknown; exp?: string; key?: Uint8Array; aud?: string; iss?: string; name?: string } = {}) {
  return new SignJWT({ email: o.email ?? 'ana@intransit.test', app_metadata: o.modulos === undefined ? {} : { modulos: o.modulos }, user_metadata: { full_name: o.name ?? 'Ana Pérez' } })
    .setProtectedHeader({ alg: 'HS256' }).setSubject(o.sub ?? SUB_SUP).setAudience(o.aud ?? 'authenticated').setIssuer(o.iss ?? 'https://refprueba.supabase.co/auth/v1')
    .setIssuedAt().setExpirationTime(o.exp ?? '1h').sign(o.key ?? KEY);
}
const get = (path: string, t?: string) => request(app).get(path).set(t ? { Authorization: 'Bearer ' + t } : {});

beforeAll(async () => { await resetDb(true); });
beforeEach(() => resetSsoCache());

describe('acceso por módulo asignado', () => {
  it('entra con el módulo asignado y toma el rol del token', async () => {
    const r = await get('/api/auth/me', await tok({ modulos: { operaciones: 'supervisor', transportes: 'ADMIN' } }));
    expect(r.status).toBe(200); expect(r.body).toMatchObject({ email: 'ana@intransit.test', name: 'Ana Pérez', role: 'supervisor' });
    expect(r.body.permissions).toContain('registro.anular');
  });
  it('crea el usuario local en el primer acceso (la bitácora lo necesita)', async () => {
    await get('/api/meta', await tok({ sub: SUB_NEW, email: 'nuevo@intransit.test', name: 'Luis Gómez', modulos: { operaciones: 'operador' } }));
    const u = (await pool.query('SELECT id, role, name, password_hash FROM users WHERE lower(email) = $1', ['nuevo@intransit.test'])).rows[0];
    expect(u).toMatchObject({ id: SUB_NEW, role: 'operador', name: 'Luis Gómez', password_hash: '!sso' });
  });
  it('el rol cambia en el siguiente acceso cuando cambia en la asignación', async () => {
    await get('/api/meta', await tok({ sub: SUB_ADM, email: 'jefe@intransit.test', modulos: { operaciones: 'operador' } }));
    resetSsoCache();
    const r = await get('/api/auth/me', await tok({ sub: SUB_ADM, email: 'jefe@intransit.test', modulos: { operaciones: 'administrador' } }));
    expect(r.body.role).toBe('administrador');
    expect((await pool.query('SELECT role FROM users WHERE id = $1', [SUB_ADM])).rows[0].role).toBe('administrador');
  });
  it('un usuario con el módulo asignado como lista entra con rol de solo lectura', async () => {
    const t = await tok({ email: 'lectura@intransit.test', sub: '44444444-4444-4444-8444-444444444444', modulos: ['operaciones'] });
    const r = await get('/api/auth/me', t);
    expect(r.body.role).toBe('consulta');
    expect((await request(app).post('/api/produccion').set('Authorization', 'Bearer ' + t).send({})).status).toBe(403);
  });
  it('sin el módulo asignado responde 403 MODULO_NO_ASIGNADO (aunque tenga otros módulos)', async () => {
    const r = await get('/api/meta', await tok({ modulos: { transportes: 'ADMIN' } }));
    expect(r.status).toBe(403); expect(r.body.error).toBe('MODULO_NO_ASIGNADO');
    expect((await get('/api/meta', await tok({}))).body.error).toBe('MODULO_NO_ASIGNADO');
  });
  it('rol no válido en Operaciones: 403 ROL_INVALIDO', async () => {
    const r = await get('/api/meta', await tok({ modulos: { operaciones: 'ADMIN' } }));
    expect(r.status).toBe(403); expect(r.body.error).toBe('ROL_INVALIDO');
  });
  it('un usuario suspendido en Operaciones no entra aunque Supabase lo permita', async () => {
    const t = () => tok({ sub: SUB_NEW, email: 'nuevo@intransit.test', modulos: { operaciones: 'operador' } });
    await pool.query('UPDATE users SET active = false WHERE id = $1', [SUB_NEW]); resetSsoCache();
    const r = await get('/api/meta', await t());
    expect(r.status).toBe(403); expect(r.body.error).toBe('USUARIO_INACTIVO');
    await pool.query('UPDATE users SET active = true WHERE id = $1', [SUB_NEW]);
  });
});

describe('token inválido', () => {
  it('sin token: 401', async () => expect((await get('/api/meta')).status).toBe(401));
  it('token vencido: 401', async () => expect((await get('/api/meta', await tok({ modulos: { operaciones: 'supervisor' }, exp: '-1m' }))).status).toBe(401));
  it('firma de otro proyecto: 401', async () => expect((await get('/api/meta', await tok({ modulos: { operaciones: 'supervisor' }, key: new TextEncoder().encode('otra-clave-distinta-0123456789abcdef') }))).status).toBe(401));
  it('emisor o audiencia ajenos: 401', async () => {
    expect((await get('/api/meta', await tok({ modulos: { operaciones: 'supervisor' }, iss: 'https://otro.supabase.co/auth/v1' }))).status).toBe(401);
    expect((await get('/api/meta', await tok({ modulos: { operaciones: 'supervisor' }, aud: 'anon' }))).status).toBe(401);
  });
  it('un token del login local no sirve en modo sso', async () => expect((await get('/api/meta', 'abc.def.ghi')).status).toBe(401));
});

describe('gestión de usuarios y sesión en modo sso', () => {
  const admin = () => tok({ sub: SUB_ADM, email: 'jefe@intransit.test', modulos: { operaciones: 'administrador' } });
  it('el login y el cambio de contraseña locales no existen', async () => {
    const r = await request(app).post('/api/auth/login').send({ email: 'a@b.co', password: 'x' });
    expect(r.status).toBe(400); expect(r.body.error).toBe('SESION_EXTERNA');
  });
  it('no se crean usuarios ni se cambian roles aquí; solo suspender', async () => {
    const t = await admin();
    const c = await request(app).post('/api/usuarios').set('Authorization', 'Bearer ' + t).send({ email: 'x@y.co', name: 'Xx', role: 'operador', password: 'Clave12345' });
    expect(c.status).toBe(409); expect(c.body.error).toBe('GESTION_EXTERNA');
    const p = await request(app).patch('/api/usuarios/' + SUB_SUP).set('Authorization', 'Bearer ' + t).send({ role: 'consulta' });
    expect(p.status).toBe(409); expect(p.body.error).toBe('GESTION_EXTERNA');
    const s = await request(app).patch('/api/usuarios/' + SUB_SUP).set('Authorization', 'Bearer ' + t).send({ active: false });
    expect(s.status).toBe(200); expect(s.body.active).toBe(false);
  });
  it('config.js entrega URL y clave pública de Supabase, nunca el secreto del token', async () => {
    const r = await get('/config.js');
    expect(r.text).toContain('"authMode":"sso"'); expect(r.text).toContain('https://refprueba.supabase.co'); expect(r.text).toContain('sb_publishable_prueba'); expect(r.text).toContain('sb-refprueba-auth-token');
    expect(r.text).not.toContain('secreto-de-prueba');
  });
  it('la política de seguridad permite al navegador renovar la sesión contra Supabase', async () => {
    const csp = (await get('/api/modulo')).headers['content-security-policy'] as string;
    expect(csp).toMatch(/connect-src[^;]*https:\/\/refprueba\.supabase\.co/);
  });
});
