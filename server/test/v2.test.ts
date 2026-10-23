// v2: clientes/proyectos, retiro de áreas, no borrado, filtro por semana, órdenes de compra, insumos y módulo comercial.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app, as, pool, request, resetDb } from './helpers.js';

beforeAll(async () => { await resetDb(true); });
afterAll(async () => { await pool.end(); });

const proj = async (client: string, code: string) => (await pool.query(`SELECT p.id FROM projects p JOIN clients c ON c.id = p.client_id WHERE c.code = $1 AND p.code = $2`, [client, code])).rows[0].id as string;
const item = async (kind: string) => (await pool.query(`SELECT code FROM inv_items WHERE kind = $1 ORDER BY sort LIMIT 1`, [kind])).rows[0].code as string;

describe('clientes y proyectos', () => {
  it('catálogo trae los 5 clientes y los proyectos pedidos', async () => {
    const s = await as('supervisor'), r = await s.get('/api/catalogo');
    expect(r.body.clients.map((c: any) => c.name)).toEqual(['Fritolay', 'Coca Cola', 'Alnost', 'XPORTA', 'Licorera']);
    const names = (cc: string) => r.body.projects.filter((p: any) => p.clientId === r.body.clients.find((c: any) => c.code === cc).id).map((p: any) => p.name);
    expect(names('FRITOLAY')).toEqual(['Maquila', 'Walmart', 'Embolsado Cobán', 'Descargas', 'Unisuper', 'Dollar City', 'Revisión', 'Etiquetado', 'Sunchips', 'Crackets']);
    expect(names('COCACOLA')).toEqual(['Habilitación de envase - trasiego', 'Habilitación de tarimas - trasiego', 'Packs', 'Desarme']);
    expect(names('ALNOST')).toEqual(['Validación de fechas']); expect(names('XPORTA')).toEqual(['Validación de fechas']); expect(names('LICORERA')).toEqual(['Etiquetado', 'Packs']);
  });
  it('registro genérico de otro cliente: requiere proyecto, no afecta el motor de Fritolay', async () => {
    const o = await as('operador');
    expect((await o.post('/api/produccion').send({ kind: 'gen', date: '2026-10-21', boxes: 10 })).status).toBe(400);
    const before = await (await as('supervisor')).get('/api/resumen?mes=2026-10');
    const r = await o.post('/api/produccion').send({ kind: 'gen', projectId: await proj('COCACOLA', 'PACKS'), date: '2026-10-21', boxes: 500, refDoc: 'PK-1' });
    expect(r.status).toBe(201); expect(r.body.kind).toBe('gen');
    const dup = await o.post('/api/produccion').send({ kind: 'gen', projectId: await proj('COCACOLA', 'PACKS'), date: '2026-10-21', boxes: 500, refDoc: 'PK-1' });
    expect(dup.status).toBe(409); expect(dup.body.error).toBe('DUPLICADO');
    const after = await (await as('supervisor')).get('/api/resumen?mes=2026-10');
    expect(after.body.resumen.T.cost).toBe(before.body.resumen.T.cost); expect(after.body.resumen.T.hh).toBe(before.body.resumen.T.hh);
  });
  it('un proyecto solo admite sus tipos de registro', async () => {
    const o = await as('operador');
    const r = await o.post('/api/produccion').send({ kind: 'wm', projectId: await proj('COCACOLA', 'PACKS'), date: '2026-10-21', boxes: 5 });
    expect(r.status).toBe(400);
  });
  it('registros de Fritolay reciben su proyecto automáticamente; la maquila toma la descripción del catálogo SAP', async () => {
    const o = await as('operador'), sap = (await pool.query(`SELECT sap, name FROM products ORDER BY sort LIMIT 1`)).rows[0];
    const r = await o.post('/api/produccion').send({ kind: 'maq', date: '2026-10-21', sap: sap.sap, boxes: 12 });
    expect(r.status).toBe(201); expect(r.body.productName).toBe(sap.name); expect(r.body.projectId).toBe(await proj('FRITOLAY', 'MAQ'));
    const list = await o.get(`/api/produccion?project=${await proj('FRITOLAY', 'MAQ')}&limit=5`);
    expect(list.body.rows.every((x: any) => x.kind === 'maq')).toBe(true);
  });
  it('solo el administrador crea clientes y proyectos; el proyecto nuevo es genérico', async () => {
    expect((await (await as('supervisor')).post('/api/catalogo/clientes').send({ name: 'Nuevo' })).status).toBe(403);
    const a = await as('admin'), c = await a.post('/api/catalogo/clientes').send({ name: 'Cliente Nuevo' });
    expect(c.status).toBe(201);
    const p = await a.post('/api/catalogo/proyectos').send({ clientId: c.body.id, name: 'Reempaque', um: 'caja' });
    expect(p.status).toBe(201); expect(p.body.kinds).toEqual(['gen']); expect(p.body.um).toBe('CAJA');
  });
});

