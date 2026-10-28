// Maquilas: base operativa separada de viajes. Personas, órdenes, asignación, inicio/cierre
// y visibilidad de secciones por perfil. La facturación se prueba en su propia fase.
import { beforeAll, describe, expect, it } from 'vitest';
import { app, as, request, resetDb } from './helpers.js';

let admin: Awaited<ReturnType<typeof as>>;
let project: any, client: any, today: string, coordToken = '';

beforeAll(async () => {
  await resetDb(true);
  admin = await as('admin');
  const cat = (await admin.get('/api/catalogo')).body;
  client = cat.clients.find((c: any) => c.active);
  project = cat.projects.find((p: any) => p.active && p.clientId === client.id);
  today = (await admin.get('/api/meta')).body.today;
});

describe('permisos de Maquilas', () => {
  it('un operador no ve maquilas; el administrador sí', async () => {
    expect((await (await as('operador')).get('/api/maquila/ordenes')).status).toBe(403);
    expect((await admin.get('/api/maquila/ordenes')).status).toBe(200);
  });
  it('el coordinador opera pero no administra secciones', async () => {
    const r = await admin.post('/api/usuarios').send({ email: 'coord@omnia.local', name: 'Coordinador Prueba', role: 'coordinador', password: 'Clave2026segura' });
    expect(r.status).toBe(201);
    const l = await request(app).post('/api/auth/login').send({ email: 'coord@omnia.local', password: 'Clave2026segura' });
    expect(l.status).toBe(200);
    const t = 'Bearer ' + l.body.token;
    coordToken = l.body.token;
    expect((await request(app).get('/api/maquila/ordenes').set('Authorization', t)).status).toBe(200);
    expect((await request(app).get('/api/maquila/admin/secciones').set('Authorization', t)).status).toBe(403);
  });
});

describe('flujo de una maquila', () => {
  it('persona, orden, asignación, inicio y cierre', async () => {
    const p = await admin.post('/api/maquila/personas').send({ code: 'M-001', name: 'Ana Maquila', position: 'Maquiladora' });
    expect(p.status).toBe(201);

    const o = await admin.post('/api/maquila/ordenes').send({
      date: today, shift: 'DIA', clientId: client.id, projectId: project.id,
      sap: 'SAP-1', productName: 'Producto de prueba', targetQty: 100, unit: 'CAJA',
    });
    expect(o.status).toBe(201);
    expect(o.body.status).toBe('PROGRAMADA');

    const a = await admin.put(`/api/maquila/ordenes/${o.body.id}/asignaciones`).send({ personas: [{ personId: p.body.id, qtyAssigned: 100 }] });
    expect(a.status).toBe(200);
    expect(a.body.assignments.filter((x: any) => x.active)).toHaveLength(1);

    const s = await admin.post(`/api/maquila/ordenes/${o.body.id}/iniciar`).send({ startedAt: new Date(Date.now() - 60_000).toISOString() });
    expect(s.status).toBe(200);
    expect(s.body.status).toBe('EN_PROCESO');
    expect(s.body.startedAt).toBeTruthy();

    const c = await admin.post(`/api/maquila/ordenes/${o.body.id}/cerrar`).send({ producedQty: 95, notes: 'Cierre de prueba' });
    expect(c.status).toBe(200);
    expect(c.body.status).toBe('CERRADA');
    expect(Number(c.body.producedQty)).toBe(95);

    const pend = await admin.get(`/api/maquila/por-facturar?from=${today}&to=${today}`);
    expect(pend.status).toBe(200);
    expect(pend.body.find((x: any) => x.id === o.body.id)).toBeUndefined();
  });

  it('no se cierra una orden que no está en proceso', async () => {
    const o = await admin.post('/api/maquila/ordenes').send({ date: today, clientId: client.id, projectId: project.id, targetQty: 10 });
    expect(o.status).toBe(201);
    const c = await admin.post(`/api/maquila/ordenes/${o.body.id}/cerrar`).send({ producedQty: 5 });
    expect(c.status).toBe(409);
    expect(c.body.error).toBe('ESTADO_INVALIDO');
  });
});


async function crearCerrada(projectId: string, clientId = client.id, qty = 10) {
  const o = await admin.post('/api/maquila/ordenes').send({ date: today, shift: 'DIA', clientId, projectId, targetQty: qty, unit: 'CAJA' });
  expect(o.status).toBe(201);
  const s = await admin.post(`/api/maquila/ordenes/${o.body.id}/iniciar`).send({ startedAt: new Date(Date.now() - 60_000).toISOString() });
  expect(s.status).toBe(200);
  const c = await admin.post(`/api/maquila/ordenes/${o.body.id}/cerrar`).send({ producedQty: qty });
  expect(c.status).toBe(200);
  return o.body.id as string;
}

