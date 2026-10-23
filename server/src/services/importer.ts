// Importador de contingencia: lee los dos Excel de estatus (mismas reglas de lectura que el HTML original),
// muestra una vista previa con duplicados/ignorados/errores y solo escribe al confirmar. Es un canal SECUNDARIO de migración.
import ExcelJS from 'exceljs';
import type { AuthUser } from '../auth.js';
import { pool, tx } from '../db.js';
import { dn, iso, wk } from '../engine/calendar.js';
import { HttpError, bad, conflict, notFound } from '../http.js';
import { bundleRows, type HoursRow, type ProdRow } from '../seed/bundle.js';
import { audit } from './audit.js';
import { sha256 } from './keys.js';
import { getSettings, insertHoursRows, insertProdRows } from './store.js';
import { tzToday } from './records.js';

const normH = (s: unknown) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
const r2 = (x: number) => Math.round(x * 100) / 100;
const num = (v: any) => typeof v === 'number' && isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && isFinite(+v.replace(/,/g, '')) ? +v.replace(/,/g, '') : 0;
const txt = (v: any) => (v == null ? '' : typeof v === 'number' ? String(v) : String(v).trim());

function cellVal(v: any): any {
  if (v == null) return null;
  if (v instanceof Date) return v;
  if (typeof v === 'object') { if ('result' in v) return cellVal(v.result); if ('richText' in v) return v.richText.map((x: any) => x.text).join(''); if ('text' in v) return v.text; return null; }
  return v;
}
/** dateOf del HTML: serial Excel, Date, AAAA-MM-DD o DD/MM/AA(AA). */
export function dateOf(v: any): number | null {
  if (v instanceof Date) return Math.floor(v.getTime() / 864e5);
  if (typeof v === 'number' && v > 20000 && v < 80000) return Math.floor(v) - 25569;
  if (typeof v === 'string') {
    const s = v.trim(); let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
    if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3]) / 864e5;
    m = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/.exec(s);
    if (m) { const y = +m[3] < 100 ? 2000 + +m[3] : +m[3]; return Date.UTC(y, +m[2] - 1, +m[1]) / 864e5; }
  }
  return null;
}
type Aoa = any[][];
interface Sheet { a: Aoa; h: { r: number; col: (...n: string[]) => number }; name: string }
function header(aoa: Aoa, must: string[]) {
  for (let r = 0; r < Math.min(25, aoa.length); r++) {
    const H = (aoa[r] || []).map(normH);
    if (must.every((m) => H.some((h) => h === normH(m) || h.startsWith(normH(m))))) {
      const col = (...names: string[]) => { for (const nm of names) { const i = H.indexOf(normH(nm)); if (i >= 0) return i; } for (const nm of names) { const i = H.findIndex((h) => h.startsWith(normH(nm))); if (i >= 0) return i; } return -1; };
      return { r, col };
    }
  }
  return null;
}
function findSheet(names: string[], cands: string[]) {
  const N = names.map(normH);
  for (const c of cands) { const i = N.indexOf(normH(c)); if (i >= 0) return names[i]; }
  for (const c of cands) { const i = N.findIndex((n) => n.startsWith(normH(c))); if (i >= 0) return names[i]; }
  return null;
}
const rowsAfter = (a: Aoa, h: { r: number }) => a.slice(h.r + 1).filter((r) => r && r.some((x) => x != null && x !== ''));

export interface SheetStat { sheet: string; found: boolean; read: number; ignored: { sinFecha: number; anteriorAlInicio: number; futura: number; sinCantidad: number } }
export type ImportType = 'estatus_diario' | 'outsourcing';

export async function readWorkbook(buf: Buffer) {
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(buf as any); } catch { throw bad('No se pudo leer el archivo. Debe ser un Excel .xlsx válido.'); }
  const names = wb.worksheets.map((w) => w.name), cache = new Map<string, Aoa>();
  const sheet = (name: string): Aoa => {
    if (cache.has(name)) return cache.get(name)!;
    const ws = wb.getWorksheet(name)!, out: Aoa = [];
    for (let r = 1; r <= ws.rowCount; r++) { const v = ws.getRow(r).values as any[]; out.push(Array.isArray(v) ? v.slice(1).map(cellVal) : []); }
    cache.set(name, out); return out;
  };
  return { names, sheet };
}

