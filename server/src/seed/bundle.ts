// Conversión del snapshot del HTML original → filas normalizadas (catálogos + registros).
// Sirve para (a) sembrar la BD y (b) construir EngineData en las pruebas de equivalencia contra el HTML.
import { iso, wdOf } from '../engine/calendar.js';
import type { EngineData, HoursRec, InvItem, LineDef, ProdRec, ReqRec, ScrapRec, StandardRow } from '../engine/types.js';
import { KeyCounter } from '../services/keys.js';

/** Líneas de proceso: DEF_LINES + grupo de resultados y sección de resumen (resGroup) del HTML. */
export const LINE_DEFS: LineDef[] = ([
  ['imp', 'imp', 'etq', 'Impresión de etiquetas', 'HH', 'man'],
  ['wm', 'wm', 'wm', 'Walmart', 'UNIDADES', 'uph', 'cajas de cobro'],
  ['cob', 'cob', 'cob', 'Embolsado Cobán', 'CAJA', 'mpu'],
  ['sun', 'etq', 'etq', 'Etiquetado Sunchips', 'UNIDADES', 'uph'],
  ['etq', 'etq', 'etq', 'Etiquetado', 'UNIDADES', 'uph'],
  ['noc', 'etq', 'etq', 'Etiquetado noche', 'UNIDADES', 'uph'],
  ['qua', 'etq', 'etq', 'Etiquetado Quaker', 'UNIDADES', 'uph'],
  ['revE', 'etq', 'rev', 'Revisión de unidades (etiquetado)', 'UNIDADES', 'uph'],
  ['revS', 'etq', 'rev', 'Revisión de unidades (Sunchips)', 'UNIDADES', 'uph'],
  ['crk', 'crk', 'crk', 'Crackets', 'CAJA', 'mpu', 'cajas buenas'],
  ['crkR', 'crk', 'crk', 'Crackets: unidades dañadas (revisión)', 'UNIDADES', 'none'],
  ['dFLUS', 'desc', 'desc', 'Descarga de FLUS', 'CONTEN.', 'mpu'],
  ['dGAL', 'desc', 'desc', 'Descarga de galleta', 'CONTEN.', 'mpu'],
  ['dSAL', 'desc', 'desc', 'Descarga de salado', 'CONTEN.', 'mpu'],
  ['dQUA', 'desc', 'desc', 'Descarga de Quaker', 'CONTEN.', 'mpu'],
  ['uniR', 'uni', 'uni', 'Unisuper (revisión de unidades)', 'UNIDADES', 'uph'],
  ['revm', 'revm', 'revm', 'Revisión de unidades', 'UNIDADES', 'uph'],
  ['dc', 'dc', 'dc', 'Sellado Dollar City', 'CAJA', 'mpu'],
] as [string, string, string, string, string, LineDef['mode'], string?][]).map(([key, resultsGroup, summaryGroup, name, um, mode, billableLabel], sort) => ({ key, resultsGroup, summaryGroup, name, um, mode, billableLabel: billableLabel ?? null, sort }));

export const RESULT_GROUPS: [string, string][] = [
  ['maq', 'Maquila'], ['imp', 'Impresión'], ['wm', 'Walmart'], ['cob', 'Embolsado Cobán'], ['etq', 'Etiquetado'], ['crk', 'Crackets'], ['desc', 'Descargas'], ['uni', 'Unisuper'], ['revm', 'Revisión de unidades'], ['dc', 'Dollar City'],
];

export interface Bundle {
  cfg: {
    inicio: string; wmDiv: number; mw: Record<string, [number, number]>;
    lines: Record<string, { tt: number | null; t: number | null }>;
    maq: { sap: string; n: string; t: number | null; cxt: number; tt: number | null }[];
    labels: { id: string; upr: number; rib: string; ry: number; p: number | null }[];
    ribbons: { id: string; n: string; p: number }[];
    bag: { id: string; n: string; p: number; saps: [string, number][] };
    base: { d: string; lab: Record<string, number>; rib: Record<string, number>; bag: number };
    matLab: { k: string; sap: string; n: string; lab: string; ok: boolean; al?: string[] }[];
    itemUse: Record<string, string>;
  };
  ed: { maq: any[][]; wm: any[][]; cob: any[][]; desc: any[][]; adm?: any[][] };
  out: { os?: any[][]; evn?: any[][]; uni: any[][]; dc: any[][]; revm: any[][] };
  cap: Record<string, any>;
  req: any[]; merma: any[];
}