async function validarTodo(id: string) {
  expect((await admin.post(`/api/maquila/ordenes/${id}/validar-sop`).send({ decision: 'APROBADA' })).body.status).toBe('VALIDADA_SOP');
  expect((await admin.post(`/api/maquila/ordenes/${id}/validar-jefatura`).send({ decision: 'APROBADA' })).body.status).toBe('VALIDADA_JEFATURA');
  expect((await admin.post(`/api/maquila/ordenes/${id}/validar`).send({ decision: 'APROBADA' })).body.status).toBe('VALIDADA');
}

describe('validaciones y cargos', () => {
  it('SOP, jefatura y validador; el coordinador no valida', async () => {
    const id = await crearCerrada(project.id);
    const denied = await request(app).post(`/api/maquila/ordenes/${id}/validar-sop`).set('Authorization', 'Bearer ' + coordToken).send({ decision: 'APROBADA' });
    expect(denied.status).toBe(403);
    await validarTodo(id);
    const pend = await admin.get(`/api/maquila/por-facturar?from=${today}&to=${today}`);
    expect(pend.body.find((x: any) => x.id === id)).toBeTruthy();
  });

  it('el rechazo exige motivo y la reapertura devuelve a proceso', async () => {
    const id = await crearCerrada(project.id);
    const short = await admin.post(`/api/maquila/ordenes/${id}/validar-sop`).send({ decision: 'RECHAZADA', reason: 'no' });
    expect(short.status).toBe(400);
    const r = await admin.post(`/api/maquila/ordenes/${id}/validar-sop`).send({ decision: 'RECHAZADA', reason: 'Cantidad mal registrada' });
    expect(r.body.status).toBe('RECHAZADA');
    const re = await admin.post(`/api/maquila/ordenes/${id}/reabrir`).send({ reason: 'Corregir cantidad' });
    expect(re.body.status).toBe('EN_PROCESO');
  });

  it('crea el cargo con tarifa, lo cierra y al anularlo libera la maquila', async () => {
    const np = await admin.post('/api/catalogo/proyectos').send({ clientId: client.id, name: 'Proyecto maquila ' + Date.now(), um: 'CAJA' });
    expect(np.status).toBe(201);
    const rate = await admin.post('/api/comercial/tarifas').send({ projectId: np.body.id, rate: 2.5, unit: 'CAJA', validFrom: today });
    expect(rate.status).toBe(201);
    const id = await crearCerrada(np.body.id, client.id, 10);
    await validarTodo(id);
    const cargo = await admin.post('/api/maquila/cargos').send({ clientId: client.id, periodKind: 'MES', periodKey: 'P' + Date.now(), orderIds: [id] });
    expect(cargo.status).toBe(201);
    expect(cargo.body.status).toBe('ABIERTO');
    expect(Number(cargo.body.total)).toBe(25);
    const pend = await admin.get(`/api/maquila/por-facturar?from=${today}&to=${today}`);
    expect(pend.body.find((x: any) => x.id === id)).toBeUndefined();
    const closed = await admin.post(`/api/maquila/cargos/${cargo.body.id}/cerrar`).send({});
    expect(closed.body.status).toBe('CERRADO');
    const ann = await admin.post(`/api/maquila/cargos/${cargo.body.id}/anular`).send({ reason: 'Prueba de anulación' });
    expect(ann.body.status).toBe('ANULADO');
    const ord = await admin.get(`/api/maquila/ordenes/${id}`);
    expect(ord.body.status).toBe('VALIDADA');
    expect(ord.body.statementId).toBeNull();
  });
});

describe('secciones por perfil', () => {
  it('/api/meta publica las secciones y se pueden apagar', async () => {
    const meta = (await admin.get('/api/meta')).body;
    expect(meta.secciones).toContain('programacion');
    const off = await admin.put('/api/maquila/admin/secciones/coordinador/programacion').send({ habilitado: false });
    expect(off.status).toBe(200);
    const l = await request(app).post('/api/auth/login').send({ email: 'coord@omnia.local', password: 'Clave2026segura' });
    const r = await request(app).get('/api/maquila/secciones').set('Authorization', 'Bearer ' + l.body.token);
    expect(r.body.secciones).not.toContain('programacion');
    expect(r.body.secciones).toContain('personas');
  });
});
