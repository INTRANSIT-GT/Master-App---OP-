// Sedes (db/migrations/003_sedes.sql): cada sede ve solo sus registros; cada usuario entra en las sedes asignadas
// (el administrador, en todas) y la web elige la sede con el encabezado X-Sede.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app, login, pool, request, resetDb } from './helpers.js';

const en = async (role: Parameters<typeof login>[0], sede?: string) => {
  const t = await login(role);
  const w = (m: 'get' | 'post' | 'put' | 'patch') => (url: string) => { const r = request(app)[m](url).set('Authorization', 'Bearer ' + t); return sede ? r.set('X-Sede', sede) : r; };
  return { get: w('get'), post: w('post'), put: w('put'), patch: w('patch') };
};
const rec = { kind: 'crk', date: '2026-10-13', refDoc: 'F-SEDE', productName: 'CRACKETS MINISW CAM 38GRX64X1', boxes: 40, badBoxes: 1 };
const idOf = async (email: string) => (await pool.query('SELECT id FROM users WHERE email = $1', [email])).rows[0].id as string;

beforeAll(async () => { await resetDb(true); });
afterAll(async () => { await pool.end(); });

describe('acceso por sede', () => {
  it('el administrador ve las 4 sedes; sin X-Sede trabaja en la primera (Omnia)', async () => {
    const m = await (await en('admin')).get('/api/meta');
    expect(m.status).toBe(200);
    expect(m.body.sedes.map((s: any) => s.name)).toEqual(['SEDE FRITOLAY OMNIA', 'SEDE FRITOLAY SAN JUAN', 'SEDE HILO', 'SEDE INTRANSIT Z11']);
    expect(m.body.sede).toEqual({ id: 'OMNIA', name: 'SEDE FRITOLAY OMNIA' });
    expect((await (await en('admin', 'HILO')).get('/api/meta')).body.sede.id).toBe('HILO');
  });
  it('los usuarios existentes quedan en Omnia y no entran a otra sede', async () => {
    const s = await en('supervisor');
    expect((await s.get('/api/meta')).body.sedes).toEqual([{ id: 'OMNIA', name: 'SEDE FRITOLAY OMNIA' }]);
    const r = await (await en('supervisor', 'HILO')).get('/api/produccion');
    expect(r.status).toBe(403); expect(r.body.error).toBe('SEDE_NO_ASIGNADA');
  });
  it('sin sedes asignadas: /meta responde sin sede y el resto pide una', async () => {
    await pool.query(`DELETE FROM user_sedes WHERE user_id = $1`, [await idOf('consulta@omnia.local')]);
    const { resetSedeCache } = await import('../src/sede.js'); resetSedeCache();
    const c = await en('consulta');
    const m = await c.get('/api/meta');
    expect(m.status).toBe(200); expect(m.body.sede).toBeNull(); expect(m.body.sedes).toEqual([]);
    const r = await c.get('/api/produccion');
    expect(r.status).toBe(403); expect(r.body.error).toBe('SIN_SEDE');
  });
});

