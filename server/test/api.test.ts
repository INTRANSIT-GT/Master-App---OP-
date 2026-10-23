import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import ExcelJS from 'exceljs';
import { Engine } from '../src/engine/compute.js';
import { period } from '../src/engine/calendar.js';
import { bundleToEngineData } from '../src/seed/bundle.js';
import { app, as, pool, request, resetDb } from './helpers.js';

const seedDir = new URL('../src/seed/data/', import.meta.url);
const near = (a: number | null, b: number | null) => (a == null || b == null ? expect(a).toBe(b) : expect(Math.abs(a - b)).toBeLessThan(1e-6));
const wmRec = { kind: 'wm', date: '2026-10-12', refDoc: 'REM-T1', productName: 'CHEETOS POFFS CS 29GX54X1', unitsPerBox: 54, boxes: 30 };
const crkRec = { kind: 'crk', date: '2026-10-12', refDoc: 'F-T1', productName: 'CRACKETS MINISW CAM 38GRX64X1', boxes: 100, badBoxes: 5 };

beforeAll(async () => { await resetDb(true); });
afterAll(async () => { await pool.end(); });

describe('autenticación', () => {
  it('rechaza sin token y con credenciales malas', async () => {
    expect((await request(app).get('/api/meta')).status).toBe(401);
    const r = await request(app).post('/api/auth/login').send({ email: 'admin@omnia.local', password: 'mala' });
    expect(r.status).toBe(401); expect(r.body.error).toBe('CREDENCIALES');
  });
  it('bloquea la cuenta tras 5 intentos fallidos', async () => {
    for (let i = 0; i < 5; i++) await request(app).post('/api/auth/login').send({ email: 'consulta@omnia.local', password: 'x' });
    const r = await request(app).post('/api/auth/login').send({ email: 'consulta@omnia.local', password: 'Omnia2026!demo' });
    expect(r.status).toBe(423);
    await pool.query(`UPDATE users SET locked_until = NULL, failed_logins = 0 WHERE email = 'consulta@omnia.local'`);
  });
  it('logout invalida el token', async () => {
    const r = await request(app).post('/api/auth/login').send({ email: 'consulta@omnia.local', password: 'Omnia2026!demo' });
    const t = r.body.token;
    expect((await request(app).get('/api/meta').set('Authorization', 'Bearer ' + t)).status).toBe(200);
    await request(app).post('/api/auth/logout').set('Authorization', 'Bearer ' + t);
    expect((await request(app).get('/api/meta').set('Authorization', 'Bearer ' + t)).status).toBe(401);
  });
});

describe('roles', () => {
  it('consulta solo lee y exporta', async () => {
    const c = await as('consulta');
    expect((await c.get('/api/resumen?mes=2026-10')).status).toBe(200);
    expect((await c.post('/api/produccion').send(crkRec)).status).toBe(403);
    expect((await c.get('/api/exportar/excel?mes=2026-10')).status).toBe(200);
  });
  it('operador captura pero no anula ni cambia estándares; supervisor no cambia estándares', async () => {
    const o = await as('operador'), s = await as('supervisor');
    const r = await o.post('/api/produccion').send({ ...crkRec, status: 'borrador' });
    expect(r.status).toBe(201);
    expect((await o.post(`/api/produccion/${r.body.id}/anular`).send({ reason: 'prueba de rol' })).status).toBe(403);
    expect((await s.post('/api/catalogo/estandares').send({ scope: 'line', key: 'cob', unitRate: 4, validFrom: '2026-10-20' })).status).toBe(403);
    expect((await o.get('/api/usuarios')).status).toBe(403);
    await (await as('supervisor')).post(`/api/produccion/${r.body.id}/anular`).send({ reason: 'limpieza de prueba' });
  });
});

