// Operaciones dentro de Supabase (AUTH_MODE=sso, SSO_USUARIOS=modulo): el rol se lee de auth.users y el administrador
// de Operaciones da acceso a cuentas de Supabase. Aquí auth.users es una tabla de prueba con las columnas que se usan.
import { vi } from 'vitest';
vi.hoisted(() => {
  Object.assign(process.env, { AUTH_MODE: 'sso', SSO_USUARIOS: 'modulo', BASE_PATH: '', SUPABASE_URL: 'https://refprueba.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_prueba', SUPABASE_JWT_SECRET: 'secreto-de-prueba-supabase-0123456789abcdef', SUPABASE_SERVICE_ROLE_KEY: 'clave-servicio-prueba', PORTAL_URL: '/' });
});
import { SignJWT } from 'jose';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { resetSsoCache } from '../src/auth.js';
import { pool } from '../src/db.js';
import { app, resetDb } from './helpers.js';

const KEY = new TextEncoder().encode(process.env.SUPABASE_JWT_SECRET!);
const ADM = '22222222-2222-4222-8222-222222222222', ANA = '11111111-1111-4111-8111-111111111111', TRA = '55555555-5555-4555-8555-555555555555', NEW = '66666666-6666-4666-8666-666666666666';
const tok = (sub: string, email: string, modulos: unknown = {}) => new SignJWT({ email, app_metadata: { modulos }, user_metadata: { full_name: email.split('@')[0] } })
  .setProtectedHeader({ alg: 'HS256' }).setSubject(sub).setAudience('authenticated').setIssuer('https://refprueba.supabase.co/auth/v1').setIssuedAt().setExpirationTime('1h').sign(KEY);
const authUser = (id: string, email: string, modulos: unknown) => pool.query('INSERT INTO auth.users (id, email, raw_app_meta_data, raw_user_meta_data) VALUES ($1,$2,$3,$4)', [id, email, JSON.stringify({ provider: 'email', modulos }), JSON.stringify({ full_name: email.split('@')[0] })]);
const modsOf = async (id: string) => (await pool.query('SELECT raw_app_meta_data->\'modulos\' AS m FROM auth.users WHERE id = $1', [id])).rows[0].m;
const as = async (sub: string, email: string) => { const t = await tok(sub, email); return { get: (p: string) => request(app).get(p).set('Authorization', 'Bearer ' + t), post: (p: string) => request(app).post(p).set('Authorization', 'Bearer ' + t), patch: (p: string) => request(app).patch(p).set('Authorization', 'Bearer ' + t) }; };

beforeAll(async () => {
  await resetDb(false);
  await pool.query('DROP SCHEMA IF EXISTS auth CASCADE; CREATE SCHEMA auth; CREATE TABLE auth.users (id uuid PRIMARY KEY, email text, raw_app_meta_data jsonb, raw_user_meta_data jsonb, created_at timestamptz NOT NULL DEFAULT now())');
  await authUser(ADM, 'jefe@intransit.test', { operaciones: 'administrador' });
  await authUser(ANA, 'ana@intransit.test', { operaciones: 'supervisor' });
  await authUser(TRA, 'piloto@intransit.test', { transportes: 'ADMIN' });
});
beforeEach(() => resetSsoCache());
afterAll(async () => { await pool.query('DROP SCHEMA IF EXISTS auth CASCADE'); vi.unstubAllGlobals(); });

describe('el rol vigente sale de auth.users, no del token', () => {
  it('el token no trae el módulo pero la asignación sí: entra con ese rol', async () => {
    const r = await (await as(ANA, 'ana@intransit.test')).get('/api/auth/me');
    expect(r.status).toBe(200); expect(r.body.role).toBe('supervisor');
  });
  it('el token dice administrador pero la asignación ya no: manda la asignación', async () => {
    const t = await tok(TRA, 'piloto@intransit.test', { operaciones: 'administrador' });
    const r = await request(app).get('/api/meta').set('Authorization', 'Bearer ' + t);
    expect(r.status).toBe(403); expect(r.body.error).toBe('MODULO_NO_ASIGNADO');
  });
});