/** Interpreta las hojas con las mismas reglas del HTML (R6 en Walmart). Devuelve filas con forma del HTML + estadísticas por hoja. */
export function interpret(type: ImportType, wb: { names: string[]; sheet: (n: string) => Aoa }, inicio: string, wmDiv: number, todayDn: number) {
  const ini = dn(inicio) ?? 0, stats: SheetStat[] = [];
  const take = (st: SheetStat, d: number | null, qOk = true): boolean => {
    st.read++;
    if (d == null) { st.ignored.sinFecha++; return false; }
    if (d < ini) { st.ignored.anteriorAlInicio++; return false; }
    if (d > todayDn + 7) { st.ignored.futura++; return false; }
    if (!qOk) { st.ignored.sinCantidad++; return false; }
    return true;
  };
  const open = (cands: string[], must: string[], label: string): { s: Sheet; st: SheetStat } | null => {
    const st: SheetStat = { sheet: label, found: false, read: 0, ignored: { sinFecha: 0, anteriorAlInicio: 0, futura: 0, sinCantidad: 0 } };
    stats.push(st);
    const nm = findSheet(wb.names, cands); if (!nm) return null;
    const a = wb.sheet(nm), h = header(a, must); if (!h) return null;
    st.found = true; return { s: { a, h, name: nm }, st };
  };
  // v2: las hojas ADMINISTRACION, OUTSORCING, GTA y ENTREGAS VN ya no se importan (áreas retiradas).
  if (type === 'estatus_diario') {
    const ed = { maq: [] as any[][], wm: [] as any[][], cob: [] as any[][], desc: [] as any[][] };
    let o = open(['MAQUILA'], ['FECHA', 'SAP', 'TOTAL'], 'MAQUILA');
    if (o) { const c = o.s.h.col, F = c('FECHA'), P = c('SAP'), D = c('DESCRIPCION'), T = c('TOTAL'); for (const r of rowsAfter(o.s.a, o.s.h)) { const d = dateOf(r[F]), q = num(r[T]); if (take(o.st, d, r[P] != null && !!q)) ed.maq.push([d, wk(d!), txt(r[P]), txt(r[D]), q]); } }
    o = open(['WALMART'], ['FECHA', 'CAJAS', 'TOTAL U'], 'WALMART');
    if (o) {
      const c = o.s.h.col, F = c('FECHA'), E = c('EGRESO'), R = c('REMISION/ORDEN', 'REMISION'), O = c('ORDER TYPE'), P = c('PRODUCTO'), X = c('U. POR CJ', 'U POR CJ'), C = c('CAJAS'), U = c('TOTAL U'), div = wmDiv || 19;
      for (const r of rowsAfter(o.s.a, o.s.h)) { const d = dateOf(r[F]), uxc = num(r[X]), cj = num(r[C]), u = num(r[U]) || cj * uxc; if (!take(o.st, d, !!(u || cj))) continue; const cobro = uxc >= div ? u / div : uxc ? u / uxc : cj; ed.wm.push([d, wk(d!), txt(r[E]), txt(r[R]), txt(r[O]), txt(r[P]), uxc, cj, u, r2(cobro)]); }
    }
    o = open(['EMBOLSADO COBAN'], ['FECHA', 'CAJAS'], 'EMBOLSADO COBAN');
    if (o) { const c = o.s.h.col, F = c('FECHA'), E = c('NO. EGRESO', 'EGRESO'), A = c('ACTIVIDAD'), C = c('CAJAS'), O = c('OBSERVACION'); for (const r of rowsAfter(o.s.a, o.s.h)) { const d = dateOf(r[F]), q = num(r[C]); if (take(o.st, d, !!q)) ed.cob.push([d, wk(d!), txt(r[E]), txt(r[A]), q, txt(r[O])]); } }
    o = open(['DESCARGAS'], ['FECHA INGRESO', 'TIPO DESCARGA'], 'DESCARGAS');
    const seenF = new Set<string>();
    if (o) {
      const c = o.s.h.col, N = c('#'), F = c('FECHA INGRESO'), I = c('INGRESO'), Fa = c('FACTURA'), T = c('TIPO DESCARGA'), CJ = c('CJ DESCARGADAS'), g = new Map<string, any[]>();
      for (const r of rowsAfter(o.s.a, o.s.h)) { const d = dateOf(r[F]); if (!take(o.st, d)) continue; const key = N >= 0 && r[N] != null ? 'N' + r[N] : 'F' + txt(r[Fa]); let x = g.get(key); if (!x) g.set(key, (x = [d, wk(d!), txt(r[I]), txt(r[Fa]), normH(r[T]), 0])); x[5] += num(r[CJ]); seenF.add(txt(r[Fa])); }
      ed.desc = [...g.values()];
    }
    o = open(['ETIQUETADO'], ['FECHA INGRESO', 'PRESENTACION'], 'ETIQUETADO (contenedores FLUS)');
    if (o) {
      const c = o.s.h.col, F = c('FECHA INGRESO'), I = c('INGRESO'), Fa = c('FACTURA'), P = c('PRESENTACION'), CJ = c('CAJAS MAQUILADAS', 'CAJAS A MAQUILAR'), g = new Map<string, any[]>();
      for (const r of rowsAfter(o.s.a, o.s.h)) { if (normH(r[P]) !== 'FLUS') continue; const d = dateOf(r[F]), f = txt(r[Fa]); if (!take(o.st, d, !!f) || seenF.has(f)) continue; let x = g.get(f); if (!x) g.set(f, (x = [d, wk(d!), txt(r[I]), f, 'FLUS', 0])); x[5] += num(r[CJ]); }
      ed.desc.push(...g.values());
    }
    ed.desc.sort((a, b) => a[0] - b[0]);
    return { bundle: { ed, out: {}, cap: {}, req: [], merma: [] }, stats };
  }
  const out = { uni: [] as any[][], dc: [] as any[][], revm: [] as any[][] };
  let o = open(['UNISUPER'], ['FECHA', 'CAJAS'], 'UNISUPER');
  if (o) { const c = o.s.h.col, F = c('FECHA'), R = c('REMSION', 'REMISION'), M = c('MATERIAL'), T = c('T CAJA'), D = c('DENOMINACION'), C = c('CAJAS'), X = c('U/CAJA'), U = c('TOTAL/U'), E = c('ETIQUETAS UTILIZADAS', 'ETIQUETA');
    for (const r of rowsAfter(o.s.a, o.s.h)) { const d = dateOf(r[F]), cj = num(r[C]), u = num(r[U]) || cj * num(r[X]); if (!take(o.st, d, !!(u || cj))) continue; out.uni.push([d, wk(d!), txt(r[R]), txt(r[M]), txt(r[T]), txt(r[D]), cj, num(r[X]), u, E >= 0 ? num(r[E]) : 0]); } }
  o = open(['DOLLARCITY', 'DOLLAR CITY'], ['FECHA', 'CAJAS'], 'DOLLARCITY');
  if (o) { const c = o.s.h.col, F = c('FECHA'), R = c('REMISION'), P = c('SAP'), D = c('DESCRIPCION'), C = c('CAJAS'); for (const r of rowsAfter(o.s.a, o.s.h)) { const d = dateOf(r[F]), q = num(r[C]); if (take(o.st, d, !!q)) out.dc.push([d, wk(d!), txt(r[R]), txt(r[P]), txt(r[D]), q]); } }
  o = open(['REVISION', 'REVISION DE MATERIALES'], ['FECHA', 'UNIDADES'], 'REVISION');
  if (o) { const c = o.s.h.col, F = c('FECHA'), Co = c('CODIGO'), M = c('SAP', 'MATERIAL'), C = c('CAJAS'), U = c('UNIDADES'), So = c('SOLICITADO'); for (const r of rowsAfter(o.s.a, o.s.h)) { const d = dateOf(r[F]), u = num(r[U]); if (take(o.st, d, !!u)) out.revm.push([d, wk(d!), txt(Co >= 0 ? r[Co] : ''), txt(r[M]), num(r[C]), u, So >= 0 ? txt(r[So]) : '']); } }
  return { bundle: { ed: {}, out, cap: {}, req: [], merma: [] }, stats };
}
export async function previewImport(user: AuthUser, type: ImportType, fileName: string, buf: Buffer) {
  if (!['estatus_diario', 'outsourcing'].includes(type)) throw bad('Tipo de archivo inválido.');
  const s = await getSettings(pool), wb = await readWorkbook(buf);
  const { bundle, stats } = interpret(type, wb, s.inicio, s.wmDiv, dn(tzToday())!);
  const rows = bundleRows(bundle as any, type);
  if (!stats.some((x) => x.found)) throw bad('El archivo no contiene ninguna de las hojas esperadas para ' + (type === 'estatus_diario' ? 'Estatus diario' : 'Estatus outsourcing') + '.');
  // clasificar contra lo que ya existe y contra periodos cerrados
  const dates = [...rows.prod.map((r) => r.date), ...rows.hours.map((r) => r.date)].sort();
  const closed = (await pool.query(`SELECT start_date, end_date FROM periods WHERE status='cerrado'`)).rows;
  const inClosed = (d: string) => closed.some((p) => d >= iso(dn(p.start_date)!) && d <= iso(dn(p.end_date)!));
  const keysP = new Set((await pool.query(`SELECT kind || '|' || source_key k FROM production_records WHERE status <> 'anulado' AND source_key IS NOT NULL AND record_date BETWEEN $1 AND $2`, [dates[0] ?? '1970-01-01', dates[dates.length - 1] ?? '1970-01-01'])).rows.map((r) => r.k));
  const keysH = new Set((await pool.query(`SELECT kind || '|' || source_key k FROM hours_records WHERE status <> 'anulado' AND source_key IS NOT NULL AND record_date BETWEEN $1 AND $2`, [dates[0] ?? '1970-01-01', dates[dates.length - 1] ?? '1970-01-01'])).rows.map((r) => r.k));
  const tag = (r: ProdRow | HoursRow, set: Set<string>) => (inClosed(r.date) ? 'periodo_cerrado' : set.has(r.kind + '|' + r.sourceKey) ? 'duplicado' : 'nuevo');
  const prod = rows.prod.map((r) => ({ ...r, estado: tag(r, keysP) })), hours = rows.hours.map((r) => ({ ...r, estado: tag(r, keysH) }));
  const count = (a: { estado: string }[], e: string) => a.filter((x) => x.estado === e).length;
  const summary = {
    produccion: { total: prod.length, nuevos: count(prod, 'nuevo'), duplicados: count(prod, 'duplicado'), periodoCerrado: count(prod, 'periodo_cerrado') },
    horas: { total: hours.length, nuevos: count(hours, 'nuevo'), duplicados: count(hours, 'duplicado'), periodoCerrado: count(hours, 'periodo_cerrado') },
    rango: dates.length ? { desde: dates[0], hasta: dates[dates.length - 1] } : null,
  };
  const errors = stats.filter((x) => !x.found).map((x) => ({ hoja: x.sheet, problema: 'Hoja o encabezados no encontrados (se omite)' }));
  const batch = (await pool.query(`INSERT INTO import_batches (source, file_name, file_sha256, status, stats, errors, payload, created_by) VALUES ($1,$2,$3,'vista_previa',$4,$5,$6,$7) RETURNING id`,
    [type, fileName, sha256(buf), JSON.stringify({ summary, hojas: stats }), JSON.stringify(errors), JSON.stringify({ prod, hours }), user.id])).rows[0].id;
  const sameFile = (await pool.query(`SELECT id, applied_at FROM import_batches WHERE file_sha256 = $1 AND status = 'aplicado' ORDER BY applied_at DESC LIMIT 1`, [sha256(buf)])).rows[0];
  return {
    batchId: batch, type, fileName, summary, sheets: stats, errors,
    avisos: [...(sameFile ? [`Este mismo archivo ya se aplicó el ${new Date(sameFile.applied_at).toISOString().slice(0, 10)}; los registros repetidos se omitirán.`] : [])],
    muestra: { produccion: prod.slice(0, 15), horas: hours.slice(0, 15) },
  };
}

