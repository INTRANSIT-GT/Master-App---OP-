// Hallazgos heredados de la revisión 1793036 (docs/ai/ESTADO.md), corregidos el 2026-10-25.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, pool, resetDb } from './helpers.js';

const near = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThan(1e-6);

beforeAll(async () => { await resetDb(true); });
afterAll(async () => { await pool.end(); });

describe('Walmart: editar unidades recalcula las cajas de cobro', () => {
  it('1620 → 3240 unidades pasa de 85.26 a 170.53 cajas cobrables', async () => {
    const s = await as('supervisor');
    const c = await s.post('/api/produccion').send({ kind: 'wm', date: '2026-10-13', refDoc: 'REM-H1', productName: 'CHEETOS POFFS CS 29GX54X1', unitsPerBox: 54, boxes: 30 });
    expect(c.status).toBe(201); expect(c.body.billableBoxes).toBe(85.26);
    const e = await s.patch(`/api/produccion/${c.body.id}`).send({ units: 3240, version: c.body.version, reason: 'corrección de unidades' });
    expect(e.status).toBe(200); expect(e.body.units).toBe(3240); expect(e.body.billableBoxes).toBe(170.53);
  });
  it('si se envían las cajas de cobro, se respetan', async () => {
    const s = await as('supervisor');
    const c = await s.post('/api/produccion').send({ kind: 'wm', date: '2026-10-13', refDoc: 'REM-H2', productName: 'CHEETOS POFFS CS 29GX54X1', unitsPerBox: 54, boxes: 30 });
    const e = await s.patch(`/api/produccion/${c.body.id}`).send({ units: 3240, billableBoxes: 100, version: c.body.version, reason: 'cobro pactado' });
    expect(e.status).toBe(200); expect(e.body.billableBoxes).toBe(100);
  });
  it('cambiar solo la nota no toca las cajas de cobro capturadas', async () => {
    const s = await as('supervisor');
    const c = await s.post('/api/produccion').send({ kind: 'wm', date: '2026-10-13', refDoc: 'REM-H3', productName: 'CHEETOS POFFS CS 29GX54X1', unitsPerBox: 54, boxes: 30, billableBoxes: 90 });
    const e = await s.patch(`/api/produccion/${c.body.id}`).send({ notes: 'revisado', version: c.body.version, reason: 'agrego nota' });
    expect(e.status).toBe(200); expect(e.body.billableBoxes).toBe(90);
  });
});

describe('periodo cerrado: las semanas también quedan congeladas', () => {
  it('editar el precio de un material no cambia el resultado de una semana cerrada', async () => {
    const s = await as('supervisor'), a = await as('admin');
    const mes = (await s.get('/api/resumen?mes=2026-10')).body;
    // la semana y el artículo con más costo de material consumido
    let pick: { monday: string; id: string; price: number; cost: number } | null = null;
    for (const w of mes.weeks) {
      const inv = (await s.get(`/api/inventario?mes=2026-10&semana=${w.monday}`)).body.inventory;
      for (const r of inv.rows) if (r.price && r.costConsumed > (pick?.cost ?? 0)) pick = { monday: w.monday, id: r.id, price: r.price, cost: r.costConsumed };
    }
    expect(pick).not.toBeNull();
    const before = (await s.get(`/api/resumen?mes=2026-10&semana=${pick!.monday}`)).body.resumen.T;
    expect((await s.post('/api/periodos/2026-10/cerrar').send({ acknowledgeWarnings: true, notes: 'cierre de prueba' })).status).toBe(200);
    expect((await a.patch(`/api/catalogo/items/${encodeURIComponent(pick!.id)}`).send({ price: pick!.price * 10 })).status).toBe(200);
    const after = (await s.get(`/api/resumen?mes=2026-10&semana=${pick!.monday}`)).body;
    expect(after.frozen).toBe(true);
    near(after.resumen.T.mat, before.mat); near(after.resumen.T.net, before.net);
    const inv = (await s.get(`/api/inventario?mes=2026-10&semana=${pick!.monday}`)).body;
    expect(inv.frozen).toBe(true);
    near(inv.inventory.rows.find((r: any) => r.id === pick!.id).costConsumed, pick!.cost);
    // con el periodo abierto, la semana vuelve a calcularse con el precio vigente
    expect((await a.post('/api/periodos/2026-10/reabrir').send({ reason: 'prueba de reapertura' })).status).toBe(200);
    const open = (await s.get(`/api/resumen?mes=2026-10&semana=${pick!.monday}`)).body;
    expect(open.frozen).toBe(false); expect(open.resumen.T.mat).toBeGreaterThan(before.mat);
  });
});
