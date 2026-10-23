// Motor de cálculo. Port fiel de ledger / hhOf / agg / inventory / materialCost / resumenData del HTML original.
// Es puro (sin BD, sin reloj): recibe EngineData y devuelve resultados. Cada regla cita su ID de docs/01-auditoria.md.
import { DAY, dn, iso, mondayOf, period, wdOf, wk, type Period } from './calendar.js';
import { RES_NAME, RES_ORDER, type EngineData, type InvItem, type LineDef, type StandardRow } from './types.js';

export const normH = (s: unknown) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
const r2 = (x: number) => Math.round(x * 100) / 100;

type Cell = [number, number]; // [cantidad, cantidad cobrable]
interface Ledger {
  day: Map<number, Record<string, Cell>>;
  use: Map<number, Record<string, Record<string, number>>>;  // día → artículo → rubro → unidades
  unknownSaps: Map<string, string>;
}
export interface LineResult {
  k: string; name: string; um: string; mode: string; group: string; resultsGroup: string;
  tt: number | null; rate: number | null; billableLabel: string | null;
  q: number; b: number; hh: number; cost: number; pallets: number | null;
  wq: number[]; wb: number[]; whh: number[];
  days: Record<string, number>;
  incomplete: string[];  // motivos por los que HH o costo no son confiables (P2, P9)
}
export interface ResultsOut {
  period: { k: number; title: string; start: string; end: string; weeks: { monday: string; week: number }[] };
  lines: LineResult[];
  wHH: number[]; wAsis: number[]; HH: number; ASIS: number;
  eff: { weeks: (number | null)[]; month: number | null };
  unknownSaps: { sap: string; name: string }[];
}
export interface SectionOut { g: string; name: string; lines: LineResult[]; cost: number; hh: number; req: number; mat: number; net: number; mg: number | null }
export interface ResumenOut { list: SectionOut[]; T: { cost: number; req: number; mat: number; net: number; hh: number; gen: number; mg: number | null } }
export interface InvRow { it: InvItem; ini: number; ing: number; con: number; conG: Record<string, number>; mer: number; fin: number; uc: number }

export class Engine {
  private ledgerCache: Ledger | null = null;
  private stdIdx = new Map<string, StandardRow[]>();
  private lineIdx = new Map<string, LineDef>();
  private itemIdx = new Map<string, InvItem>();

  constructor(public d: EngineData) {
    for (const s of d.standards) { const k = s.scope + '|' + s.key; (this.stdIdx.get(k) ?? this.stdIdx.set(k, []).get(k)!).push(s); }
    for (const l of d.lines) this.lineIdx.set(l.key, l);
    for (const i of d.items) this.itemIdx.set(i.id, i);
  }

  // ── estándares con vigencia ──
  std(scope: 'product' | 'line', key: string, dateIso: string): StandardRow | null {
    const rows = this.stdIdx.get(scope + '|' + key);
    if (!rows) return null;
    for (const r of rows) if (r.validFrom <= dateIso && (!r.validTo || dateIso <= r.validTo)) return r;
    return null;
  }
  private stdOf(k: string, dateIso: string) { return k.startsWith('m:') ? this.std('product', k.slice(2), dateIso) : this.std('line', k, dateIso); }
  modeOf(k: string) { return k.startsWith('m:') ? 'mpt' : this.lineIdx.get(k)?.mode; }
  ttOf(k: string, dateIso: string): number | null { return this.stdOf(k, dateIso)?.tt ?? null; }
  rateOf(k: string, dateIso: string): number | null { return this.stdOf(k, dateIso)?.unitRate ?? null; }
  nameOf(k: string): string {
    if (k.startsWith('m:')) return this.d.products.find((p) => p.sap === k.slice(2))?.name ?? this.ledger().unknownSaps.get(k.slice(2)) ?? k.slice(2);
    return this.lineIdx.get(k)?.name ?? k;
  }
  umOf(k: string) { return k.startsWith('m:') ? 'CAJA' : this.lineIdx.get(k)?.um ?? ''; }
  resGroup(k: string): string | undefined { return k.startsWith('m:') ? 'maq' : this.lineIdx.get(k)?.summaryGroup; }

