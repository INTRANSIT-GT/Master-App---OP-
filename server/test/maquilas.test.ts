// Maquilas: base operativa separada de viajes. Personas, órdenes, asignación, inicio/cierre
// y visibilidad de secciones por perfil. La facturación se prueba en su propia fase.
import { beforeAll, describe, expect, it } from 'vitest';
import { app, as, request, resetDb } from './helpers.js';

let admin: Awaited<ReturnType<typeof as>>;
let project: any, client: any, today: string;

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
