// Maquilas por sede (migración 008): proyectos propios de cada sede, actividades, confirmación del cliente
// antes de iniciar (Alnost, Xporta) y desglose de la salida (cartón A/B/C en San Juan).
import { beforeAll, describe, expect, it } from 'vitest';
import { app, login, request, resetDb } from './helpers.js';

let t = '', cat: any;
const en = (sede: string) => {
  const w = (m: 'get' | 'post' | 'put' | 'patch') => (url: string) => request(app)[m](url).set('Authorization', 'Bearer ' + t).set('X-Sede', sede);
  return { get: w('get'), post: w('post'), put: w('put'), patch: w('patch') };
};
const proj = (sede: string, client: string, name: string) => {
  const c = cat.clients.find((x: any) => x.code === client);
  return cat.projects.find((p: any) => p.sedeId === sede && p.clientId === c.id && p.name === name);
};
const hace = (min: number) => new Date(Date.now() - min * 60_000).toISOString();

beforeAll(async () => {
  await resetDb(true);
  t = await login('admin');
  cat = (await en('OMNIA').get('/api/catalogo')).body;
});

describe('catálogo por sede (lista del 2026-10-30)', () => {
  it('cada sede tiene sus clientes y proyectos', async () => {
    const activos = (sede: string) => cat.projects.filter((p: any) => p.sedeId === sede && p.active)
      .map((p: any) => `${cat.clients.find((c: any) => c.id === p.clientId).code} · ${p.name}`).sort();
    expect(activos('SAN-JUAN')).toEqual(['FRITOLAY · Maquilado de cartón']);
    expect(activos('Z11')).toEqual([
      'ALNOST · Validación de fechas', 'CEBOLLINES · Maquila de packs', 'COCACOLA · Armado de packs', 'COCACOLA · Desarme',
      'COCACOLA · Trasiego de envase', 'COCACOLA · Trasiego de tarimas', 'LICORERA · Maquila de ofertas', 'XPORTA · Etiquetado',
    ]);
    const omnia = activos('OMNIA');
    for (const n of ['Maquila', 'Walmart', 'Etiquetado', 'Descargas', 'Embolsado Cobán', 'Crackets']) expect(omnia).toContain('FRITOLAY · ' + n);
    expect(omnia.every((x: string) => x.startsWith('FRITOLAY'))).toBe(true);
    expect(omnia).not.toContain('FRITOLAY · Outsourcing');   // Outsourcing es una categoría, no un proyecto
  });

  it('categorías de servicio: Maquila (la principal) y Outsourcing', () => {
    const out = cat.projects.filter((p: any) => p.category === 'OUTSOURCING').map((p: any) => p.name).sort();
    expect(out).toEqual(['Dollar City', 'Revisión', 'Sunchips', 'Unisuper']);
    expect(proj('SAN-JUAN', 'FRITOLAY', 'Maquilado de cartón').category).toBe('MAQUILA');
    expect(proj('Z11', 'COCACOLA', 'Desarme').category).toBe('MAQUILA');
  });

  it('actividades, confirmación y desglose quedan en el proyecto', () => {
    expect(proj('OMNIA', 'FRITOLAY', 'Walmart').activities.map((a: any) => a.name)).toEqual(['Revisión', 'Trasiego', 'Cambio de etiqueta', 'Flejado']);
    const carton = proj('SAN-JUAN', 'FRITOLAY', 'Maquilado de cartón');
    expect(carton.activities.map((a: any) => a.name)).toEqual(['Amarre', 'Tachado', 'Clasificación de cartón']);
    expect(carton.outputParts).toEqual(['Cartón A', 'Cartón B', 'Cartón C']);
    expect(proj('Z11', 'ALNOST', 'Validación de fechas').confirmLabel).toBeTruthy();
    expect(proj('Z11', 'XPORTA', 'Etiquetado').confirmLabel).toMatch(/exportador/i);
    expect(proj('Z11', 'CEBOLLINES', 'Maquila de packs').processNotes).toMatch(/túnel/);
  });

  it('un proyecto nuevo nace en la sede actual y admite actividades', async () => {
    const hilo = en('HILO'), fl = cat.clients.find((c: any) => c.code === 'FRITOLAY');
    const p = await hilo.post('/api/catalogo/proyectos').send({ clientId: fl.id, name: 'Proyecto Hilo', um: 'caja', outputParts: ['Bueno', 'Malo'], category: 'OUTSOURCING' });
    expect(p.status).toBe(201);
    expect(p.body.category).toBe('OUTSOURCING');
    expect((await hilo.patch(`/api/catalogo/proyectos/${p.body.id}`).send({ category: 'MAQUILA' })).body.category).toBe('MAQUILA');
    expect((await hilo.patch(`/api/catalogo/proyectos/${p.body.id}`).send({ category: 'OTRA' })).status).toBe(400);
    expect(p.body.sedeId).toBe('HILO');
    expect(p.body.outputParts).toEqual(['Bueno', 'Malo']);
    const a = await hilo.post(`/api/catalogo/proyectos/${p.body.id}/actividades`).send({ name: 'Revisión de calidad' });
    expect(a.status).toBe(201);
    expect((await hilo.post(`/api/catalogo/proyectos/${p.body.id}/actividades`).send({ name: 'Revisión de calidad' })).status).toBe(409);
    expect((await hilo.patch(`/api/catalogo/actividades/${a.body.id}`).send({ active: false })).body.active).toBe(false);
    const e = await hilo.patch(`/api/catalogo/proyectos/${p.body.id}`).send({ confirmLabel: 'Lote confirmado', processNotes: 'Nota' });
    expect(e.body.confirmLabel).toBe('Lote confirmado');
    expect((await hilo.patch(`/api/catalogo/proyectos/${p.body.id}`).send({ confirmLabel: '' })).body.confirmLabel).toBeNull();
  });
});