  /** R3 / R4 — horas hombre de una cantidad producida en una fecha. */
  hhOf(k: string, q: number, dateIso: string): number {
    if (!q) return 0;
    const m = this.modeOf(k);
    if (m === 'hrs' || m === 'man') return q;
    if (m === 'none') return 0;
    const st = this.stdOf(k, dateIso), tt = st?.tt ?? 0;
    if (!(tt > 0)) return 0;
    if (m === 'mpt') { const cxt = st?.unitsPerPallet ?? 0; return cxt > 0 ? (q / cxt) * tt / 60 : 0; }
    if (m === 'mpu') return (q * tt) / 60;
    if (m === 'uph') return q / tt;
    return 0;
  }

  // ── etiquetas ──
  labelOf(id: string) { return this.itemIdx.get('L:' + id) ?? [...this.itemIdx.values()].find((i) => i.kind === 'lab' && normH(i.code) === normH(id)); }
  /** normLabel del HTML */
  normLabel(v: unknown): string {
    const s = normH(v).replace(/\s/g, '').replace(/\*/g, 'X');
    if (!s || s === 'N/A' || s === 'NA' || s === 'CLIENTE') return '';
    const labs = this.d.items.filter((i) => i.kind === 'lab');
    const f = labs.find((l) => normH(l.code) === s) || labs.find((l) => s.startsWith(normH(l.code)) || normH(l.code).startsWith(s));
    return f ? f.code : s;
  }

  // ── R2: bitácora diaria ──
  ledger(): Ledger {
    if (this.ledgerCache) return this.ledgerCache;
    const day = new Map<number, Record<string, Cell>>(), use: Ledger['use'] = new Map(), unk = new Map<string, string>();
    const add = (d: number, k: string, q: number, b?: number | null) => {
      if (!q && !b) return;
      let o = day.get(d); if (!o) day.set(d, (o = {}));
      const x = o[k] || (o[k] = [0, 0]); x[0] += q; x[1] += b == null ? q : b;
    };
    const addUse = (d: number, item: string, u: number, g: string) => {
      if (!u) return;
      let o = use.get(d); if (!o) use.set(d, (o = {}));
      const x = o[item] || (o[item] = {}); x[g] = (x[g] || 0) + u;
    };
    const S = this.d.settings, catalog = new Set(this.d.products.map((p) => p.sap));
    const descKey: Record<string, string> = { GALLETA: 'dGAL', SALADO: 'dSAL', FLUS: 'dFLUS', QUAKER: 'dQUA' };
    for (const r of this.d.prod) {
      const d = dn(r.date)!;
      switch (r.kind) {
        case 'maq': {
          const sap = r.sap ?? '';
          add(d, 'm:' + sap, r.boxes);
          if (!catalog.has(sap)) unk.set(sap, r.productName ?? '');
          const b = this.d.bagUsage[sap]; if (b) addUse(d, 'BOLSA', r.boxes * b, 'maq');
          break;
        }
        case 'wm': add(d, 'wm', r.units, r.billableBoxes ?? this.wmCobro(r)); addUse(d, 'L:' + S.wmLabel, r.boxes, 'wm'); break;
        case 'cob': add(d, 'cob', r.boxes); break;
        case 'desc': { const k = descKey[normH(r.containerType)]; if (k) add(d, k, 1); break; }
        case 'uni': add(d, 'uniR', r.units); addUse(d, 'L:' + S.uniLabel, r.labelsUsed ?? 0, 'uni'); break;
        case 'dc': add(d, 'dc', r.boxes); break;
        case 'revm': add(d, 'revm', r.units); break;
        case 'etq': case 'noc': case 'qua': case 'sun': {
          add(d, r.kind, r.units); add(d, r.kind === 'sun' ? 'revS' : 'revE', r.reviewUnits);
          const labs = r.kind === 'sun' ? S.sunLabels : [this.normLabel(r.labelId)].filter(Boolean);
          for (const l of labs) addUse(d, 'L:' + l, r.units, 'etq');
          break;
        }
        case 'crk': {
          add(d, 'crk', r.boxes + r.badBoxes, r.boxes);
          const m = /X(\d+)X1\b/i.exec(r.productName ?? '');
          add(d, 'crkR', r.reviewUnits > 0 ? r.reviewUnits : r.badBoxes * (m ? +m[1] : S.crkDefaultUnitsPerBox));
          break;
        }
      }
    }
    for (const h of this.d.hours) {
      const d = dn(h.date)!;
      if (h.kind === 'imp') add(d, 'imp', h.hoursDay + h.hoursNight);       // impresión (captura manual); las áreas administrativas/outsourcing se retiraron en v2
    }
    return (this.ledgerCache = { day, use, unknownSaps: unk });
  }
  /** R6 — cajas de cobro Walmart cuando no vienen calculadas. */
  wmCobro(r: { boxes: number; units: number; unitsPerBox?: number | null }) {
    const div = this.d.settings.wmDiv || 19, uxc = r.unitsPerBox ?? 0;
    return r2(uxc >= div ? r.units / div : uxc ? r.units / uxc : r.boxes);
  }

