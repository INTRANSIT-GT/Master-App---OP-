import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { pool } from '../db.js';
import { AREAS, RES_NAME } from '../engine/types.js';
import { monthReport } from './reports.js';

const AN = Object.fromEntries(AREAS);
const ND = 'N/D';

async function monthData(k: number) {
  const rep: any = await monthReport(k), R = rep.results, s = R.period.start, e = R.period.end;
  const [reqs, cap] = await Promise.all([
    pool.query(`SELECT request_date AS date, area, oc, amount, supplier, qty, mat_type, mat_ref, notes FROM requirements WHERE status='confirmado' AND request_date BETWEEN $1 AND $2 ORDER BY request_date`, [s, e]),
    pool.query(`SELECT kind, record_date AS date, ref_doc, presentation, label_id, product_name, boxes, units, review_units, bad_boxes, process_status, notes FROM production_records
                WHERE status='confirmado' AND kind IN ('etq','noc','qua','sun','crk') AND record_date BETWEEN $1 AND $2 ORDER BY record_date, kind`, [s, e]),
  ]);
  return { rep, R, S: rep.resumen, inv: rep.inventory, reqs: reqs.rows, cap: cap.rows };
}

export async function excelReport(k: number): Promise<Buffer> {
  const { rep, R, S, inv, reqs, cap } = await monthData(k);
  const wb = new ExcelJS.Workbook(); wb.creator = 'Resultados Omnia'; wb.created = new Date();
  const head = (ws: ExcelJS.Worksheet, row: number) => { const r = ws.getRow(row); r.font = { bold: true, color: { argb: 'FFFFFFFF' } }; r.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1D2A3A' } }; r.alignment = { vertical: 'middle', wrapText: true }; };
  const note = (ws: ExcelJS.Worksheet, t: string) => { ws.addRow([t]).font = { bold: true, size: 13 }; if (rep.frozen) ws.addRow(['Periodo cerrado: cifras congeladas al cierre']).font = { italic: true }; ws.addRow([]); };

  // RESULTADOS
  let ws = wb.addWorksheet('RESULTADOS');
  note(ws, `RESULTADOS ${R.period.title.toUpperCase()}`);
  const days: string[] = []; for (const w of R.period.weeks) for (let i = 0; i < 7; i++) days.push(new Date(Date.parse(w.monday) + i * 864e5).toISOString().slice(0, 10));
  const h0 = ws.rowCount + 1;
  ws.addRow(['Línea', 'U/M', 'TT', ...days.map((d) => d.slice(8, 10) + '/' + d.slice(5, 7)), ...R.period.weeks.flatMap((w: any) => [`HH sem ${w.week}`, `Producido sem ${w.week}`]), 'Cajas/U mes', 'Tarimas', 'HH mes']); head(ws, h0);
  for (const l of R.lines) ws.addRow([(l.k.startsWith('m:') ? l.k.slice(2) + ' ' : '') + l.name, l.um, l.tt ?? '', ...days.map((d) => l.days[d] ?? ''), ...l.wq.flatMap((q: number, i: number) => [round(l.whh[i]), ['hrs', 'man'].includes(l.mode) ? '' : round(q)]), ['hrs', 'man'].includes(l.mode) ? '' : round(l.q), l.pallets != null ? round(l.pallets) : '', round(l.hh)]);
  ws.addRow([]);
  const blank = (n: number) => Array(n).fill('');
  ws.addRow(['Reportado en estatus', '', '', ...blank(days.length), ...R.wHH.flatMap((v: number) => [round(v), '']), '', '', round(R.HH)]).font = { bold: true };
  ws.addRow(['Asistencia', '', '', ...blank(days.length), ...R.wAsis.flatMap((v: number) => [v ? round(v) : ND, '']), '', '', R.ASIS ? round(R.ASIS) : ND]).font = { bold: true };
  ws.addRow(['Eficiencia', '', '', ...blank(days.length), ...R.eff.weeks.flatMap((v: number | null) => [v == null ? ND : round(v * 100) / 100, '']), '', '', R.eff.month == null ? ND : round(R.eff.month * 100) / 100]).font = { bold: true };
  ws.getColumn(1).width = 44; ws.getColumn(2).width = 10; ws.views = [{ state: 'frozen', xSplit: 3, ySplit: h0 }];

  // RESUMEN
  ws = wb.addWorksheet('RESUMEN');
  note(ws, `RESUMEN ${R.period.title.toUpperCase()}`);
  const h1 = ws.rowCount + 1;
  ws.addRow(['Proceso', 'Costo Q', 'Requerimientos', 'Etiqueta / bolsa', 'Costo neto', 'HH', 'Margen (Q por HH)']); head(ws, h1);
  for (const o of S.list) ws.addRow([o.name, round(o.cost), round(o.req), round(o.mat), round(o.net), round(o.hh), o.mg == null ? ND : round(o.mg)]);
  if (S.T.gen) ws.addRow(['Requerimientos generales', '', round(S.T.gen), '', -round(S.T.gen)]);
  ws.addRow(['Total', round(S.T.cost), round(S.T.req + S.T.gen), round(S.T.mat), round(S.T.net), round(S.T.hh), S.T.mg == null ? ND : round(S.T.mg)]).font = { bold: true };
  for (const o of S.list) {
    ws.addRow([]); ws.addRow([o.name.toUpperCase()]).font = { bold: true };
    const hh = ws.rowCount + 1; ws.addRow(['Costo unitario', 'Línea', 'U/M', ...R.period.weeks.map((w: any) => 'Sem ' + w.week), 'Total', 'HH', 'Costo Q']); head(ws, hh);
    for (const x of o.lines) { const cb = !!x.billableLabel; ws.addRow([x.rate ?? 'Sin costo', (x.k.startsWith('m:') ? x.k.slice(2) + ' ' : '') + x.name, cb ? x.billableLabel!.toUpperCase() : x.um, ...(cb ? x.wb : x.wq).map(round), round(cb ? x.b : x.q), round(x.hh), round(x.cost)]); }
    ws.addRow(['', 'Costo neto', '', ...R.period.weeks.map(() => ''), '', round(o.hh), round(o.net)]); ws.addRow(['', 'Margen', '', ...R.period.weeks.map(() => ''), '', '', o.mg == null ? ND : round(o.mg)]);
  }
  ws.getColumn(1).width = 26; ws.getColumn(2).width = 44;

  // REQUERIMIENTOS
  ws = wb.addWorksheet('REQUERIMIENTOS');
  ws.addRow(['Fecha', 'Área / proceso', 'OC', 'Monto', 'Proveedor', 'Cantidad', 'Tipo', 'Material', 'Observaciones']); head(ws, 1);
  for (const r of reqs) ws.addRow([r.date, AN[r.area] ?? r.area, r.oc ?? '', r.amount, r.supplier ?? '', r.qty, r.mat_type, r.mat_ref ?? '', r.notes ?? '']);
  // INVENTARIO
  ws = wb.addWorksheet('INVENTARIO');
  ws.addRow(['Artículo', 'Inicial', 'Ingresos', 'Consumo', 'Merma', 'Final', 'Costo unitario', 'Costo consumido']); head(ws, 1);
  for (const r of inv?.rows ?? []) ws.addRow([r.name, round(r.ini), round(r.ing), round(r.con), round(r.mer), round(r.fin), r.unitCost, round(r.costConsumed)]);
  // CAPTURA ETIQUETADO / CRACKETS
  ws = wb.addWorksheet('CAPTURA ETIQUETADO');
  ws.addRow(['Tabla', 'Fecha', 'Factura', 'Presentación', 'Etiqueta', 'Producto', 'Cajas', 'Unidades etiquetadas', 'Revisadas', 'Cajas mal estado', 'Status', 'Observación']); head(ws, 1);
  for (const r of cap) ws.addRow([r.kind, r.date, r.ref_doc ?? '', r.presentation ?? '', r.kind === 'sun' ? '1X1+4X2+1.25X0.5' : r.label_id ?? '', r.product_name ?? '', r.boxes, r.units, r.review_units, r.bad_boxes, r.process_status ?? '', r.notes ?? '']);
  for (const w of wb.worksheets) w.columns.forEach((c) => { if (!c.width) c.width = 14; });
  return Buffer.from(await wb.xlsx.writeBuffer());
}
const round = (x: number) => Math.round((x || 0) * 100) / 100;

const money = (v: number) => (v < 0 ? '-Q' : 'Q') + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const n1 = (v: number) => v.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const pct = (v: number | null) => (v == null ? ND : (v * 100).toFixed(1) + '%');

export async function pdfReport(k: number): Promise<Buffer> {
  const { rep, R, S, inv } = await monthData(k);
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 36, info: { Title: `Resultados Omnia ${R.period.title}` } });
  const chunks: Buffer[] = []; doc.on('data', (c) => chunks.push(c));
  const done = new Promise<Buffer>((res) => doc.on('end', () => res(Buffer.concat(chunks))));
  const W = doc.page.width - 72, COPPER = '#B8692E', INK = '#18212C', GREY = '#7A8697';
  doc.rect(0, 0, doc.page.width, 58).fill('#1D2A3A'); doc.rect(0, 58, doc.page.width, 4).fill(COPPER);
  doc.fillColor('#EEF2F7').font('Helvetica-Bold').fontSize(20).text('Resultados Omnia', 36, 16).font('Helvetica').fontSize(10).fillColor('#A9B7C8').text(`${R.period.title} · semanas ${R.period.weeks[0]?.week}–${R.period.weeks.at(-1)?.week} · ${R.period.start} al ${R.period.end}${rep.frozen ? ' · periodo cerrado (cifras congeladas)' : ''}`, 36, 40);
  let y = 76;
  const kpis: [string, string][] = [['HH reportadas', n1(R.HH)], ['Asistencia (h pagadas)', R.ASIS ? n1(R.ASIS) : ND], ['Eficiencia', pct(R.eff.month)], ['Costo Q', money(S.T.cost)], ['Costo neto', money(S.T.net)], ['Margen por HH', S.T.mg == null ? ND : money(S.T.mg)]];
  const kw = W / kpis.length;
  kpis.forEach(([l, v], i) => { doc.roundedRect(36 + i * kw, y, kw - 8, 46, 5).lineWidth(0.6).strokeColor('#D2D9E2').stroke(); doc.fillColor(GREY).font('Helvetica').fontSize(8).text(l, 44 + i * kw, y + 7, { width: kw - 24 }); doc.fillColor(INK).font('Helvetica-Bold').fontSize(14).text(v, 44 + i * kw, y + 22, { width: kw - 24 }); });
  y += 62;
  const table = (cols: { h: string; w: number; a?: 'right' }[], rows: string[][], bold = false) => {
    const rowH = 15; const draw = (cells: string[], hdr: boolean, b: boolean) => {
      if (y + rowH > doc.page.height - 40) { doc.addPage(); y = 40; }
      if (hdr) doc.rect(36, y - 2, W, rowH).fill('#EDF0F4');
      let x = 36; cells.forEach((c, i) => { doc.fillColor(hdr ? GREY : INK).font(hdr || b ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5).text(c, x + 3, y + 1, { width: cols[i].w - 6, align: cols[i].a ?? 'left', lineBreak: false }); x += cols[i].w; });
      doc.moveTo(36, y + rowH - 2).lineTo(36 + W, y + rowH - 2).lineWidth(0.3).strokeColor('#E5E9EF').stroke(); y += rowH;
    };
    draw(cols.map((c) => c.h), true, false); rows.forEach((r, i) => draw(r, false, bold && i === rows.length - 1));
  };
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(12).text('Margen por proceso', 36, y); y += 18;
  const cw = [W * 0.26, W * 0.14, W * 0.15, W * 0.15, W * 0.12, W * 0.08, W * 0.10];
  table(['Proceso', 'Costo Q', 'Requerimientos', 'Etiqueta / bolsa', 'Costo neto', 'HH', 'Margen'].map((h, i) => ({ h, w: cw[i], a: i ? 'right' as const : undefined })),
    [...S.list.map((o: any) => [RES_NAME[o.g] ?? o.name, o.cost ? money(o.cost) : '-', o.req ? '-' + money(o.req) : '-', o.mat ? '-' + money(o.mat) : '-', money(o.net), n1(o.hh), o.mg == null ? ND : money(o.mg)]),
      ['Total', money(S.T.cost), S.T.req + S.T.gen ? '-' + money(S.T.req + S.T.gen) : '-', S.T.mat ? '-' + money(S.T.mat) : '-', money(S.T.net), n1(S.T.hh), S.T.mg == null ? ND : money(S.T.mg)]], true);
  y += 12; if (y > doc.page.height - 120) { doc.addPage(); y = 40; }
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(12).text('Eficiencia semanal (HH reportadas / asistencia)', 36, y); y += 18;
  const ew = [W * 0.15, W * 0.28, W * 0.28, W * 0.29];
  table(['Semana', 'HH reportadas', 'Asistencia', 'Eficiencia'].map((h, i) => ({ h, w: ew[i], a: i ? 'right' as const : undefined })),
    R.period.weeks.map((w: any, i: number) => [String(w.week), n1(R.wHH[i]), R.wAsis[i] ? n1(R.wAsis[i]) : ND, pct(R.eff.weeks[i])]));
  if (inv) {
    y += 12; if (y > doc.page.height - 150) { doc.addPage(); y = 40; }
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(12).text(`Inventario (conteo base ${inv.baseDate})`, 36, y); y += 18;
    const iw = [W * 0.30, W * 0.12, W * 0.12, W * 0.12, W * 0.1, W * 0.12, W * 0.12];
    table(['Artículo', 'Inicial', 'Ingresos', 'Consumo', 'Merma', 'Final', 'Costo consumido'].map((h, i) => ({ h, w: iw[i], a: i ? 'right' as const : undefined })),
      inv.rows.map((r: any) => [r.name, n1(r.ini), n1(r.ing), n1(r.con), n1(r.mer), n1(r.fin), money(r.costConsumed)]));
  }
  const unresolved = R.lines.filter((l: any) => l.incomplete.length);
  if (unresolved.length || R.unknownSaps.length) {
    y += 12; if (y > doc.page.height - 100) { doc.addPage(); y = 40; }
    doc.fillColor('#A86D00').font('Helvetica-Bold').fontSize(11).text('Pendientes de datos (cifras no confiables)', 36, y); y += 15;
    doc.fillColor(INK).font('Helvetica').fontSize(8.5);
    for (const l of unresolved) { doc.text(`• ${l.name}: ${l.incomplete.join(', ')}`, 40, y, { width: W - 8 }); y = doc.y + 2; }
    for (const u of R.unknownSaps) { doc.text(`• SAP ${u.sap} sin catálogo: ${u.name}`, 40, y, { width: W - 8 }); y = doc.y + 2; }
  }
  doc.end();
  return done;
}