describe('áreas retiradas y no borrado', () => {
  it('administración, outsourcing, EVN y coordinador ya no se pueden capturar', async () => {
    const s = await as('supervisor');
    for (const kind of ['adm', 'os', 'evn', 'coord']) expect((await s.post('/api/horas').send({ kind, date: '2026-10-20', hoursDay: 8 })).status).toBe(400);
    const m = await catalogLines(); for (const k of ['adm', 'evn', 'osD', 'osN', 'coord']) expect(m).not.toContain(k);
  });
  it('horas de personal de maquila se capturan por proyecto y no alteran HH del motor', async () => {
    const s = await as('supervisor'), before = await s.get('/api/resumen?mes=2026-10');
    const r = await s.post('/api/horas').send({ kind: 'maqp', projectId: await proj('FRITOLAY', 'MAQ'), date: '2026-10-20', workerName: 'Cuadrilla A', hoursDay: 40 });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const after = await s.get('/api/resumen?mes=2026-10');
    expect(after.body.resumen.T.hh).toBe(before.body.resumen.T.hh);
  });
  it('la base de datos impide borrar registros (solo anular)', async () => {
    await expect(pool.query('DELETE FROM production_records')).rejects.toThrow(/REGISTRO_NO_BORRABLE/);
    await expect(pool.query('DELETE FROM audit_log')).rejects.toThrow(/REGISTRO_NO_BORRABLE/);
    const s = await as('supervisor');
    expect((await s.delete('/api/produccion/00000000-0000-0000-0000-000000000000')).status).toBe(404);
  });
  it('editar un confirmado exige motivo y queda en la bitácora; anular exige justificación', async () => {
    const s = await as('supervisor'), r = await s.post('/api/produccion').send({ kind: 'gen', projectId: await proj('ALNOST', 'VF'), date: '2026-10-20', boxes: 100, refDoc: 'AL-1' });
    expect((await s.patch(`/api/produccion/${r.body.id}`).send({ boxes: 120, version: r.body.version })).status).toBe(400);
    const e = await s.patch(`/api/produccion/${r.body.id}`).send({ boxes: 120, version: r.body.version, reason: 'corrección de conteo' });
    expect(e.status).toBe(200);
    expect((await s.post(`/api/produccion/${r.body.id}/anular`).send({ reason: 'x' })).status).toBe(400);
    expect((await s.post(`/api/produccion/${r.body.id}/anular`).send({ reason: 'registro duplicado por error' })).status).toBe(200);
    const h = await s.get(`/api/auditoria?entity=produccion&entityId=${r.body.id}`);
    expect(h.body.map((x: any) => x.action).sort()).toEqual(['anular', 'crear', 'editar']);
  });
});
const catalogLines = async () => (await (await as('supervisor')).get('/api/meta')).body.lines.map((l: any) => l.key) as string[];