describe('el administrador de Operaciones da acceso', () => {
  it('lista solo las cuentas con Operaciones', async () => {
    await (await as(ANA, 'ana@intransit.test')).get('/api/meta');
    const r = await (await as(ADM, 'jefe@intransit.test')).get('/api/usuarios');
    expect(r.status).toBe(200);
    expect(r.body.map((u: any) => u.email).sort()).toEqual(['ana@intransit.test', 'jefe@intransit.test']);
    expect(r.body.find((u: any) => u.id === ANA).role).toBe('supervisor');
  });
  it('a una cuenta existente de Transportes le agrega Operaciones y conserva su otro módulo', async () => {
    const r = await (await as(ADM, 'jefe@intransit.test')).post('/api/usuarios').send({ email: 'PILOTO@intransit.test', name: 'Piloto', role: 'operador' });
    expect(r.status).toBe(201); expect(r.body).toMatchObject({ id: TRA, role: 'operador', existente: true });
    expect(await modsOf(TRA)).toEqual({ transportes: 'ADMIN', operaciones: 'operador' });
    expect((await (await as(TRA, 'piloto@intransit.test')).get('/api/auth/me')).body.role).toBe('operador');
    const again = await (await as(ADM, 'jefe@intransit.test')).post('/api/usuarios').send({ email: 'piloto@intransit.test', name: 'Piloto', role: 'consulta' });
    expect(again.status).toBe(409);
  });
  it('una cuenta nueva se crea en Supabase Auth con su rol', async () => {
    const calls: any[] = [];
    vi.stubGlobal('fetch', async (url: string, init: any) => {
      calls.push({ url, init, body: JSON.parse(init.body) });
      await authUser(NEW, 'nueva@intransit.test', JSON.parse(init.body).app_metadata.modulos);
      return new Response(JSON.stringify({ id: NEW }), { status: 200 });
    });
    const s = await as(ADM, 'jefe@intransit.test');
    expect((await s.post('/api/usuarios').send({ email: 'nueva@intransit.test', name: 'Nueva', role: 'consulta', password: 'corta' })).status).toBe(400);
    const r = await s.post('/api/usuarios').send({ email: 'nueva@intransit.test', name: 'Nueva Persona', role: 'consulta', password: 'ClaveSegura2026' });
    vi.unstubAllGlobals();
    expect(r.status).toBe(201); expect(r.body).toMatchObject({ id: NEW, role: 'consulta', existente: false });
    expect(calls).toHaveLength(1); expect(calls[0].url).toBe('https://refprueba.supabase.co/auth/v1/admin/users');
    expect(calls[0].init.headers.Authorization).toBe('Bearer clave-servicio-prueba');
    expect(calls[0].body).toMatchObject({ email: 'nueva@intransit.test', email_confirm: true, user_metadata: { full_name: 'Nueva Persona' }, app_metadata: { modulos: { operaciones: 'consulta' } } });
  });
  it('cambiar el rol aplica en el siguiente acceso; nombre y contraseña no se cambian aquí', async () => {
    const s = await as(ADM, 'jefe@intransit.test');
    const r = await s.patch('/api/usuarios/' + ANA).send({ role: 'consulta' });
    expect(r.status).toBe(200); expect(r.body.role).toBe('consulta');
    expect((await (await as(ANA, 'ana@intransit.test')).get('/api/auth/me')).body.role).toBe('consulta');
    expect((await s.patch('/api/usuarios/' + ANA).send({ password: 'OtraClave2026' })).status).toBe(409);
    expect((await s.patch('/api/usuarios/' + ADM).send({ role: 'operador' })).body.error).toBe('AUTOBLOQUEO');
  });
  it('suspender bloquea el acceso a Operaciones', async () => {
    const s = await as(ADM, 'jefe@intransit.test');
    expect((await s.patch('/api/usuarios/' + ANA).send({ active: false })).body.active).toBe(false);
    const r = await (await as(ANA, 'ana@intransit.test')).get('/api/meta');
    expect(r.status).toBe(403); expect(r.body.error).toBe('USUARIO_INACTIVO');
  });
  it('un supervisor no gestiona usuarios', async () => {
    await pool.query(`UPDATE auth.users SET raw_app_meta_data = jsonb_set(raw_app_meta_data, '{modulos,operaciones}', '"supervisor"') WHERE id = $1`, [TRA]);
    expect((await (await as(TRA, 'piloto@intransit.test')).get('/api/usuarios')).status).toBe(403);
  });
});