describe('captura, validación y duplicados', () => {
  it('valida montos negativos, fechas futuras, anteriores al inicio y etiquetas inexistentes', async () => {
    const s = await as('supervisor');
    expect((await s.post('/api/produccion').send({ ...crkRec, boxes: -1 })).status).toBe(400);
    expect((await s.post('/api/produccion').send({ ...crkRec, date: '2031-01-01' })).status).toBe(400);
    expect((await s.post('/api/produccion').send({ ...crkRec, date: '2026-09-01' })).status).toBe(400);
    const r = await s.post('/api/produccion').send({ kind: 'etq', date: '2026-10-12', units: 100, labelId: '9X9' });
    expect(r.status).toBe(400); expect(r.body.message).toMatch(/etiqueta/i);
    expect((await s.post('/api/produccion').send({ kind: 'maq', date: '2026-10-12', boxes: 5 })).status).toBe(400); // sin SAP
  });
  it('Walmart calcula cajas de cobro con la regla del HTML (u/caja ≥ 19 → total ÷ 19)', async () => {
    const s = await as('supervisor');
    const r = await s.post('/api/produccion').send(wmRec);
    expect(r.status).toBe(201);
    expect(r.body.units).toBe(1620); expect(r.body.billableBoxes).toBe(85.26);
  });
  it('rechaza un registro idéntico; solo un supervisor puede forzar el duplicado', async () => {
    const o = await as('operador'), s = await as('supervisor');
    const first = await s.post('/api/produccion').send(crkRec); expect(first.status).toBe(201);
    const dup = await s.post('/api/produccion').send(crkRec);
    expect(dup.status).toBe(409); expect(dup.body.error).toBe('DUPLICADO'); expect(dup.body.details.existingId).toBe(first.body.id);
    expect((await o.post('/api/produccion').send({ ...crkRec, allowDuplicate: true })).status).toBe(403);
    expect((await s.post('/api/produccion').send({ ...crkRec, allowDuplicate: true })).status).toBe(201);
  });
  it('Idempotency-Key: el reintento devuelve el mismo registro sin duplicar', async () => {
    const s = await as('supervisor'), body = { kind: 'cob', date: '2026-10-13', boxes: 77, refDoc: 'IDEM-1' };
    const a = await s.post('/api/produccion').set('Idempotency-Key', 'k-123').send(body);
    const b = await s.post('/api/produccion').set('Idempotency-Key', 'k-123').send(body);
    expect(a.status).toBe(201); expect(b.status).toBe(201); expect(b.headers['idempotent-replay']).toBe('true'); expect(b.body.id).toBe(a.body.id);
    expect((await pool.query(`SELECT count(*)::int n FROM production_records WHERE ref_doc='IDEM-1'`)).rows[0].n).toBe(1);
    expect((await s.post('/api/produccion').set('Idempotency-Key', 'k-123').send({ ...body, boxes: 1 })).status).toBe(422);
  });
  it('edición con versión: conflicto si está desactualizada; confirmado exige motivo; queda en bitácora', async () => {
    const s = await as('supervisor');
    const c = await s.post('/api/produccion').send({ kind: 'dc', date: '2026-10-14', sap: '300047154', boxes: 10 });
    expect((await s.patch(`/api/produccion/${c.body.id}`).send({ version: 1, boxes: 12 })).status).toBe(400);       // falta motivo
    const ok = await s.patch(`/api/produccion/${c.body.id}`).send({ version: 1, boxes: 12, reason: 'corrección de conteo' });
    expect(ok.status).toBe(200); expect(ok.body.boxes).toBe(12); expect(ok.body.version).toBe(2);
    expect((await s.patch(`/api/produccion/${c.body.id}`).send({ version: 1, boxes: 15, reason: 'versión vieja' })).status).toBe(409);
    const log = await s.get(`/api/auditoria?entity=produccion&entityId=${c.body.id}`);
    expect(log.body.map((x: any) => x.action).sort()).toEqual(['crear', 'editar']);
    expect(log.body.find((x: any) => x.action === 'editar').reason).toBe('corrección de conteo');
  });
  it('anular exige justificación y el registro deja de sumar', async () => {
    const s = await as('supervisor');
    const before: any = (await s.get('/api/resultados?mes=2026-10')).body.results.lines.find((l: any) => l.k === 'cob');
    const c = await s.post('/api/produccion').send({ kind: 'cob', date: '2026-10-15', boxes: 500, refDoc: 'ANUL-1' });
    const withIt: any = (await s.get('/api/resultados?mes=2026-10')).body.results.lines.find((l: any) => l.k === 'cob');
    expect(withIt.q).toBe(before.q + 500);
    expect((await s.post(`/api/produccion/${c.body.id}/anular`).send({ reason: 'ab' })).status).toBe(400);
    expect((await s.post(`/api/produccion/${c.body.id}/anular`).send({ reason: 'captura equivocada' })).status).toBe(200);
    const after: any = (await s.get('/api/resultados?mes=2026-10')).body.results.lines.find((l: any) => l.k === 'cob');
    expect(after.q).toBe(before.q);
    expect((await s.patch(`/api/produccion/${c.body.id}`).send({ version: 2, boxes: 1, reason: 'no debería' })).status).toBe(409);
  });
});