  // ── agregación mensual (Resultados) ──
  results(p: Period): ResultsOut {
    const L = this.ledger(), acc = new Map<string, LineResult>();
    const endIso = iso(p.e);
    const mk = (k: string): LineResult => {
      const ld = this.lineIdx.get(k);
      return {
        k, name: this.nameOf(k), um: this.umOf(k), mode: String(this.modeOf(k)), group: this.resGroup(k) ?? '', resultsGroup: k.startsWith('m:') ? 'maq' : ld?.resultsGroup ?? '',
        tt: this.ttOf(k, endIso), rate: this.rateOf(k, endIso), billableLabel: ld?.billableLabel ?? null,
        q: 0, b: 0, hh: 0, cost: 0, pallets: null, wq: p.ws.map(() => 0), wb: p.ws.map(() => 0), whh: p.ws.map(() => 0), days: {}, incomplete: [],
      };
    };
    p.ws.forEach((m, wi) => {
      for (let d = m; d <= m + 6; d++) {
        const o = L.day.get(d); if (!o) continue;
        const di = iso(d);
        for (const [k, [q, b]] of Object.entries(o)) {
          const x = acc.get(k) ?? (acc.set(k, mk(k)), acc.get(k)!);
          x.q += q; x.b += b; x.wq[wi] += q; x.wb[wi] += b; x.days[di] = (x.days[di] ?? 0) + q;
          const hh = this.hhOf(k, q, di); x.hh += hh; x.whh[wi] += hh;
          const rt = this.rateOf(k, di);
          if (rt != null) x.cost += b * rt;
          // incompletos (P2, P9)
          const m2 = this.modeOf(k);
          if (m2 !== 'hrs' && m2 !== 'man' && m2 !== 'none' && q) {
            const st = this.stdOf(k, di);
            if (!(st?.tt && st.tt > 0)) x.incomplete.push(`Sin TT vigente el ${di}`);
            if (m2 === 'mpt' && !(st?.unitsPerPallet && st.unitsPerPallet > 0)) x.incomplete.push(`Sin cajas por tarima el ${di}`);
          }
          if (rt == null && m2 !== 'man' && m2 !== 'hrs' && b) x.incomplete.push(`Sin costo unitario el ${di}`);
        }
      }
    });
    const lines = [...acc.values()];
    for (const x of lines) {
      x.incomplete = [...new Set(x.incomplete.map((s) => s.replace(/ el \d{4}-\d{2}-\d{2}$/, '')))];
      if (x.k.startsWith('m:')) { const st = this.std('product', x.k.slice(2), endIso); if (st?.unitsPerPallet && x.q) x.pallets = x.q / st.unitsPerPallet; }
    }
    lines.sort((a, b) => this.sortIdx(a.k) - this.sortIdx(b.k));
    const wHH = p.ws.map((_, i) => lines.reduce((a, x) => a + x.whh[i], 0));
    const wAsis = p.ws.map((m) => this.d.attendance[iso(m)] ?? 0);
    const HH = wHH.reduce((a, b) => a + b, 0), ASIS = wAsis.reduce((a, b) => a + b, 0);
    // R10 — eficiencia: solo semanas con asistencia
    const repWithAsis = wHH.reduce((a, v, i) => a + (wAsis[i] ? v : 0), 0);
    return {
      period: { k: p.k, title: p.title, start: iso(p.s), end: iso(p.e), weeks: p.ws.map((m) => ({ monday: iso(m), week: wk(m) })) },
      lines, wHH, wAsis, HH, ASIS,
      eff: { weeks: wHH.map((v, i) => (wAsis[i] ? v / wAsis[i] : null)), month: ASIS ? repWithAsis / ASIS : null },
      unknownSaps: [...this.ledger().unknownSaps.entries()].filter(([s]) => !this.d.products.some((pp) => pp.sap === s)).map(([sap, name]) => ({ sap, name })),
    };
  }
  private sortIdx(k: string) {
    if (k.startsWith('m:')) { const i = this.d.products.findIndex((p) => 'm:' + p.sap === k); return i >= 0 ? i : 9999; }
    return 10000 + (this.lineIdx.get(k)?.sort ?? 999);
  }

