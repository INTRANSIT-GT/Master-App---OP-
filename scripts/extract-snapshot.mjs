// Extrae del HTML original (Resultados Omnia) el snapshot embebido y lo separa en:
//   catalog.json      → configuración y catálogos (semilla de producción/demo)
//   demo-records.json → registros operativos del snapshot, con nombres de personas anonimizados
// Uso: node scripts/extract-snapshot.mjs /ruta/Resultados_Omnia.html
import fs from 'node:fs';
const src = fs.readFileSync(process.argv[2], 'utf8');
const m = /const BUNDLE = \/\*SNAP\*\/([\s\S]*?)\/\*END\*\/;/.exec(src);
if (!m) throw new Error('No se encontró el snapshot embebido');
const b = JSON.parse(m[1]);
const out = new URL('../server/src/seed/data/', import.meta.url).pathname;
const matlab = /const DEF_MATLAB = (\[[\s\S]*?\]);\n/.exec(src);
const itemuse = /const DEF_ITEMUSE = (\{[\s\S]*?\});\n/.exec(src);
const catalog = { savedAt: b.savedAt, cfg: { ...b.cfg, matLab: matlab ? JSON.parse(matlab[1]) : b.cfg.matLab, itemUse: itemuse ? JSON.parse(itemuse[1]) : b.cfg.itemUse } };
fs.writeFileSync(out + 'catalog.json', JSON.stringify(catalog, null, 1));
// anonimizar personas (política P13)
const names = new Map();
const anon = (n) => { const k = String(n ?? '').trim().toUpperCase(); if (!k) return ''; if (!names.has(k)) names.set(k, 'Auxiliar ' + String(names.size + 1).padStart(2, '0')); return names.get(k); };
const fix = (rows) => (rows || []).map((r) => { const c = [...r]; c[5] = anon(c[5]); return c; });
const demo = {
  ed: { ...b.ed, adm: fix(b.ed.adm) }, out: { ...b.out, os: fix(b.out.os), evn: fix(b.out.evn) },
  cap: b.cap, req: b.req || [], merma: b.merma || [],
};
fs.writeFileSync(out + 'demo-records.json', JSON.stringify(demo));
console.log('catalog.json', fs.statSync(out + 'catalog.json').size, 'demo-records.json', fs.statSync(out + 'demo-records.json').size, 'personas anonimizadas:', names.size);
