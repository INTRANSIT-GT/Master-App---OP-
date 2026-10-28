// Operaciones como módulo: ruta base, manifiesto y configuración pública (acceso local).
import { vi } from 'vitest';
vi.hoisted(() => { process.env.BASE_PATH = 'operaciones/'; });
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { moduleAccess } from '../src/sso.js';
import { app, resetDb } from './helpers.js';

beforeAll(async () => { await resetDb(true); });

describe('ruta base /operaciones', () => {
  it('sirve la API bajo la ruta base y no en la raíz', async () => {
    expect((await request(app).get('/operaciones/api/health')).body).toMatchObject({ ok: true, module: 'operaciones' });
    expect((await request(app).get('/api/health')).status).toBe(404);
  });
  it('redirige / y /operaciones a /operaciones/ (la web usa rutas relativas)', async () => {
    const a = await request(app).get('/'), b = await request(app).get('/operaciones');
    expect(a.status).toBe(302); expect(a.headers.location).toBe('/operaciones/');
    expect(b.status).toBe(302); expect(b.headers.location).toBe('/operaciones/');
  });
  it('/operaciones/ responde directamente (sin ciclo de redirecciones)', async () => {
    const r = await request(app).get('/operaciones/');
    expect([200, 404]).toContain(r.status);   // 200 con la web compilada; 404 si aún no se ha compilado
    expect(r.headers.location).toBeUndefined();
  });
  it('el manifiesto es público e identifica el módulo, la entrada y de dónde sale la asignación', async () => {
    const r = await request(app).get('/operaciones/api/modulo');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ id: 'operaciones', nombre: 'Operaciones', basePath: '/operaciones', entrada: '/operaciones/', api: '/operaciones/api', authMode: 'local', asignacion: { claim: 'app_metadata.modulos', clave: 'operaciones' } });
    expect(r.body.roles).toEqual(['administrador', 'supervisor', 'operador', 'consulta', 'comercial', 'coordinador', 'gerente_op', 'supervisor_op', 'jefatura_op', 'validador', 'facturacion', 'cobros']);
  });
  it('config.js publica la ruta base y ningún secreto', async () => {
    const r = await request(app).get('/operaciones/config.js');
    expect(r.headers['content-type']).toMatch(/javascript/);
    expect(r.text).toContain('"basePath":"/operaciones"');
    expect(r.text).not.toMatch(/secret|test-secret|password/i);
  });
  it('el acceso local sigue funcionando bajo la ruta base', async () => {
    const l = await request(app).post('/operaciones/api/auth/login').send({ email: 'supervisor@omnia.local', password: 'Omnia2026!demo' });
    expect(l.status).toBe(200);
    const r = await request(app).get('/operaciones/api/meta').set('Authorization', 'Bearer ' + l.body.token);
    expect(r.status).toBe(200); expect(r.body.module).toMatchObject({ id: 'operaciones', basePath: '/operaciones' }); expect(r.body.authMode).toBe('local');
  });
});

describe('asignación de módulos (app_metadata.modulos)', () => {
  it('objeto: módulo y rol', () => expect(moduleAccess({ modulos: { operaciones: 'Supervisor', transportes: 'ADMIN' } })).toEqual({ assigned: true, role: 'supervisor' }));
  it('lista: módulo asignado con el rol mínimo', () => expect(moduleAccess({ modulos: ['transportes', 'operaciones'] })).toEqual({ assigned: true, role: 'consulta' }));
  it('sin la entrada de operaciones: no asignado', () => { expect(moduleAccess({ modulos: { transportes: 'ADMIN' } }).assigned).toBe(false); expect(moduleAccess({ modulos: ['transportes'] }).assigned).toBe(false); });
  it('sin datos: no asignado', () => { expect(moduleAccess(undefined).assigned).toBe(false); expect(moduleAccess({}).assigned).toBe(false); });
  it('rol desconocido: asignado pero sin rol válido', () => expect(moduleAccess({ modulos: { operaciones: 'ADMIN' } })).toEqual({ assigned: true, role: undefined }));
});