describe('los datos se separan por sede', () => {
  it('lo capturado en Hilo no aparece en Omnia, ni en sus resultados', async () => {
    const hilo = await en('admin', 'HILO'), omnia = await en('admin', 'OMNIA');
    const antes = (await omnia.get('/api/resultados?mes=2026-10')).body.results.lines.find((l: any) => l.k === 'crk')?.q ?? 0;
    expect((await hilo.get('/api/produccion')).body.total).toBe(0);
    const c = await hilo.post('/api/produccion').send(rec);
    expect(c.status).toBe(201); expect(c.body.sedeId).toBe('HILO');
    expect((await hilo.get('/api/produccion')).body.total).toBe(1);
    expect((await omnia.get('/api/produccion?q=F-SEDE')).body.rows.some((r: any) => r.id === c.body.id)).toBe(false);
    expect((await omnia.get(`/api/produccion/${c.body.id}`)).status).toBe(404);
    expect((await omnia.patch(`/api/produccion/${c.body.id}`).send({ boxes: 1, version: 1 })).status).toBe(404);
    const crkHilo = (await hilo.get('/api/resultados?mes=2026-10')).body.results.lines.find((l: any) => l.k === 'crk');
    expect(crkHilo.q).toBeGreaterThan(0);
    expect((await omnia.get('/api/resultados?mes=2026-10')).body.results.lines.find((l: any) => l.k === 'crk')?.q ?? 0).toBe(antes);
  });
  it('el mismo registro puede existir en dos sedes sin marcarse como duplicado', async () => {
    expect((await (await en('admin', 'OMNIA')).post('/api/produccion').send(rec)).status).toBe(201);
    const dup = await (await en('admin', 'HILO')).post('/api/produccion').send(rec);
    expect(dup.status).toBe(409); expect(dup.body.error).toBe('DUPLICADO');   // dentro de la misma sede sí lo es
  });
  it('la asistencia y los conteos de inventario son de cada sede', async () => {
    const hilo = await en('admin', 'HILO'), omnia = await en('admin', 'OMNIA');
    expect((await hilo.put('/api/asistencia/2026-10-12').send({ paidHours: 77 })).status).toBe(200);
    expect((await hilo.get('/api/asistencia?from=2026-10-12&to=2026-10-12')).body[0].paidHours).toBe(77);
    expect((await omnia.get('/api/asistencia?from=2026-10-12&to=2026-10-12')).body[0]?.paidHours).not.toBe(77);
    expect((await hilo.get('/api/inventario/conteos')).body).toEqual([]);
    expect((await omnia.get('/api/inventario/conteos')).body.length).toBeGreaterThan(0);
  });
  it('cerrar el periodo de Hilo no bloquea Omnia', async () => {
    const hilo = await en('admin', 'HILO'), omnia = await en('admin', 'OMNIA');
    const cierre = await hilo.post('/api/periodos/2026-10/cerrar').send({ acknowledgeWarnings: true, notes: 'cierre de Hilo' });
    expect(cierre.status).toBe(200);
    expect((await hilo.get('/api/periodos')).body.find((p: any) => p.month === '2026-10').status).toBe('cerrado');
    expect((await omnia.get('/api/periodos')).body.find((p: any) => p.month === '2026-10').status).toBe('abierto');
    expect((await hilo.post('/api/produccion').send({ ...rec, refDoc: 'F-CERRADO' })).status).toBe(423);
    expect((await omnia.post('/api/produccion').send({ ...rec, refDoc: 'F-ABIERTO' })).status).toBe(201);
  });
  it('la bitácora muestra los cambios de la sede elegida', async () => {
    const enHilo = (await (await en('admin', 'HILO')).get('/api/auditoria?entity=produccion')).body;
    expect(enHilo.length).toBeGreaterThan(0);
    expect(enHilo.every((a: any) => a.after?.sedeId === 'HILO')).toBe(true);
  });
  it('el Excel del mes lleva la sede en el nombre', async () => {
    const r = await (await en('admin', 'HILO')).get('/api/exportar/excel?mes=2026-10');
    expect(r.status).toBe(200); expect(r.headers['content-disposition']).toContain('InTransit_Operaciones_HILO_2026-10.xlsx');
  });
});

describe('asignación de sedes', () => {
  it('el administrador asigna Hilo al supervisor y desde ahí puede entrar', async () => {
    const id = await idOf('supervisor@omnia.local'), a = await en('admin');
    const r = await a.patch(`/api/usuarios/${id}`).send({ sedes: ['OMNIA', 'HILO'] });
    expect(r.status).toBe(200); expect(r.body.sedes).toEqual(['HILO', 'OMNIA']);
    expect((await (await en('supervisor', 'HILO')).get('/api/produccion')).body.total).toBeGreaterThan(0);
    expect((await a.get('/api/usuarios')).body.find((u: any) => u.id === id).sedes).toEqual(['HILO', 'OMNIA']);
  });
  it('un usuario que no es administrador necesita al menos una sede válida', async () => {
    const id = await idOf('operador@omnia.local'), a = await en('admin');
    expect((await a.patch(`/api/usuarios/${id}`).send({ sedes: [] })).status).toBe(400);
    expect((await a.patch(`/api/usuarios/${id}`).send({ sedes: ['NO-EXISTE'] })).status).toBe(400);
  });
  it('un usuario nuevo sin sedes recibe la sede de quien lo crea', async () => {
    const r = await (await en('admin', 'Z11')).post('/api/usuarios').send({ email: 'nuevo.z11@omnia.local', name: 'Nuevo Z11', role: 'operador', password: 'Clave2026segura' });
    expect(r.status).toBe(201); expect(r.body.sedes).toEqual(['Z11']);
  });
  it('se puede agregar una sede y desactivarla', async () => {
    const a = await en('admin');
    const r = await a.post('/api/sedes').send({ name: 'Sede Prueba Norte' });
    expect(r.status).toBe(201); expect(r.body).toMatchObject({ id: 'PRUEBA-NORTE', name: 'SEDE PRUEBA NORTE', active: true });
    expect((await a.patch('/api/sedes/PRUEBA-NORTE').send({ active: false })).body.active).toBe(false);
    expect((await a.get('/api/meta')).body.sedes.map((s: any) => s.id)).not.toContain('PRUEBA-NORTE');
    expect((await (await en('supervisor')).post('/api/sedes').send({ name: 'Otra' })).status).toBe(403);
  });
});