describe('fidelidad: lo que sale del API = motor sobre el snapshot', () => {
  it('Resultados y Resumen de oct-2026 coinciden con el motor puro (antes de las capturas de prueba se filtran por is_demo)', async () => {
    const cfg = JSON.parse(fs.readFileSync(new URL('catalog.json', seedDir), 'utf8')).cfg, demo = JSON.parse(fs.readFileSync(new URL('demo-records.json', seedDir), 'utf8'));
    const eng = new Engine(bundleToEngineData({ cfg, ...demo }));
    // aislar: BD solo con datos demo en un motor nuevo
    const { loadEngineData } = await import('../src/services/store.js');
    const d = await loadEngineData(pool);
    const dbEng = new Engine({ ...d, prod: (await pool.query(`SELECT kind, record_date, sap, product_name, boxes, units, units_per_box, billable_boxes, labels_used, label_id, review_units, bad_boxes, container_type FROM production_records WHERE is_demo AND status='confirmado'`)).rows.map((r) => ({ kind: r.kind, date: r.record_date, sap: r.sap, productName: r.product_name, boxes: r.boxes, units: r.units, unitsPerBox: r.units_per_box, billableBoxes: r.billable_boxes, labelsUsed: r.labels_used, labelId: r.label_id, reviewUnits: r.review_units, badBoxes: r.bad_boxes, containerType: r.container_type })), hours: d.hours });
    const p = period(24321, cfg.mw), A = eng.results(p), B = dbEng.results(p);
    expect(B.lines.length).toBeGreaterThan(10);
    for (const x of A.lines) { const y = B.lines.find((l) => l.k === x.k)!; near(y.q, x.q); near(y.hh, x.hh); near(y.cost, x.cost); }
    near(dbEng.resumen(p, B).T.cost, eng.resumen(p, A).T.cost);
  });
  it('el API refleja HH y márgenes y muestra N/D (null) cuando no hay datos suficientes', async () => {
    const s = await as('supervisor'), r = (await s.get('/api/resumen?mes=2026-10')).body.resumen;
    expect(r.list.length).toBeGreaterThan(5);
    const dc = r.list.find((o: any) => o.g === 'dc');            // sin tarifa en el snapshot → margen N/D
    expect(dc.mg).toBeNull();
    const maq = r.list.find((o: any) => o.g === 'maq'); expect(maq.mg).toBeGreaterThan(0);
  });
});