/** Registro de producción con los campos extra que se guardan en BD (referencias, notas, llave natural). */
export interface ProdRow extends ProdRec { refDoc?: string | null; notes?: string | null; presentation?: string | null; processStatus?: string | null; data?: Record<string, unknown>; sourceKey: string; source: string }
export interface HoursRow extends HoursRec { egressNo?: string | null; area?: string | null; activity?: string | null; workerName?: string | null; notes?: string | null; sourceKey: string; source: string }
export interface Rows { prod: ProdRow[]; hours: HoursRow[]; attendance: Record<string, number>; reqs: (ReqRec & { oc?: string | null; supplier?: string | null; notes?: string | null })[]; scrap: (ScrapRec & { reason?: string | null })[] }

const nz = (v: unknown) => (v == null || v === '' ? null : String(v));

export function bundleRows(b: Pick<Bundle, 'ed' | 'out' | 'cap' | 'req' | 'merma'>, sourceTag = 'demo'): Rows {
  const prod: ProdRow[] = [], hours: HoursRow[] = [], kc = new KeyCounter(), attendance: Record<string, number> = {};
  const P = (kind: ProdRec['kind'], keyParts: unknown[], r: Partial<ProdRow> & { date: string }, source = 'import_' + sourceTag) =>
    prod.push({ kind, boxes: 0, units: 0, reviewUnits: 0, badBoxes: 0, ...r, sourceKey: kc.next([kind, ...keyParts]), source } as ProdRow);
  for (const [d, , sap, desc, q] of b.ed?.maq ?? []) P('maq', [d, sap, q], { date: iso(d), sap: String(sap), productName: desc, boxes: q });
  for (const [d, , egreso, rem, ot, prodN, uxc, cj, u, cobro] of b.ed?.wm ?? [])
    P('wm', [d, egreso, rem, prodN, cj, u], { date: iso(d), refDoc: nz(rem), productName: prodN, unitsPerBox: uxc, boxes: cj, units: u, billableBoxes: cobro, data: { egreso, orderType: ot } });
  for (const [d, , egreso, act, q, obs] of b.ed?.cob ?? []) P('cob', [d, egreso, act, q], { date: iso(d), refDoc: nz(egreso), boxes: q, notes: nz(obs), data: { activity: act } });
  for (const [d, , ingreso, factura, tipo, cj] of b.ed?.desc ?? []) P('desc', [d, ingreso, factura, tipo], { date: iso(d), refDoc: nz(factura), containerType: tipo, boxes: cj, data: { ingreso } });
  // v2: administración, outsourcing, entregas Villa Nueva y coordinador ya no existen; sus filas del snapshot se ignoran.
  for (const [d, , rem, mat, tcaja, den, cj, uxc, u, etiq] of b.out?.uni ?? [])
    P('uni', [d, rem, mat, den, cj, u], { date: iso(d), refDoc: nz(rem), sap: nz(mat), productName: den, boxes: cj, unitsPerBox: uxc, units: u, labelsUsed: etiq, data: { tcaja } });
  for (const [d, , rem, sap, desc, cj] of b.out?.dc ?? []) P('dc', [d, rem, sap, cj], { date: iso(d), refDoc: nz(rem), sap: nz(sap), productName: desc, boxes: cj });
  for (const [d, , codigo, mat, cj, u, sol] of b.out?.revm ?? []) P('revm', [d, codigo, mat, u], { date: iso(d), sap: nz(codigo), productName: mat, boxes: cj, units: u, notes: nz(sol) });
  for (const t of ['etq', 'noc', 'qua', 'sun', 'crk'] as const)
    for (const r of b.cap?.[t] ?? []) {
      if (r.f == null) continue;
      P(t, [r.f, r.fact, r.prod, r.lab, r.cajas, r.u, r.rev, r.mal], {
        date: iso(r.f), refDoc: nz(r.fact), presentation: nz(r.pres), labelId: t === 'crk' || t === 'sun' ? null : nz(r.lab), productName: nz(r.prod),
        boxes: +r.cajas || 0, units: +r.u || 0, reviewUnits: +r.rev || 0, badBoxes: +r.mal || 0, processStatus: nz(r.st), notes: nz(r.obs),
      }, 'demo');
    }
  for (const [m, w] of Object.entries<any>(b.cap?.w ?? {})) {
    const d0 = +m; if (w.asis) attendance[iso(d0)] = +w.asis;
    for (const k of ['imp'] as const) for (let i = 0; i < 7; i++) { const v = +(w[k] || [])[i]; if (v) hours.push({ kind: k, date: iso(d0 + i), hoursDay: v, hoursNight: 0, sourceKey: kc.next([k, d0 + i]), source: 'demo' }); }
  }
  const reqs = (b.req ?? []).map((r) => ({ date: iso(r.f), area: r.area, amount: +r.monto || 0, matType: r.tipo, matRef: nz(r.mat), qty: +r.cant || 0, oc: nz(r.oc), supplier: nz(r.prov), notes: nz(r.obs) }));
  const scrap = (b.merma ?? []).map((m) => ({ date: iso(m.f), itemId: m.item, units: +m.u || 0, reason: nz(m.mot) }));
  return { prod, hours, attendance, reqs, scrap };
}

