// Ejecuta el código ORIGINAL del HTML (sin modificar lógica) sobre el snapshot + un escenario extra
// y escribe los resultados de referencia ("golden") con los que se compara el motor nuevo.
// Uso: node scripts/gen-golden.mjs /ruta/Resultados_Omnia.html
import fs from 'node:fs';
import vm from 'node:vm';
const html = fs.readFileSync(process.argv[2], 'utf8');
const lines = html.split('\n');
const iSnap = lines.findIndex((l) => l.startsWith('const BUNDLE = /*SNAP*/'));
const snap = JSON.parse(lines[iSnap].replace(/^const BUNDLE = \/\*SNAP\*\//, '').replace(/\/\*END\*\/;\s*$/, ''));
let code = lines.slice(iSnap + 1).join('\n');
code = code.slice(0, code.indexOf('/* ---------- saving ---------- */'));
code = code.replace(/const todayDn = \(\) => \{[^}]*\};/, 'const todayDn = () => globalThis.__TODAY;');
const stub = new Proxy(function () {}, { get: () => stub, apply: () => stub });
const ctx = vm.createContext({ document: { documentElement: { outerHTML: '' }, getElementById: () => stub, addEventListener() {}, querySelectorAll: () => [] }, window: {}, console, Math, Date, Set, Map, Object, Array, JSON, Number, String, RegExp, isFinite, parseFloat, parseInt });
vm.runInContext(code, ctx);
const run = (s) => vm.runInContext(s, ctx);

// escenario: snapshot + extras
const extra = JSON.parse(fs.readFileSync(new URL('../server/test/fixtures/extra-scenario.json', import.meta.url)));
const bundle = JSON.parse(JSON.stringify(snap));
bundle.ed.maq.push(...extra.ed.maq); bundle.req = extra.req; bundle.merma = extra.merma;
for (const t of ['crk', 'sun', 'noc', 'qua', 'etq']) bundle.cap[t] = [...(bundle.cap[t] || []), ...(extra.cap[t] || [])];
Object.assign(bundle.cap.w, extra.cap.w);
ctx.__B = bundle; ctx.__TODAY = Date.UTC(2026, 9, 22) / 864e5;
run('S.cfg = __B.cfg; S.ed = __B.ed; S.out = __B.out; S.cap = __B.cap; S.req = __B.req; S.merma = __B.merma; fixCfg(); bump();');

const out = { today: '2026-10-22', periods: {} };
for (const k of [24320, 24321, 24322]) {
  ctx.__K = k;
  const r = JSON.parse(run(`(() => {
    const p = period(__K), A = agg(p), R = resumenData(p, A), inv = inventory(p.s, p.e), G = materialCost(p);
    const lines = [...A.L.values()].map(x => ({ k: x.k, q: x.q, b: x.b, hh: x.hh, wq: x.wq, wb: x.wb, whh: x.whh, t: x.t, cost: x.cost, rg: x.rg }));
    const sec = R.list.map(o => ({ g: o.g, cost: o.cost, hh: o.hh, req: o.req, mat: o.mat, net: o.net, mg: o.mg }));
    const items = Object.values(inv.X).map(x => ({ id: x.it.id, ini: x.ini, ing: x.ing, con: x.con, mer: x.mer, fin: x.fin, uc: x.uc, conG: x.conG }));
    return JSON.stringify({ p: { ws: p.ws, s: p.s, e: p.e }, lines, wHH: A.wHH, wAsis: A.wAsis, HH: A.HH, ASIS: A.ASIS, sec, T: R.T, items, matCost: G });
  })()`));
  out.periods[k] = r;
}
const st = JSON.parse(run(`(() => { const st = stockNow(); return JSON.stringify(Object.values(st.X).map(x => ({ id: x.it.id, fin: x.fin, avg: st.avg(x.it.id) }))); })()`));
out.stock = st;
delete bundle.img; delete bundle.logo; delete bundle.savedAt;
const nm = new Map(); const anon = (n) => { const k = String(n ?? '').trim().toUpperCase(); if (!k) return ''; if (!nm.has(k)) nm.set(k, 'Auxiliar ' + String(nm.size + 1).padStart(2, '0')); return nm.get(k); };
for (const rows of [bundle.ed.adm, bundle.out.os, bundle.out.evn]) for (const r of rows || []) r[5] = anon(r[5]);   // sin datos personales en el repositorio
out.bundle = bundle;           // el mismo escenario que usa el motor nuevo
fs.writeFileSync(new URL('../server/test/fixtures/golden.json', import.meta.url), JSON.stringify(out));
console.log('golden.json', Object.keys(out.periods).map((k) => k + ': ' + out.periods[k].lines.length + ' líneas, HH ' + out.periods[k].HH.toFixed(2)).join(' | '));