describe('estándares con vigencia', () => {
  it('una nueva tarifa solo afecta fechas desde su vigencia y conserva el pasado', async () => {
    const a = await as('admin');
    const line = (b: any) => b.results.lines.find((l: any) => l.k === 'cob');
    const before = line((await a.get('/api/resultados?mes=2026-10')).body);
    const r = await a.post('/api/catalogo/estandares').send({ scope: 'line', key: 'cob', unitRate: 10, validFrom: '2026-10-20', note: 'ajuste de tarifa' });
    expect(r.status).toBe(201);
    const after = line((await a.get('/api/resultados?mes=2026-10')).body);
    expect(after.cost).toBeCloseTo(before.cost, 6);                  // todo lo anterior al 20-oct conserva la tarifa vieja
    expect(after.tt).toBe(before.tt);                                // el TT se hereda
    expect(after.rate).toBe(10);
    const dup = await a.post('/api/catalogo/estandares').send({ scope: 'line', key: 'cob', unitRate: 11, validFrom: '2026-10-20' });
    expect(dup.status).toBe(409);                                    // misma fecha de inicio: traslape
  });
});

describe('importación de contingencia', () => {
  async function xlsx(rows: any[][]) {
    const wb = new ExcelJS.Workbook(), ws = wb.addWorksheet('MAQUILA');
    ws.addRow(['TITULO']); ws.addRow(['FECHA', 'SAP', 'DESCRIPCION', 'TOTAL']); rows.forEach((r) => ws.addRow(r));
    return Buffer.from(await wb.xlsx.writeBuffer());
  }
  it('vista previa → aplicar → reimportar el mismo archivo no duplica', async () => {
    const sup = await as('supervisor');
    const buf = await xlsx([[new Date('2026-10-16T00:00:00Z'), '300065357', 'PEKEPAKES COOKIES MIX CAM 207GRX12X1', 144], [new Date('2026-10-16T00:00:00Z'), '300065357', 'PEKEPAKES COOKIES MIX CAM 207GRX12X1', 72], [new Date('2026-09-01T00:00:00Z'), '300065357', 'ANTIGUO', 10], ['sin fecha', '300065357', 'X', 5]]);
    const p1 = await sup.post('/api/importar/vista-previa').field('tipo', 'estatus_diario').attach('archivo', buf, 'estatus.xlsx');
    expect(p1.status).toBe(200);
    expect(p1.body.summary.produccion).toMatchObject({ total: 2, nuevos: 2, duplicados: 0 });
    const m = p1.body.sheets.find((x: any) => x.sheet === 'MAQUILA');
    expect(m.ignored.anteriorAlInicio).toBe(1); expect(m.ignored.sinFecha).toBe(1);
    const a1 = await sup.post(`/api/importar/${p1.body.batchId}/aplicar`);
    expect(a1.status).toBe(200); expect(a1.body.produccion.insertados).toBe(2);
    expect((await sup.post(`/api/importar/${p1.body.batchId}/aplicar`)).status).toBe(409);
    const p2 = await sup.post('/api/importar/vista-previa').field('tipo', 'estatus_diario').attach('archivo', buf, 'estatus.xlsx');
    expect(p2.body.summary.produccion).toMatchObject({ nuevos: 0, duplicados: 2 });
    expect(p2.body.avisos.join(' ')).toMatch(/ya se aplicó/);
    const a2 = await sup.post(`/api/importar/${p2.body.batchId}/aplicar`);
    expect(a2.body.produccion.insertados).toBe(0);
  });
  it('un operador no puede importar y un archivo inválido se rechaza con mensaje claro', async () => {
    const o = await as('operador'), s = await as('supervisor');
    expect((await o.post('/api/importar/vista-previa').field('tipo', 'estatus_diario').attach('archivo', Buffer.from('x'), 'a.xlsx')).status).toBe(403);
    const bad = await s.post('/api/importar/vista-previa').field('tipo', 'estatus_diario').attach('archivo', Buffer.from('no es excel'), 'a.xlsx');
    expect(bad.status).toBe(400); expect(bad.body.message).toMatch(/Excel/);
  });
});