export function catalogData(cfg: Bundle['cfg']) {
  const validFrom = cfg.inicio;
  const standards: StandardRow[] = [];
  for (const m of cfg.maq) standards.push({ scope: 'product', key: String(m.sap), tt: m.tt || null, unitsPerPallet: m.cxt || null, unitRate: m.t ?? null, validFrom, validTo: null });
  for (const l of LINE_DEFS) { const c = cfg.lines[l.key] ?? { tt: null, t: null }; if (c.tt != null || c.t != null) standards.push({ scope: 'line', key: l.key, tt: c.tt || null, unitsPerPallet: null, unitRate: c.t ?? null, validFrom, validTo: null }); }
  const items: InvItem[] = [
    ...cfg.labels.map((l): InvItem => ({ id: 'L:' + l.id, kind: 'lab', code: l.id, name: 'Etiqueta ' + l.id, unitsPerRoll: l.upr, ribbonId: 'R:' + l.rib, ribbonYield: l.ry, price: l.p })),
    ...cfg.ribbons.map((r): InvItem => ({ id: 'R:' + r.id, kind: 'rib', code: r.id, name: r.n, unitsPerRoll: null, ribbonId: null, ribbonYield: null, price: r.p })),
    { id: 'BOLSA', kind: 'bag', code: 'BOLSA', name: cfg.bag.n, unitsPerRoll: null, ribbonId: null, ribbonYield: null, price: cfg.bag.p },
  ];
  const base = { date: cfg.base.d, qty: { ...Object.fromEntries(Object.entries(cfg.base.lab).map(([k, v]) => ['L:' + k, v])), ...Object.fromEntries(Object.entries(cfg.base.rib).map(([k, v]) => ['R:' + k, v])), BOLSA: cfg.base.bag } as Record<string, number> };
  const bagUsage = Object.fromEntries(cfg.bag.saps.map(([s, n]) => [String(s), n]));
  const products = cfg.maq.map((m, i) => ({ sap: String(m.sap), name: m.n, sort: i }));
  return { standards, items, base, bagUsage, products, settings: { inicio: cfg.inicio, wmDiv: cfg.wmDiv, crkDefaultUnitsPerBox: 64, sunLabels: ['1X1', '4X2', '1.25X0.5'], wmLabel: '3X2', uniLabel: '3X2' }, mw: cfg.mw };
}

/** EngineData completo a partir de un snapshot (sin BD): usado por las pruebas de equivalencia. */
export function bundleToEngineData(b: Bundle): EngineData {
  const c = catalogData(b.cfg), r = bundleRows(b);
  return { lines: LINE_DEFS, ...c, prod: r.prod, hours: r.hours, attendance: r.attendance, reqs: r.reqs, scrap: r.scrap, supply: [] };
}
export { wdOf };