describe('filtro por semana', () => {
  it('las semanas suman el mes en costo y HH', async () => {
    const s = await as('supervisor'), m = await s.get('/api/resumen?mes=2026-10');
    expect(m.body.weeks.length).toBe(4);
    let cost = 0, hh = 0;
    for (const w of m.body.weeks) { const r = await s.get(`/api/resumen?mes=2026-10&semana=${w.monday}`); expect(r.status).toBe(200); cost += r.body.resumen.T.cost; hh += r.body.resumen.T.hh; expect(r.body.period.weeks.length).toBe(1); }
    expect(Math.abs(cost - m.body.resumen.T.cost)).toBeLessThan(1e-6); expect(Math.abs(hh - m.body.resumen.T.hh)).toBeLessThan(1e-6);
    expect((await s.get('/api/resumen?mes=2026-10&semana=2026-01-05')).status).toBe(400);
    const d = await s.get(`/api/dashboard?mes=2026-10&semana=${m.body.weeks[1].monday}`);
    expect(d.status).toBe(200); expect(d.body.weekly.length).toBe(4);
  });
});

describe('órdenes de compra e inventario de insumos', () => {
  const oc = (lines: any[], extra: any = {}) => ({ poDate: '2026-10-14', supplier: 'PROVEEDOR PRUEBA', prefix: 'FLEE', costCenter: '2 EMBOCEN', serviceType: '08-TRANSPORTE', currency: 'GTQ', requestedBy: 'Coordinador', lines, ...extra });
  it('flujo completo: crear → emitir → completar ingresa inventario y genera requerimientos; anular revierte', async () => {
    const o = await as('operador'), s = await as('supervisor'), a = await as('admin');
    const ins = await a.post('/api/catalogo/insumos').send({ code: 'TARIMA-T', name: 'Tarima de prueba', unit: 'unidad', price: 90 });
    // otro rol sin permiso
    expect((await (await as('consulta')).post('/api/ordenes-compra').send(oc([]))).status).toBe(403);
    expect((await o.post('/api/ordenes-compra').send(oc([]))).status).toBe(400);
    const lab = await item('lab');
    const created = await o.post('/api/ordenes-compra').send(oc([
      { matType: 'Insumo', matRef: ins.body.id, description: 'Tarima de prueba', qty: 10, unitPrice: 90, code: 'T-1' },
      { matType: 'Etiqueta', matRef: lab, description: 'Etiqueta ' + lab, qty: 3, unitPrice: 100 },
      { matType: 'Otro', area: 'gen', description: 'Flete', qty: 1, unitPrice: 50 },
    ]));
    expect(created.status).toBe(201); expect(created.body.number).toBe('FLEE-1'); expect(created.body.status).toBe('borrador'); expect(created.body.total).toBe(1250);
    const id = created.body.id;
    expect((await o.post(`/api/ordenes-compra/${id}/emitir`)).status).toBe(403);
    expect((await s.post(`/api/ordenes-compra/${id}/completar`).send({})).status).toBe(409);        // primero emitir
    expect((await s.post(`/api/ordenes-compra/${id}/emitir`)).status).toBe(200);
    const inv0 = await s.get('/api/inventario?mes=2026-10'), stock0 = (inv0.body.inventory.rows as any[]).find((r) => r.id === ins.body.id), lab0 = (inv0.body.inventory.rows as any[]).find((r) => r.id === 'L:' + lab);
    const res0 = await s.get('/api/resumen?mes=2026-10');
    expect((await o.post(`/api/ordenes-compra/${id}/completar`).send({})).status).toBe(403);
    const done = await s.post(`/api/ordenes-compra/${id}/completar`).send({ receivedDate: '2026-10-16' });
    expect(done.status).toBe(200); expect(done.body.status).toBe('completada');
    const inv1 = await s.get('/api/inventario?mes=2026-10'), stock1 = (inv1.body.inventory.rows as any[]).find((r) => r.id === ins.body.id), lab1 = (inv1.body.inventory.rows as any[]).find((r) => r.id === 'L:' + lab);
    expect((stock1.ing ?? 0) - (stock0?.ing ?? 0)).toBe(10); expect(stock1.fin - (stock0?.fin ?? 0)).toBe(10);
    expect(lab1.ing).toBeGreaterThan(lab0.ing);
    const res1 = await s.get('/api/resumen?mes=2026-10');
    expect(res0.body.resumen.T.gen === undefined ? 0 : res1.body.resumen.T.gen - res0.body.resumen.T.gen).toBe(50);      // «Otro» general resta costo
    // movimientos/requerimientos generados no se editan ni se anulan por separado
    const mv = (await s.get('/api/insumos/movimientos?limit=50')).body.rows.find((x: any) => x.poLineId);
    expect(mv).toBeTruthy();
    expect((await s.post(`/api/insumos/movimientos/${mv.id}/anular`).send({ reason: 'intento directo' })).status).toBe(409);
    expect((await s.patch(`/api/ordenes-compra/${id}`).send({ version: done.body.version, supplier: 'OTRO', reason: 'cambio no permitido' })).status).toBe(409);
    // anular revierte
    expect((await s.post(`/api/ordenes-compra/${id}/anular`).send({ reason: 'x' })).status).toBe(400);
    expect((await s.post(`/api/ordenes-compra/${id}/anular`).send({ reason: 'orden emitida por error' })).status).toBe(200);
    const inv2 = await s.get('/api/inventario?mes=2026-10'), stock2 = (inv2.body.inventory.rows as any[]).find((r) => r.id === ins.body.id);
    expect(stock2.fin).toBe(stock0?.fin ?? 0);
    const res2 = await s.get('/api/resumen?mes=2026-10'); expect(res2.body.resumen.T.net).toBeCloseTo(res0.body.resumen.T.net, 6);
    const h = await s.get(`/api/ordenes-compra/${id}`); expect(h.body.history.map((x: any) => x.action)).toEqual(['crear', 'emitir', 'completar', 'anular']);
  });
  it('editar una orden emitida exige motivo y respeta la versión; el número es consecutivo por prefijo', async () => {
    const s = await as('supervisor'), c = await s.post('/api/ordenes-compra').send({ ...oc([{ matType: 'Otro', description: 'Servicio X', qty: 2, unitPrice: 10 }]), emitir: true });
    expect(c.status).toBe(201); expect(c.body.number).toBe('FLEE-2'); expect(c.body.status).toBe('emitida');
    expect((await s.patch(`/api/ordenes-compra/${c.body.id}`).send({ version: c.body.version, supplier: 'NUEVO PROVEEDOR' })).status).toBe(400);
    const e = await s.patch(`/api/ordenes-compra/${c.body.id}`).send({ version: c.body.version, supplier: 'NUEVO PROVEEDOR', lines: [{ matType: 'Otro', description: 'Servicio X', qty: 3, unitPrice: 10 }], reason: 'cambia cantidad y proveedor' });
    expect(e.status).toBe(200); expect(e.body.total).toBe(30); expect(e.body.supplier).toBe('NUEVO PROVEEDOR');
    expect((await s.patch(`/api/ordenes-compra/${c.body.id}`).send({ version: c.body.version, supplier: 'X', reason: 'versión vieja' })).status).toBe(409);
    const other = await s.post('/api/ordenes-compra').send(oc([{ matType: 'Otro', description: 'Otro servicio', qty: 1, unitPrice: 5 }], { prefix: 'OCX' }));
    expect(other.body.number).toBe('OCX-1');
  });
  it('líneas inválidas y repetidas se rechazan', async () => {
    const o = await as('operador');
    expect((await o.post('/api/ordenes-compra').send(oc([{ matType: 'Etiqueta', matRef: 'NOEXISTE', description: 'x', qty: 1, unitPrice: 1 }]))).status).toBe(400);
    expect((await o.post('/api/ordenes-compra').send(oc([{ matType: 'Otro', description: 'Igual', qty: 1, unitPrice: 1 }, { matType: 'Otro', description: 'Igual', qty: 2, unitPrice: 1 }]))).status).toBe(400);
  });
  it('OC en USD convierte a quetzales al costo; periodo cerrado bloquea completar', async () => {
    const s = await as('supervisor'), a = await as('admin');
    const c = await s.post('/api/ordenes-compra').send({ ...oc([{ matType: 'Directo', area: 'maq', description: 'Servicio dólares', qty: 100, unitPrice: 0.6 }], { currency: 'USD', exchangeRate: 7.5 }), emitir: true });
    expect(c.body.total).toBe(60);
    const closed = await s.post('/api/periodos/2026-10/cerrar').send({ acknowledgeWarnings: true });
    expect(closed.status).toBe(200);
    const bad = await s.post(`/api/ordenes-compra/${c.body.id}/completar`).send({ receivedDate: '2026-10-16' });
    expect(bad.status).toBe(423);
    expect((await a.post('/api/periodos/2026-10/reabrir').send({ reason: 'prueba de reapertura' })).status).toBe(200);
    const ok = await s.post(`/api/ordenes-compra/${c.body.id}/completar`).send({ receivedDate: '2026-10-16' });
    expect(ok.status).toBe(200);
    const req = (await pool.query(`SELECT amount, area FROM requirements WHERE po_line_id IS NOT NULL AND oc = $1`, [c.body.number])).rows[0];
    expect(req.amount).toBe(450); expect(req.area).toBe('maq');
  });
  it('historial de compras y exportes (Excel/PDF)', async () => {
    const s = await as('supervisor'), h = await s.get('/api/ordenes-compra/historial?from=2026-10-01');
    expect(h.status).toBe(200); expect(h.body.length).toBeGreaterThan(0); expect(h.body[0]).toHaveProperty('supplier');
    const list = (await s.get('/api/ordenes-compra')).body, id = list[0].id;
    const x = await request(app).get(`/api/ordenes-compra/${id}/excel`).set('Authorization', 'Bearer ' + (await (await import('./helpers.js')).login('supervisor'))).buffer(true).parse((res, cb) => { const d: Buffer[] = []; res.on('data', (c: Buffer) => d.push(c)); res.on('end', () => cb(null, Buffer.concat(d))); });
    expect(x.status).toBe(200); expect(x.headers['content-type']).toContain('spreadsheetml'); expect((x.body as Buffer).subarray(0, 2).toString()).toBe('PK');
    const pdf = await request(app).get(`/api/ordenes-compra/${id}/pdf`).set('Authorization', 'Bearer ' + (await (await import('./helpers.js')).login('supervisor'))).buffer(true).parse((res, cb) => { const d: Buffer[] = []; res.on('data', (c: Buffer) => d.push(c)); res.on('end', () => cb(null, Buffer.concat(d))); });
    expect(pdf.status).toBe(200); expect((pdf.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
  });
  it('consumo manual de insumos descuenta stock y se anula sin borrar', async () => {
    const s = await as('supervisor'), a = await as('admin');
    const ins = await a.post('/api/catalogo/insumos').send({ code: 'FILM-T', name: 'Film de prueba', unit: 'rollo', price: 100 });
    const ing = await s.post('/api/insumos/movimientos').send({ date: '2026-10-15', itemId: ins.body.id, kind: 'ingreso', qty: 20 });
    expect(ing.status).toBe(201);
    const con = await s.post('/api/insumos/movimientos').send({ date: '2026-10-17', itemId: ins.body.id, kind: 'consumo', qty: 6, projectId: await proj('COCACOLA', 'PACKS'), area: 'maq' });
    expect(con.status).toBe(201);
    const row = async () => ((await s.get('/api/inventario?mes=2026-10')).body.inventory.rows as any[]).find((r) => r.id === ins.body.id);
    let r = await row(); expect(r.fin).toBe(14); expect(r.con).toBe(6);
    expect((await s.post(`/api/insumos/movimientos/${con.body.id}/anular`).send({ reason: 'captura errónea' })).status).toBe(200);
    r = await row(); expect(r.fin).toBe(20);
    expect((await s.post('/api/insumos/movimientos').send({ date: '2026-10-17', itemId: 'L:3X2', kind: 'consumo', qty: 1 })).status).toBe(400);   // solo insumos
  });
});

describe('módulo comercial', () => {
  it('solo comercial y administrador acceden', async () => {
    for (const r of ['consulta', 'operador', 'supervisor'] as const) expect((await (await as(r)).get('/api/comercial/cobro?mes=2026-10')).status).toBe(403);
    for (const r of ['comercial', 'admin'] as const) expect((await (await as(r)).get('/api/comercial/cobro?mes=2026-10')).status).toBe(200);
    expect((await (await as('supervisor')).post('/api/comercial/tarifas').send({})).status).toBe(403);
  });
  it('Fritolay: el cobro por proceso coincide con el Costo Q del Resumen', async () => {
    const c = await as('comercial'), s = await as('supervisor');
    const cobro = (await c.get('/api/comercial/cobro?mes=2026-10')).body, fl = cobro.clients.find((x: any) => x.name === 'Fritolay');
    const sum = (await s.get('/api/resumen?mes=2026-10')).body.resumen.T.cost;
    expect(Math.abs(fl.total - sum)).toBeLessThan(0.5);
  });
  it('otros clientes: cantidad × tarifa vigente por día; sin tarifa = N/D y se avisa', async () => {
    const c = await as('comercial'), s = await as('supervisor'), p = await proj('XPORTA', 'VF');
    await s.post('/api/produccion').send({ kind: 'gen', projectId: p, date: '2026-10-07', boxes: 100, refDoc: 'X-1' });
    await s.post('/api/produccion').send({ kind: 'gen', projectId: p, date: '2026-10-14', boxes: 50, refDoc: 'X-2' });
    let r = (await c.get('/api/comercial/cobro?mes=2026-10')).body, row = r.clients.find((x: any) => x.name === 'XPORTA').rows[0];
    expect(row.amount).toBeNull(); expect(row.issues.join()).toContain('sin tarifa');
    expect((await c.post('/api/comercial/tarifas').send({ projectId: p, rate: 2, unit: 'caja', validFrom: '2026-10-05' })).status).toBe(201);
    expect((await c.post('/api/comercial/tarifas').send({ projectId: p, rate: 3, unit: 'caja', validFrom: '2026-10-12' })).status).toBe(201);   // cierra la anterior el 11
    r = (await c.get('/api/comercial/cobro?mes=2026-10')).body; row = r.clients.find((x: any) => x.name === 'XPORTA').rows[0];
    expect(row.amount).toBe(100 * 2 + 50 * 3);
    const wk = (await c.get('/api/comercial/cobro?semana=2026-10-07')).body.clients.find((x: any) => x.name === 'XPORTA').rows[0];
    expect(wk.amount).toBe(200);
    expect((await c.post('/api/comercial/tarifas').send({ projectId: p, rate: 4, unit: 'caja', validFrom: '2026-10-01' })).status).toBe(409);
    expect((await c.post('/api/comercial/tarifas').send({ projectId: await proj('FRITOLAY', 'MAQ'), rate: 1, unit: 'caja', validFrom: '2026-10-05' })).status).toBe(400);
  });
  it('reporte semanal suma al mensual y exporta a Excel', async () => {
    const c = await as('comercial'), m = (await c.get('/api/comercial/cobro?mes=2026-10')).body;
    const weeks = (await (await as('supervisor')).get('/api/resumen?mes=2026-10')).body.weeks as { monday: string }[];
    let t = 0; for (const w of weeks) t += (await c.get(`/api/comercial/cobro?semana=${w.monday}`)).body.total;
    expect(Math.abs(t - m.total)).toBeLessThan(0.5 * 40);
    const tok = await (await import('./helpers.js')).login('comercial');
    const x = await request(app).get('/api/comercial/cobro/excel?mes=2026-10').set('Authorization', 'Bearer ' + tok).buffer(true).parse((res, cb) => { const d: Buffer[] = []; res.on('data', (q: Buffer) => d.push(q)); res.on('end', () => cb(null, Buffer.concat(d))); });
    expect(x.status).toBe(200); expect((x.body as Buffer).subarray(0, 2).toString()).toBe('PK');
    expect((await c.get('/api/comercial/cobro')).status).toBe(400);
  });
});