// ───────── Orden de compra: Excel y PDF con el formato interno de Intransit ─────────
import { getPO } from './purchases.js';
const fmtD = (d: any) => { const s = d instanceof Date ? d.toISOString() : String(d); return `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}`; };
const EMPRESA = { name: 'IN TRANSIT DE CENTROAMERICA, S. A.', l1: '20 Calle 7-42 zona 11, Colonia Mariscal', l2: 'Nit: 37364677', l3: 'PBX: +502 2318 -7900' };
const cur = (c: string) => (c === 'USD' ? '$' : 'Q');

export async function excelPO(id: string): Promise<{ buf: Buffer; name: string }> {
  const po: any = await getPO(id);
  const wb = new ExcelJS.Workbook(); wb.creator = 'In Transit Operaciones';
  const ws = wb.addWorksheet('OC', { pageSetup: { orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 } });
  ws.columns = [{ width: 18 }, { width: 12 }, { width: 46 }, { width: 16 }, { width: 16 }, { width: 22 }];
  const put = (r: number, c: number, v: any, o: Partial<ExcelJS.Style> = {}) => { const cell = ws.getCell(r, c); cell.value = v; Object.assign(cell, { style: { ...cell.style, ...o } }); return cell; };
  const B = { font: { bold: true } };
  ws.mergeCells('A1:F1'); put(1, 1, 'ORDEN DE COMPRA Y/O REQUERIMIENTO DE PAGO', { font: { bold: true, size: 14 }, alignment: { horizontal: 'center' } });
  put(3, 1, EMPRESA.name, B); put(4, 1, EMPRESA.l1); put(5, 1, EMPRESA.l2); put(6, 1, EMPRESA.l3);
  const kv = (r: number, k: string, v: any) => { put(r, 4, k, B); ws.mergeCells(r, 5, r, 6); put(r, 5, v ?? ''); };
  kv(3, 'ORDEN NO.', po.number); kv(4, 'CENTRO DE COSTO', po.costCenter); kv(5, po.serviceType ? 'SERVICIOS' : 'CATEGORÍA', po.serviceType); kv(6, 'CONDICIÓN DE PAGO', po.paymentCondition === 'CREDITO' ? 'CRÉDITO' : 'CONTADO'); kv(7, 'FECHA DE OC:', fmtD(po.poDate));
  ws.mergeCells('A9:F9'); put(9, 1, 'DATOS DEL PROVEEDOR', { font: { bold: true }, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8E8E8' } }, alignment: { horizontal: 'center' } });
  const left: [string, any][] = [['PROVEEDOR:', po.supplier], ['CONTACTO:', po.supplierContact], ['DIRECCIÓN:', po.supplierAddress], ['NIT:', po.supplierNit], ['TELÉFONO:', po.supplierPhone], ['FORMA DE PAGO', po.paymentMethod], ['CUENTA BANCARIA', po.bankAccount], ['BANCO', po.bank], ['TIPO DE CUENTA', po.accountType]];
  left.forEach(([k, v], i) => { put(10 + i, 1, k, B); ws.mergeCells(10 + i, 2, 10 + i, 3); put(10 + i, 2, v ?? ''); });
  const right: [string, any][] = [['SI ES CRÉDITO, DÍAS DE CRÉDITO:', po.creditDays], ['SI ES ANTICIPO, % DE ANTICIPO:', po.advancePct], ['MONTO ANTICIPO:', po.advanceAmount]];
  right.forEach(([k, v], i) => { put(10 + i, 4, k, B); ws.mergeCells(10 + i, 5, 10 + i, 6); put(10 + i, 5, v ?? ''); });
  put(19, 1, 'INSTRUCCIONES', B); ws.mergeCells('B19:F19'); put(19, 2, po.instructions ?? '');
  ws.mergeCells('A21:F21'); put(21, 1, 'DATOS DEL SOLICITANTE', { font: { bold: true }, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8E8E8' } }, alignment: { horizontal: 'center' } });
  ([['SOLICITADO POR:', po.requestedBy], ['ENTREGAR A:', po.deliverTo], ['LUGAR DE ENTREGA:', po.deliveryPlace]] as [string, any][]).forEach(([k, v], i) => { put(22 + i, 1, k, B); ws.mergeCells(22 + i, 2, 22 + i, 6); put(22 + i, 2, v ?? ''); });
  const h = 26;
  ['CÓDIGO', 'CANTIDAD', 'DESCRIPCIÓN DEL BIEN O SERVICIO:', 'PRECIO UNITARIO', 'MONTO TOTAL:'].forEach((t, i) => put(h, i + 1 + (i > 2 ? 0 : 0), t, { font: { bold: true, color: { argb: 'FFFFFFFF' } }, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1D2A3A' } }, alignment: { horizontal: 'center', wrapText: true } }));
  put(h, 6, 'MONEDA', { font: { bold: true, color: { argb: 'FFFFFFFF' } }, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1D2A3A' } }, alignment: { horizontal: 'center' } });
  po.lines.forEach((l: any, i: number) => { const r = h + 1 + i; put(r, 1, l.code ?? ''); put(r, 2, +l.qty, { alignment: { horizontal: 'center' } }); put(r, 3, l.description, { alignment: { wrapText: true, vertical: 'top' } }); put(r, 4, +l.unitPrice, { numFmt: '#,##0.00' }); put(r, 5, +l.amount, { numFmt: '#,##0.00' }); put(r, 6, po.currency, { alignment: { horizontal: 'center' } }); });
  const t = h + po.lines.length + 2;
  put(t, 4, `MONTO TOTAL EN ${po.currency}`, B); put(t, 5, +po.total, { font: { bold: true }, numFmt: `"${cur(po.currency)}" #,##0.00` });
  if (po.currency === 'USD') { put(t + 1, 4, `Tipo de cambio (a Q)`); put(t + 1, 5, +po.exchangeRate, { numFmt: '0.0000' }); put(t + 2, 4, 'Total en quetzales'); put(t + 2, 5, Math.round(+po.total * +po.exchangeRate * 100) / 100, { numFmt: '"Q" #,##0.00' }); }
  const n = t + 4;
  ws.mergeCells(n, 1, n + 2, 6);
  put(n, 1, 'Nota: solo se recibirán facturas del mes en curso, los días de crédito inician en la fecha en que se emite la contraseña de pago. No se emiten contraseñas de pago sin factura original, la factura se recibirá si y solo sí existe comprobante de recepción del producto.', { alignment: { wrapText: true, vertical: 'top' }, font: { italic: true, size: 9 } });
  const f = n + 4;
  put(f, 1, 'REALIZADO POR:', B); put(f, 2, po.preparedBy ?? ''); put(f, 4, 'NOMBRE:', B); put(f, 5, po.approvedBy ?? '');
  put(f + 1, 1, 'CARGO:', B); put(f + 1, 2, po.preparedPosition ?? ''); put(f + 1, 4, 'PUESTO:', B); put(f + 1, 5, po.approvedPosition ?? '');
  put(f + 2, 1, 'FIRMA:', B); put(f + 2, 4, 'FIRMA:', B); put(f + 3, 1, 'LOTE:', B); put(f + 3, 2, po.lot ?? ''); put(f + 4, 1, 'CHEQUE:', B); put(f + 4, 2, po.checkNo ?? '');
  put(f + 6, 1, `Estado: ${po.status.toUpperCase()}${po.receivedDate ? ' · recibida ' + fmtD(po.receivedDate) : ''}`, { font: { italic: true, size: 9 } });
  return { buf: Buffer.from(await wb.xlsx.writeBuffer()), name: `${po.number}.xlsx` };
}

export async function pdfPO(id: string): Promise<{ buf: Buffer; name: string }> {
  const po: any = await getPO(id);
  const doc = new PDFDocument({ size: 'LETTER', margin: 36 }), chunks: Buffer[] = [];
  doc.on('data', (d) => chunks.push(d));
  const done = new Promise<Buffer>((res) => doc.on('end', () => res(Buffer.concat(chunks))));
  const W = 540, kv = (k: string, v: any, x: number, y: number, w = 250) => { doc.font('Helvetica-Bold').fontSize(8).text(k, x, y, { width: 110, continued: false }); doc.font('Helvetica').fontSize(8.5).text(String(v ?? ''), x + 110, y, { width: w - 110 }); };
  doc.font('Helvetica-Bold').fontSize(13).text('ORDEN DE COMPRA Y/O REQUERIMIENTO DE PAGO', { align: 'center' });
  let y = doc.y + 8;
  doc.font('Helvetica-Bold').fontSize(9).text(EMPRESA.name, 36, y); doc.font('Helvetica').fontSize(8.5).text(EMPRESA.l1, 36, y + 12).text(EMPRESA.l2).text(EMPRESA.l3);
  kv('ORDEN NO.', po.number, 300, y); kv('CENTRO DE COSTO', po.costCenter, 300, y + 12); kv(po.serviceType ? 'SERVICIOS' : 'CATEGORÍA', po.serviceType, 300, y + 24); kv('CONDICIÓN DE PAGO', po.paymentCondition === 'CREDITO' ? 'CRÉDITO' : 'CONTADO', 300, y + 36); kv('FECHA DE OC:', fmtD(po.poDate), 300, y + 48);
  y += 70; doc.rect(36, y, W, 14).fill('#e8e8e8').fillColor('black').font('Helvetica-Bold').fontSize(9).text('DATOS DEL PROVEEDOR', 36, y + 3, { width: W, align: 'center' }); y += 20;
  ([['PROVEEDOR:', po.supplier], ['CONTACTO:', po.supplierContact], ['DIRECCIÓN:', po.supplierAddress], ['NIT:', po.supplierNit], ['TELÉFONO:', po.supplierPhone], ['FORMA DE PAGO', po.paymentMethod], ['CUENTA BANCARIA', po.bankAccount], ['BANCO', po.bank], ['TIPO DE CUENTA', po.accountType]] as [string, any][]).forEach(([k, v], i) => kv(k, v, 36, y + i * 12));
  ([['DÍAS DE CRÉDITO:', po.creditDays], ['% DE ANTICIPO:', po.advancePct], ['MONTO ANTICIPO:', po.advanceAmount]] as [string, any][]).forEach(([k, v], i) => kv(k, v, 300, y + i * 12));
  y += 9 * 12 + 4; kv('INSTRUCCIONES', po.instructions, 36, y, W); y += 18;
  doc.rect(36, y, W, 14).fill('#e8e8e8').fillColor('black').font('Helvetica-Bold').fontSize(9).text('DATOS DEL SOLICITANTE', 36, y + 3, { width: W, align: 'center' }); y += 20;
  ([['SOLICITADO POR:', po.requestedBy], ['ENTREGAR A:', po.deliverTo], ['LUGAR DE ENTREGA:', po.deliveryPlace]] as [string, any][]).forEach(([k, v], i) => kv(k, v, 36, y + i * 12, W)); y += 44;
  doc.rect(36, y, W, 16).fill('#1d2a3a').fillColor('white').font('Helvetica-Bold').fontSize(8);
  const X = [40, 105, 160, 400, 470]; ['CÓDIGO', 'CANTIDAD', 'DESCRIPCIÓN DEL BIEN O SERVICIO', 'PRECIO UNIT.', 'MONTO TOTAL'].forEach((t, i) => doc.text(t, X[i], y + 4, { width: i === 2 ? 235 : 62 })); y += 20;
  doc.fillColor('black').font('Helvetica').fontSize(8.5);
  for (const l of po.lines) { const hh = Math.max(14, doc.heightOfString(l.description, { width: 235 }) + 2); doc.text(l.code ?? '', X[0], y, { width: 62 }).text(String(+l.qty), X[1], y, { width: 50 }).text(l.description, X[2], y, { width: 235 }).text(`${cur(po.currency)} ${(+l.unitPrice).toFixed(2)}`, X[3], y, { width: 66 }).text((+l.amount).toFixed(2), X[4], y, { width: 70 }); y += hh; }
  y += 6; doc.font('Helvetica-Bold').fontSize(9.5).text(`MONTO TOTAL EN ${po.currency}`, 300, y, { width: 160 }).text(`${cur(po.currency)} ${(+po.total).toFixed(2)}`, 470, y, { width: 100 });
  if (po.currency === 'USD') { y += 14; doc.font('Helvetica').fontSize(8.5).text(`Tipo de cambio ${(+po.exchangeRate).toFixed(4)} · total Q ${(Math.round(+po.total * +po.exchangeRate * 100) / 100).toFixed(2)}`, 300, y, { width: 270 }); }
  y += 26; doc.font('Helvetica-Oblique').fontSize(7.5).text('Nota: solo se recibirán facturas del mes en curso, los días de crédito inician en la fecha en que se emite la contraseña de pago. No se emiten contraseñas de pago sin factura original, la factura se recibirá si y solo sí existe comprobante de recepción del producto.', 36, y, { width: 330 });
  y += 50; doc.font('Helvetica').fontSize(8.5);
  kv('REALIZADO POR:', po.preparedBy, 36, y, 260); kv('CARGO:', po.preparedPosition, 36, y + 12, 260); kv('FIRMA:', '', 36, y + 24, 260); kv('NOMBRE:', po.approvedBy, 300, y, 260); kv('PUESTO:', po.approvedPosition, 300, y + 12, 260); kv('FIRMA:', '', 300, y + 24, 260);
  kv('LOTE:', po.lot, 36, y + 44, 260); kv('CHEQUE:', po.checkNo, 36, y + 56, 260);
  doc.font('Helvetica-Oblique').fontSize(7.5).fillColor('#666').text(`Estado: ${po.status.toUpperCase()}${po.receivedDate ? ' · recibida ' + fmtD(po.receivedDate) : ''} · generado por In Transit Operaciones`, 36, 740);
  doc.end(); return { buf: await done, name: `${po.number}.pdf` };
}