  // ── inventario ──
  unitCost(id: string): number {
    const it = this.itemIdx.get(id); if (!it) return 0;
    if (it.kind === 'bag') return it.price ?? 0;
    if (it.kind === 'lab') return it.unitsPerRoll && it.unitsPerRoll > 0 && it.price != null ? it.price / it.unitsPerRoll : 0;
    return it.price ?? 0;
  }
  private ribUse(labCode: string, u: number) { const l = this.labelOf(labCode); return l && l.ribbonYield && l.ribbonYield > 0 && l.ribbonId ? { rib: l.ribbonId, rolls: u / l.ribbonYield } : null; }
  private reqIngreso(r: EngineData['reqs'][number]): { id: string; u: number } | null {
    const q = r.qty || 0; if (!q) return null;
    if (r.matType === 'Etiqueta') { const l = this.labelOf(r.matRef ?? ''); return l ? { id: l.id, u: q * (l.unitsPerRoll || 0) } : null; }
    if (r.matType === 'Ribbon') return { id: 'R:' + r.matRef, u: q };
    if (r.matType === 'Bolsa') return { id: 'BOLSA', u: q };
    return null;
  }
  private moves?: { ingBy: Map<number, { id: string; u: number }[]>; merBy: Map<number, { item: string; u: number }[]>; conBy: Map<number, { id: string; u: number; g: string }[]> };
  private dayMoves(d: number): [string, 'con' | 'ing' | 'mer', number, string?][] {
    if (!this.moves) {
      const ingBy = new Map<number, { id: string; u: number }[]>(), merBy = new Map<number, { item: string; u: number }[]>(), conBy = new Map<number, { id: string; u: number; g: string }[]>();
      for (const r of this.d.reqs) { const g = this.reqIngreso(r); if (g) { const k = dn(r.date)!; (ingBy.get(k) ?? ingBy.set(k, []).get(k)!).push(g); } }
      for (const m of this.d.supply ?? []) { const k = dn(m.date)!; if (m.kind === 'ingreso') (ingBy.get(k) ?? ingBy.set(k, []).get(k)!).push({ id: m.itemId, u: m.qty }); else (conBy.get(k) ?? conBy.set(k, []).get(k)!).push({ id: m.itemId, u: m.qty, g: m.area || 'gen' }); }
      for (const m of this.d.scrap) { const k = dn(m.date)!; (merBy.get(k) ?? merBy.set(k, []).get(k)!).push({ item: m.itemId, u: m.units }); }
      this.moves = { ingBy, merBy, conBy };
    }
    const out: [string, 'con' | 'ing' | 'mer', number, string?][] = [];
    const o = this.ledger().use.get(d) || {};
    for (const [id, gs] of Object.entries(o)) for (const [g, u] of Object.entries(gs)) {
      out.push([id, 'con', u, g]);
      if (id.startsWith('L:')) { const rb = this.ribUse(id.slice(2), u); if (rb) out.push([rb.rib, 'con', rb.rolls, g]); }
    }
    for (const g of this.moves.ingBy.get(d) || []) out.push([g.id, 'ing', g.u]);
    for (const c of this.moves.conBy.get(d) || []) out.push([c.id, 'con', c.u, c.g]);
    for (const m of this.moves.merBy.get(d) || []) {
      out.push([m.item, 'mer', m.u]);
      if (m.item.startsWith('L:')) { const rb = this.ribUse(m.item.slice(2), m.u); if (rb) out.push([rb.rib, 'mer', rb.rolls]); }
    }
    return out;
  }
  /** R13 — inventario de un rango: parte del conteo físico y rueda hacia adelante o atrás. */
  inventory(s: number, e: number): { bd: number; X: Record<string, InvRow> } | null {
    const bd = dn(this.d.base.date); if (bd == null) return null;
    const X: Record<string, InvRow> = {};
    for (const it of this.d.items) X[it.id] = { it, ini: this.d.base.qty[it.id] ?? 0, ing: 0, con: 0, conG: {}, mer: 0, fin: 0, uc: 0 };
    const sign = (f: string) => (f === 'ing' ? 1 : -1);
    if (s - 1 >= bd) { for (let d = bd + 1; d <= s - 1; d++) for (const [id, f, u] of this.dayMoves(d)) if (X[id]) X[id].ini += sign(f) * u; }
    else { for (let d = s; d <= bd; d++) for (const [id, f, u] of this.dayMoves(d)) if (X[id]) X[id].ini -= sign(f) * u; }
    for (let d = s; d <= e; d++) for (const [id, f, u, g] of this.dayMoves(d)) {
      const x = X[id]; if (!x) continue;
      x[f] += u; if (f === 'con' && g) x.conG[g] = (x.conG[g] || 0) + u;
    }
    for (const x of Object.values(X)) { x.fin = x.ini + x.ing - x.con - x.mer; x.uc = this.unitCost(x.it.id); }
    return { bd, X };
  }
  /** R18 — costo de material consumido por sección del Resumen. */
  materialCost(p: Period): Record<string, number> {
    const inv = this.inventory(p.s, p.e), G: Record<string, number> = {};
    if (!inv) return G;
    for (const x of Object.values(inv.X)) {
      for (const [g, u] of Object.entries(x.conG)) G[g] = (G[g] || 0) + u * x.uc;
      if (x.mer) { const sec = x.it.id === 'BOLSA' ? 'maq' : x.it.id === 'L:' + this.d.settings.wmLabel ? 'wm' : 'etq'; G[sec] = (G[sec] || 0) + x.mer * x.uc; }
    }
    return G;
  }
  /** R11 — requerimientos que restan costo (solo tipos Otro/Directo, por área). */
  reqCost(p: Period): Record<string, number> {
    const G: Record<string, number> = {}, s = iso(p.s), e = iso(p.e);
    for (const r of this.d.reqs) {
      if (r.date < s || r.date > e || (r.matType !== 'Otro' && r.matType !== 'Directo')) continue;
      const a = r.area || 'gen'; G[a] = (G[a] || 0) + (r.amount || 0);
    }
    return G;
  }