export async function applyImport(user: AuthUser, batchId: string) {
  return tx(async (c) => {
    const b = (await c.query('SELECT * FROM import_batches WHERE id = $1 FOR UPDATE', [batchId])).rows[0];
    if (!b) throw notFound('Lote de importación');
    if (b.status === 'aplicado') throw conflict('YA_APLICADO', 'Este lote ya fue aplicado.');
    if (b.status !== 'vista_previa') throw conflict('ESTADO', 'El lote no está disponible para aplicar.');
    const pl = b.payload as { prod: any[]; hours: any[] };
    const prod = pl.prod.filter((r) => r.estado === 'nuevo'), hours = pl.hours.filter((r) => r.estado === 'nuevo');
    const meta = { userId: user.id, batchId };
    const a = await insertProdRows(c, prod, meta), h = await insertHoursRows(c, hours, meta);
    const result = { produccion: { insertados: a.inserted, omitidos: a.skipped + pl.prod.length - prod.length }, horas: { insertados: h.inserted, omitidos: h.skipped + pl.hours.length - hours.length } };
    await c.query(`UPDATE import_batches SET status='aplicado', applied_at=now(), payload=NULL, stats = stats || $2::jsonb WHERE id = $1`, [batchId, JSON.stringify({ resultado: result })]);
    await audit(c, user, 'importacion', batchId, 'importar', null, { archivo: b.file_name, tipo: b.source, ...result });
    return result;
  });
}
export { HttpError };
