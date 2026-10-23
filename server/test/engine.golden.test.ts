// Equivalencia: el motor nuevo debe reproducir los números del HTML original (ejecutado para generar golden.json).
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { Engine } from '../src/engine/compute.js';
import { dn, period } from '../src/engine/calendar.js';
import { bundleToEngineData, type Bundle } from '../src/seed/bundle.js';

const golden = JSON.parse(fs.readFileSync(new URL('./fixtures/golden.json', import.meta.url), 'utf8'));
const eng = new Engine(bundleToEngineData(golden.bundle as Bundle));
const near = (a: number | null, b: number | null, msg = '') => {
  if (a == null || b == null) return expect(a, msg).toBe(b);
  expect(Math.abs(a - b), `${msg}: ${a} vs ${b}`).toBeLessThan(1e-6);
};

// v2: se retiraron administración, outsourcing, entregas VN y coordinador; el HTML se compara solo en lo que se conserva.
const GONE_LINES = new Set(['adm', 'evn', 'osD', 'osN', 'coord']), GONE_SEC = new Set(['adm', 'os', 'coord']);
function retain(g: any) {
  const lines = g.lines.filter((x: any) => !GONE_LINES.has(x.k)), sec = g.sec.filter((o: any) => !GONE_SEC.has(o.g));
  const wHH = g.wHH.map((_: number, i: number) => lines.reduce((a: number, x: any) => a + x.whh[i], 0));
  const sum = (f: string) => sec.reduce((a: number, o: any) => a + o[f], 0);
  return { ...g, lines, sec, wHH, HH: wHH.reduce((a: number, b: number) => a + b, 0), T: { ...g.T, cost: sum('cost'), req: sum('req'), mat: sum('mat'), hh: sum('hh'), net: sum('net') - g.T.gen } };
}
describe.each(Object.keys(golden.periods))('periodo %s vs HTML', (k) => {
  const g = retain(golden.periods[k]), p = period(+k, golden.bundle.cfg.mw), A = eng.results(p), R = eng.resumen(p, A);
  it('semanas del mes', () => { expect(p.ws).toEqual(g.p.ws); expect([p.s, p.e]).toEqual([g.p.s, g.p.e]); });
  it('líneas: cantidades, cobrables, HH y costo', () => {
    const mine = new Map(A.lines.map((x) => [x.k, x]));
    expect([...mine.keys()].sort()).toEqual(g.lines.map((x: any) => x.k).sort());
    for (const x of g.lines) {
      const m = mine.get(x.k)!;
      near(m.q, x.q, x.k + ' q'); near(m.b, x.b, x.k + ' b'); near(m.hh, x.hh, x.k + ' hh'); near(m.cost, x.cost, x.k + ' costo');
      x.wq.forEach((v: number, i: number) => { near(m.wq[i], v, x.k + ' wq'); near(m.whh[i], x.whh[i], x.k + ' whh'); });
      expect(m.group, x.k).toBe(x.rg);
    }
  });
  it('HH y asistencia', () => { near(A.HH, g.HH, 'HH'); near(A.ASIS, g.ASIS, 'ASIS'); g.wHH.forEach((v: number, i: number) => { near(A.wHH[i], v); near(A.wAsis[i], g.wAsis[i]); }); });
  it('resumen por sección y total', () => {
    expect(R.list.map((o) => o.g)).toEqual(g.sec.map((o: any) => o.g));
    for (const o of g.sec) {
      const m = R.list.find((x) => x.g === o.g)!;
      near(m.cost, o.cost, o.g + ' costo'); near(m.hh, o.hh, o.g + ' hh'); near(m.req, o.req, o.g + ' req'); near(m.mat, o.mat, o.g + ' mat'); near(m.net, o.net, o.g + ' neto'); near(m.mg, o.mg, o.g + ' margen');
    }
    near(R.T.cost, g.T.cost); near(R.T.req, g.T.req); near(R.T.mat, g.T.mat); near(R.T.net, g.T.net); near(R.T.hh, g.T.hh); near(R.T.gen, g.T.gen);
  });
  it('inventario del rango (inicial, ingresos, consumo, merma, final, costo)', () => {
    const inv = eng.inventory(p.s, p.e)!;
    for (const x of g.items) {
      const m = inv.X[x.id];
      for (const f of ['ini', 'ing', 'con', 'mer', 'fin', 'uc']) near((m as any)[f], x[f], `${x.id} ${f}`);
      for (const [gr, u] of Object.entries<number>(x.conG)) near(m.conG[gr], u, `${x.id} conG ${gr}`);
    }
    const G = eng.materialCost(p);
    for (const [s, v] of Object.entries<number>(g.matCost)) near(G[s], v, 'material ' + s);
  });
});

describe('stock actual y cobertura', () => {
  const st = eng.stock(dn(golden.today)!)!;
  it('coincide con stockNow del HTML', () => {
    for (const x of golden.stock) { const m = st.find((s) => s.id === x.id)!; near(m.stock, x.fin, x.id + ' stock'); near(m.avgDaily, x.avg, x.id + ' promedio'); }
  });
});

describe('reglas que el escenario ejercita', () => {
  const p = period(24321, golden.bundle.cfg.mw), A = eng.results(p);
  it('SAP fuera de catálogo se reporta y no suma HH', () => {
    expect(A.unknownSaps.map((x) => x.sap)).toContain('999999999');
    expect(A.lines.find((l) => l.k === 'm:999999999')!.hh).toBe(0);
  });
  it('Crackets: horas con buenas+malas, cobro solo buenas, revisión por 64 u/caja por defecto', () => {
    const crk = A.lines.find((l) => l.k === 'crk')!, rev = A.lines.find((l) => l.k === 'crkR')!;
    expect(crk.q).toBe(100 + 5 + 60 + 2 + 3); expect(crk.b).toBe(160);
    expect(rev.q).toBe(5 * 64 + 30 + 3 * 64);   // fila 2 usa 'revisadas' (30); fila 3 sin patrón → 64
  });
  it('eficiencia solo cuenta semanas con asistencia', () => {
    expect(A.eff.weeks.filter((v) => v == null).length).toBeGreaterThan(0);
    expect(A.eff.month).not.toBeNull();
  });
});