  // ── Resumen ──
  resumen(p: Period, A = this.results(p)): ResumenOut {
    const req = this.reqCost(p), mat = this.materialCost(p), S2: Record<string, SectionOut> = {};
    for (const x of A.lines) {
      const g = x.group; if (!g) continue;
      const o = S2[g] || (S2[g] = { g, name: RES_NAME[g] ?? g, lines: [], cost: 0, hh: 0, req: 0, mat: 0, net: 0, mg: null });
      o.lines.push(x); o.cost += x.cost; o.hh += x.hh;
    }
    for (const g of new Set([...Object.keys(req), ...Object.keys(mat)])) if (!S2[g] && g !== 'gen') S2[g] = { g, name: RES_NAME[g] ?? g, lines: [], cost: 0, hh: 0, req: 0, mat: 0, net: 0, mg: null };
    const list = RES_ORDER.filter((g) => S2[g]).map((g) => {
      const o = S2[g]; o.req = req[g] || 0; o.mat = mat[g] || 0; o.net = o.cost - o.req - o.mat;
      o.mg = o.hh > 0 && o.cost ? o.net / o.hh : null;                  // N/D cuando no hay datos suficientes
      return o;
    });
    const T = list.reduce((a, o) => ({ cost: a.cost + o.cost, req: a.req + o.req, mat: a.mat + o.mat, net: a.net + o.net, hh: a.hh + o.hh }), { cost: 0, req: 0, mat: 0, net: 0, hh: 0 });
    const gen = req.gen || 0;
    const net = T.net - gen;
    return { list, T: { ...T, gen, net, mg: T.hh ? net / T.hh : null } };
  }

  // ── stock actual y cobertura (R19) ──
  lastUseDay(): number | null { let m: number | null = null; for (const d of this.ledger().use.keys()) if (m == null || d > m) m = d; return m; }
  stock(todayDn: number) {
    const inv = this.inventory(todayDn, todayDn); if (!inv) return null;
    const use = this.ledger().use; let first: number | null = null;
    for (const d of use.keys()) if (first == null || d < first) first = d;
    const last = this.lastUseDay(), ref = last == null ? todayDn : Math.min(last, todayDn);
    const from = Math.max(ref - 27, first ?? ref - 27), nd = ref - from + 1, win = this.inventory(from, ref);
    return Object.values(inv.X).map((x) => {
      const avg = win?.X[x.it.id] ? (win.X[x.it.id].con + win.X[x.it.id].mer) / nd : 0;
      const days = avg > 0 ? x.fin / avg : null;
      return { id: x.it.id, name: x.it.name, kind: x.it.kind, stock: x.fin, avgDaily: avg, daysCover: days, level: x.fin < 0 ? 'negativo' : days != null && days < 14 ? 'bajo' : 'ok' };
    });
  }
}

export { DAY, mondayOf, wdOf, period };