describe('exportaciones', () => {
  it('Excel con 5 hojas y N/D donde falta información; PDF válido', async () => {
    const s = await as('supervisor');
    const x = await s.get('/api/exportar/excel?mes=2026-10').buffer(true).parse((res, cb) => { const ch: Buffer[] = []; res.on('data', (d: Buffer) => ch.push(d)); res.on('end', () => cb(null, Buffer.concat(ch))); });
    expect(x.status).toBe(200);
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(x.body);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['RESULTADOS', 'RESUMEN', 'REQUERIMIENTOS', 'INVENTARIO', 'CAPTURA ETIQUETADO']);
    const cells: string[] = []; wb.getWorksheet('RESUMEN')!.eachRow((r) => r.eachCell((c) => cells.push(String(c.value))));
    expect(cells).toContain('N/D'); expect(cells.join(' ')).toMatch(/DEMOSTRACIÓN/);
    const p = await s.get('/api/exportar/pdf?mes=2026-10').buffer(true).parse((res, cb) => { const ch: Buffer[] = []; res.on('data', (d: Buffer) => ch.push(d)); res.on('end', () => cb(null, Buffer.concat(ch))); });
    expect(p.status).toBe(200); expect(p.headers['content-type']).toBe('application/pdf'); expect(p.body.subarray(0, 5).toString()).toBe('%PDF-');
  });
});

describe('cierre de periodo', () => {
  it('bloquea con borradores; con advertencias pide confirmación; después nada se modifica y las cifras se congelan', async () => {
    const s = await as('supervisor'), o = await as('operador'), a = await as('admin');
    const draft = await o.post('/api/produccion').send({ kind: 'cob', date: '2026-10-17', boxes: 9, refDoc: 'BORR-1', status: 'borrador' });
    const pre = await s.get('/api/periodos/2026-10/precierre'); expect(pre.body.blockers.join(' ')).toMatch(/borradores/);
    expect((await s.post('/api/periodos/2026-10/cerrar').send({})).status).toBe(409);
    expect((await o.post(`/api/produccion/${draft.body.id}/confirmar`)).status).toBe(200);   // el dueño confirma su borrador
    const warn = await s.post('/api/periodos/2026-10/cerrar').send({});
    expect(warn.status).toBe(409); expect(warn.body.error).toBe('CIERRE_CON_ADVERTENCIAS');
    const frozenBefore = (await s.get('/api/resumen?mes=2026-10')).body.resumen.T;
    expect((await s.post('/api/periodos/2026-10/cerrar').send({ acknowledgeWarnings: true, notes: 'cierre de prueba' })).status).toBe(200);
    // bloqueo en BD y API
    const blocked = await s.post('/api/produccion').send({ kind: 'cob', date: '2026-10-18', boxes: 1, refDoc: 'POST-CIERRE' });
    expect(blocked.status).toBe(423); expect(blocked.body.error).toBe('PERIODO_CERRADO');
    await expect(pool.query(`UPDATE production_records SET boxes = 1 WHERE ref_doc = 'BORR-1'`)).rejects.toThrow(/PERIODO_CERRADO/);
    expect((await s.put('/api/asistencia/2026-10-12').send({ paidHours: 5 })).status).toBe(423);
    const res = await s.get('/api/resumen?mes=2026-10'); expect(res.body.frozen).toBe(true); near(res.body.resumen.T.net, frozenBefore.net);
    // reabrir: solo administrador y con motivo
    expect((await s.post('/api/periodos/2026-10/reabrir').send({ reason: 'necesito corregir' })).status).toBe(403);
    expect((await a.post('/api/periodos/2026-10/reabrir').send({ reason: 'x' })).status).toBe(400);
    expect((await a.post('/api/periodos/2026-10/reabrir').send({ reason: 'corrección autorizada' })).status).toBe(200);
    expect((await s.post('/api/produccion').send({ kind: 'cob', date: '2026-10-18', boxes: 1, refDoc: 'POST-REAPERTURA' })).status).toBe(201);
    const acts = (await a.get('/api/auditoria?entity=periodo&entityId=2026-10')).body.map((x: any) => x.action);
    expect(acts).toEqual(expect.arrayContaining(['cerrar', 'reabrir']));
  });
});