describe('órdenes de maquila por sede', () => {
  it('no se programa en una sede el proyecto de otra', async () => {
    const wm = proj('OMNIA', 'FRITOLAY', 'Walmart');
    const r = await en('SAN-JUAN').post('/api/maquila/ordenes').send({ date: (await en('OMNIA').get('/api/meta')).body.today, clientId: wm.clientId, projectId: wm.id });
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/otra sede/);
  });

  it('Walmart: la actividad es obligatoria y debe ser del proyecto', async () => {
    const omnia = en('OMNIA'), today = (await omnia.get('/api/meta')).body.today;
    const wm = proj('OMNIA', 'FRITOLAY', 'Walmart'), flej = wm.activities.find((a: any) => a.name === 'Flejado');
    const ajena = proj('OMNIA', 'FRITOLAY', 'Crackets').activities[0];
    const sin = await omnia.post('/api/maquila/ordenes').send({ date: today, clientId: wm.clientId, projectId: wm.id });
    expect(sin.status).toBe(400);
    expect(sin.body.message).toMatch(/Selecciona la actividad/);
    expect((await omnia.post('/api/maquila/ordenes').send({ date: today, clientId: wm.clientId, projectId: wm.id, activityId: ajena.id })).status).toBe(400);
    const o = await omnia.post('/api/maquila/ordenes').send({ date: today, clientId: wm.clientId, projectId: wm.id, activityId: flej.id, targetQty: 50 });
    expect(o.status).toBe(201);
    expect(o.body.activityName).toBe('Flejado');
    // al cambiar de proyecto, la actividad de Walmart deja de valer: hay que indicar la del proyecto nuevo
    const etq = proj('OMNIA', 'FRITOLAY', 'Etiquetado');
    expect((await omnia.patch(`/api/maquila/ordenes/${o.body.id}`).send({ projectId: etq.id, version: o.body.version })).status).toBe(400);
    const u = await omnia.patch(`/api/maquila/ordenes/${o.body.id}`).send({ projectId: etq.id, activityId: etq.activities[0].id, version: o.body.version });
    expect(u.status).toBe(200);
    expect(u.body.activityName).toBe('Etiquetado');
  });

  it('Xporta: no inicia sin la confirmación del exportador', async () => {
    const z11 = en('Z11'), today = (await z11.get('/api/meta')).body.today;
    const xp = proj('Z11', 'XPORTA', 'Etiquetado');
    const o = await z11.post('/api/maquila/ordenes').send({ date: today, clientId: xp.clientId, projectId: xp.id, targetQty: 200 });
    expect(o.status).toBe(201);
    const s = await z11.post(`/api/maquila/ordenes/${o.body.id}/iniciar`).send({ startedAt: hace(30) });
    expect(s.status).toBe(409);
    expect(s.body.error).toBe('FALTA_CONFIRMACION');
    const c = await z11.post(`/api/maquila/ordenes/${o.body.id}/confirmar`).send({ text: 'Exportador de prueba' });
    expect(c.status).toBe(200);
    expect(c.body.clientConfirmation).toBe('Exportador de prueba');
    expect(c.body.confirmedAt).toBeTruthy();
    expect((await z11.post(`/api/maquila/ordenes/${o.body.id}/iniciar`).send({ startedAt: hace(30) })).body.status).toBe('EN_PROCESO');
  });

  it('Alnost: la confirmación puede venir al programar', async () => {
    const z11 = en('Z11'), today = (await z11.get('/api/meta')).body.today;
    const vf = proj('Z11', 'ALNOST', 'Validación de fechas');
    const o = await z11.post('/api/maquila/ordenes').send({ date: today, clientId: vf.clientId, projectId: vf.id, clientConfirmation: 'Producto y fecha validados por WhatsApp' });
    expect(o.status).toBe(201);
    expect((await z11.post(`/api/maquila/ordenes/${o.body.id}/iniciar`).send({ startedAt: hace(30) })).body.status).toBe('EN_PROCESO');
  });

  it('San Juan: el cierre se presenta en cartón A, B y C y suma la cantidad', async () => {
    const sj = en('SAN-JUAN'), today = (await sj.get('/api/meta')).body.today;
    const carton = proj('SAN-JUAN', 'FRITOLAY', 'Maquilado de cartón'), amarre = carton.activities[0];
    const o = await sj.post('/api/maquila/ordenes').send({ date: today, clientId: carton.clientId, projectId: carton.id, activityId: amarre.id });
    expect(o.status).toBe(201);
    expect(o.body.outputParts).toEqual(['Cartón A', 'Cartón B', 'Cartón C']);
    await sj.post(`/api/maquila/ordenes/${o.body.id}/iniciar`).send({ startedAt: hace(60) });
    expect((await sj.post(`/api/maquila/ordenes/${o.body.id}/cerrar`).send({ producedQty: 10 })).status).toBe(400);
    expect((await sj.post(`/api/maquila/ordenes/${o.body.id}/cerrar`).send({ producedDetail: { 'Cartón D': 1 } })).status).toBe(400);
    expect((await sj.post(`/api/maquila/ordenes/${o.body.id}/cerrar`).send({ producedQty: 5, producedDetail: { 'Cartón A': 100 } })).status).toBe(400);
    const c = await sj.post(`/api/maquila/ordenes/${o.body.id}/cerrar`).send({ producedDetail: { 'Cartón A': 120, 'Cartón B': 45.5, 'Cartón C': 10 } });
    expect(c.status).toBe(200);
    expect(Number(c.body.producedQty)).toBe(175.5);
    expect(c.body.producedDetail).toEqual({ 'Cartón A': 120, 'Cartón B': 45.5, 'Cartón C': 10 });
    // un proyecto sin desglose no lo acepta
    const om = en('OMNIA'), mq = proj('OMNIA', 'FRITOLAY', 'Maquila');
    const o2 = await om.post('/api/maquila/ordenes').send({ date: today, clientId: mq.clientId, projectId: mq.id, activityId: mq.activities[0].id });
    await om.post(`/api/maquila/ordenes/${o2.body.id}/iniciar`).send({ startedAt: hace(60) });
    expect((await om.post(`/api/maquila/ordenes/${o2.body.id}/cerrar`).send({ producedDetail: { 'Cartón A': 1 } })).status).toBe(400);
  });

  it('una sede con solo maquilas cierra su mes, y el cierre bloquea solo sus maquilas', async () => {
    const om = en('OMNIA'), sj = en('SAN-JUAN'), hilo = en('HILO');
    const mq = proj('OMNIA', 'FRITOLAY', 'Maquila'), carton = proj('SAN-JUAN', 'FRITOLAY', 'Maquilado de cartón');
    const today: string = (await om.get('/api/meta')).body.today, mes = today.slice(0, 7);
    // una sede sin producción, horas ni maquilas sigue sin poder cerrar
    expect((await hilo.get(`/api/periodos/${mes}/precierre`)).body.blockers.join()).toMatch(/ni maquilas/);
    // San Juan solo tiene maquilas: puede cerrar; las abiertas quedan como aviso
    const abierta = await sj.post('/api/maquila/ordenes').send({ date: today, clientId: carton.clientId, projectId: carton.id, activityId: carton.activities[1].id });
    expect(abierta.status).toBe(201);
    const pre = (await sj.get(`/api/periodos/${mes}/precierre`)).body;
    expect(pre.blockers).toEqual([]);
    expect(pre.warnings.join()).toContain('maquila(s) programada(s) o en proceso');
    expect((await sj.post(`/api/periodos/${mes}/cerrar`).send({ acknowledgeWarnings: true, notes: 'Cierre de San Juan solo con maquilas' })).status).toBe(200);
    const bloqueada = await sj.post('/api/maquila/ordenes').send({ date: today, clientId: carton.clientId, projectId: carton.id, activityId: carton.activities[0].id });
    expect(bloqueada.status).toBe(423);
    expect(bloqueada.body.error).toBe('PERIODO_CERRADO');
    expect((await om.post('/api/maquila/ordenes').send({ date: today, clientId: mq.clientId, projectId: mq.id, activityId: mq.activities[0].id })).status).toBe(201);
  });
});

describe('otros módulos respetan la sede del proyecto', () => {
  it('Producción y Comercial', async () => {
    const coca = proj('Z11', 'COCACOLA', 'Desarme');
    const r = await en('OMNIA').post('/api/produccion').send({ kind: 'gen', projectId: coca.id, date: '2026-10-20', boxes: 5, refDoc: 'X-1' });
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/otra sede/);
    const tar = (await en('Z11').get('/api/comercial/tarifas')).body.projects;
    expect(tar.some((p: any) => p.id === coca.id)).toBe(true);
    expect(tar.some((p: any) => p.name === 'Walmart')).toBe(false);
  });
});
