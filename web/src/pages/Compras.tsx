import { useMemo, useState, type ReactNode } from "react";
import { api, newKey } from '../api';
import { Card, Loading, Modal, MonthBar, Pill, Tabs, useLoad } from '../components';
import { fmtDate, fmtDT, nfx } from '../format';
import { usePeriod } from '../records-ui';
import { useApp } from '../store';
import Requerimientos from './Requerimientos';

const money = (v: number | null | undefined, cur = 'GTQ') => (v == null ? '—' : (cur === 'USD' ? '$ ' : 'Q ') + Number(v).toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const STATUS_PILL: Record<string, ReactNode> = { borrador: <Pill kind="warn">Borrador</Pill>, emitida: <Pill kind="blue">Emitida</Pill>, completada: <Pill kind="ok">Completada</Pill>, anulada: <Pill kind="bad">Anulada</Pill> };
const MAT_TYPES: [string, string][] = [['Insumo', 'Insumo (entra a inventario de insumos)'], ['Etiqueta', 'Etiqueta (entra a inventario)'], ['Ribbon', 'Ribbon (entra a inventario)'], ['Bolsa', 'Bolsa (entra a inventario)'], ['Directo', 'Directo (resta del área)'], ['Otro', 'Otro / servicio (resta del área)']];

export default function Compras() {
  const [tab, setTab] = useState<'oc' | 'hist' | 'req'>('oc');
  const per = usePeriod();
  return (
    <>
      <MonthBar status={per?.status} />
      <Tabs sub value={tab} onChange={setTab} items={[['oc', 'Órdenes de compra'], ['hist', 'Historial de materiales'], ['req', 'Requerimientos']]} />
      {tab === 'oc' && <Ordenes />}{tab === 'hist' && <Historial />}{tab === 'req' && <Requerimientos />}
    </>
  );
}

function Ordenes() {
  const { can, toast, refresh } = useApp();
  const per = usePeriod();
  const [status, setStatus] = useState(''), [q, setQ] = useState(''), [form, setForm] = useState<null | { edit?: any }>(null), [view, setView] = useState<string | null>(null);
  const url = per ? `/ordenes-compra?from=${per.start}&to=${per.end}${status ? '&status=' + status : ''}${q ? '&q=' + encodeURIComponent(q) : ''}` : '';
  const { data, err, loading, reload } = useLoad<any[]>(() => (url ? api.get(url) : Promise.resolve(null as any)), [url]);
  const dl = (id: string, kind: 'excel' | 'pdf', num: string) => api.download(`/ordenes-compra/${id}/${kind}`, `${num}.${kind === 'excel' ? 'xlsx' : 'pdf'}`).catch((e) => toast(e.message, true));
  return (
    <>
      <Card title="Órdenes de compra y/o requerimientos de pago" sub="Formulario interno · al completar una orden se actualiza el inventario"
        actions={<div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <input aria-label="Buscar" placeholder="Buscar número, proveedor o material" value={q} onChange={(e) => setQ(e.target.value)} style={{ minWidth: 220 }} />
          <select aria-label="Estado" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Todos los estados</option><option value="borrador">Borrador</option><option value="emitida">Emitida</option><option value="completada">Completada</option><option value="anulada">Anulada</option></select>
          {can('compras.crear') && <button className="btn btn-primary big-btn" onClick={() => setForm({})}>＋ Generar orden de compra</button>}
        </div>}>
        <Loading err={err} loading={loading && !data} />
        {data && !data.length && <p className="muted">Sin órdenes en este periodo.</p>}
        {data && data.length > 0 && <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Orden</th><th>Fecha</th><th>Proveedor</th><th>Centro de costo</th><th className="n">Líneas</th><th className="n">Total</th><th>Estado</th><th /></tr></thead><tbody>
          {data.map((o) => (
            <tr key={o.id} className={o.status === 'anulada' ? 'void' : ''}>
              <td><b className="ocnum">{o.number}</b>{o.isDemo && <> <span className="pill p-warn">demo</span></>}</td><td>{fmtDate(o.poDate)}</td><td>{o.supplier}</td><td>{o.costCenter}</td><td className="n">{o.lineCount}</td><td className="n">{money(o.total, o.currency)}</td><td>{STATUS_PILL[o.status]}{o.receivedDate && <div className="muted">recibida {fmtDate(o.receivedDate)}</div>}</td>
              <td style={{ whiteSpace: 'nowrap' }}><button className="btn btn-sm" onClick={() => setView(o.id)}>Ver</button> <button className="btn btn-sm" onClick={() => dl(o.id, 'excel', o.number)}>Excel</button> <button className="btn btn-sm" onClick={() => dl(o.id, 'pdf', o.number)}>PDF</button></td></tr>))}
        </tbody></table></div>}
      </Card>
      {form && <OCForm edit={form.edit} onClose={() => setForm(null)} onSaved={() => { setForm(null); reload(); refresh(); }} />}
      {view && <OCView id={view} onClose={() => setView(null)} onChanged={() => { reload(); refresh(); }} onEdit={(o) => { setView(null); setForm({ edit: o }); }} />}
    </>
  );
}

function OCView({ id, onClose, onChanged, onEdit }: { id: string; onClose: () => void; onChanged: () => void; onEdit: (o: any) => void }) {
  const { can, toast, confirmBox, meta } = useApp();
  const { data: o, err, loading, reload } = useLoad<any>(() => api.get('/ordenes-compra/' + id), [id]);
  const [recv, setRecv] = useState(meta?.today ?? ''), [asking, setAsking] = useState(false);
  const act = async (fn: () => Promise<any>, ok: string) => { try { await fn(); toast(ok); reload(); onChanged(); } catch (e: any) { toast(e.message, true); } };
  const dl = (kind: 'excel' | 'pdf') => api.download(`/ordenes-compra/${id}/${kind}`, `${o.number}.${kind === 'excel' ? 'xlsx' : 'pdf'}`).catch((e) => toast(e.message, true));
  const anular = async () => { const c = await confirmBox({ title: `Anular ${o.number}`, text: o.status === 'completada' ? 'Se revertirá lo que generó: sale el ingreso al inventario y se anulan sus requerimientos.' : 'La orden queda anulada con su justificación (no se borra).', reason: true, okLabel: 'Anular orden', danger: true }); if (c.ok) act(() => api.post(`/ordenes-compra/${id}/anular`, { reason: c.reason }), 'Orden anulada.'); };
  return (
    <Modal title={o ? `${o.number} · ${o.supplier}` : 'Orden de compra'} onClose={onClose} wide>
      <Loading err={err} loading={loading && !o} />
      {o && <>
        <p style={{ margin: '0 0 8px' }}>{STATUS_PILL[o.status]} · {fmtDate(o.poDate)} · {o.paymentCondition === 'CREDITO' ? 'Crédito' : 'Contado'} · {o.currency}{o.currency === 'USD' ? ` (T.C. ${o.exchangeRate})` : ''}{o.clientName && <> · {o.clientName}</>}</p>
        <div className="grid g2" style={{ fontSize: 13.5 }}>
          <div><b>Centro de costo:</b> {o.costCenter ?? '—'}<br /><b>Servicios:</b> {o.serviceType ?? '—'}<br /><b>Solicitado por:</b> {o.requestedBy ?? '—'}<br /><b>Entregar a:</b> {o.deliverTo ?? '—'} · {o.deliveryPlace ?? ''}</div>
          <div><b>Contacto:</b> {o.supplierContact ?? '—'} · {o.supplierPhone ?? ''}<br /><b>NIT:</b> {o.supplierNit ?? '—'}<br /><b>Forma de pago:</b> {o.paymentMethod ?? '—'}{o.bank ? ` · ${o.bank} ${o.bankAccount ?? ''}` : ''}<br /><b>Realizado por:</b> {o.preparedBy ?? '—'} · <b>Autoriza:</b> {o.approvedBy ?? '—'}</div>
        </div>
        <table className="tbl" style={{ marginTop: 10 }}><thead><tr><th>Código</th><th>Descripción</th><th>Tipo</th><th className="n">Cantidad</th><th className="n">Precio unit.</th><th className="n">Monto</th></tr></thead><tbody>
          {o.lines.map((l: any) => <tr key={l.id}><td>{l.code}</td><td>{l.description}</td><td>{l.matType}{l.matRef ? ` · ${l.matRef.replace(/^I:/, '')}` : ''}{l.area ? ` · ${l.area}` : ''}</td><td className="n">{nfx(l.qty)}</td><td className="n">{money(l.unitPrice, o.currency)}</td><td className="n">{money(l.amount, o.currency)}</td></tr>)}
        </tbody><tfoot><tr><td colSpan={5}>Monto total en {o.currency}</td><td className="n"><b>{money(o.total, o.currency)}</b></td></tr></tfoot></table>
        {o.status === 'completada' && <p className="note" style={{ marginTop: 8 }}>Recibida el {fmtDate(o.receivedDate)}: los insumos, etiquetas, ribbon y bolsa ya están en inventario y los costos directos restan al área en el Resumen.</p>}
        {o.status === 'anulada' && <p className="errline">Anulada: {o.voidReason}</p>}
        <h4 style={{ margin: '12px 0 4px' }}>Historial de la orden</h4>
        <table className="tbl"><tbody>{o.history.map((h: any) => <tr key={h.id}><td>{fmtDT(h.at)}</td><td>{h.userEmail ?? 'sistema'}</td><td>{h.action}</td><td>{h.reason}</td></tr>)}</tbody></table>
        {asking && <div className="note" style={{ marginTop: 10 }}><b>¿Cuándo se recibió?</b> <input type="date" value={recv} max={meta?.today} onChange={(e) => setRecv(e.target.value)} /> <button className="btn btn-primary btn-sm" onClick={() => { setAsking(false); act(() => api.post(`/ordenes-compra/${id}/completar`, { receivedDate: recv }), 'Orden completada: inventario actualizado.'); }}>Confirmar recepción</button> <button className="btn btn-sm" onClick={() => setAsking(false)}>Cancelar</button></div>}
        <div className="mact">
          <button className="btn" onClick={() => dl('excel')}>Excel</button><button className="btn" onClick={() => dl('pdf')}>PDF</button>
          {['borrador', 'emitida'].includes(o.status) && can('compras.crear') && <button className="btn" onClick={() => onEdit(o)}>Editar</button>}
          {o.status === 'borrador' && can('compras.gestionar') && <button className="btn btn-blue" onClick={() => act(() => api.post(`/ordenes-compra/${id}/emitir`), 'Orden emitida.')}>Emitir orden</button>}
          {o.status === 'emitida' && can('compras.completar') && <button className="btn btn-primary" onClick={() => setAsking(true)}>Marcar como completada</button>}
          {o.status !== 'anulada' && can('compras.gestionar') && <button className="btn btn-danger" onClick={anular}>Anular</button>}
          <button className="btn" onClick={onClose}>Cerrar</button>
        </div>
      </>}
    </Modal>
  );
}

type Line = { code: string; matType: string; matRef: string; description: string; qty: string; unitPrice: string; area: string };
const emptyLine = (): Line => ({ code: '', matType: 'Insumo', matRef: '', description: '', qty: '', unitPrice: '', area: '' });
const HEAD = ['costCenter', 'serviceType', 'supplier', 'supplierContact', 'supplierAddress', 'supplierNit', 'supplierPhone', 'creditDays', 'advancePct', 'advanceAmount', 'paymentMethod', 'bankAccount', 'bank', 'accountType', 'instructions', 'requestedBy', 'deliverTo', 'deliveryPlace', 'preparedBy', 'preparedPosition', 'approvedBy', 'approvedPosition', 'lot', 'checkNo', 'notes'] as const;

function OCForm({ edit, onClose, onSaved }: { edit?: any; onClose: () => void; onSaved: () => void }) {
  const { meta, can, toast, confirmBox } = useApp();
  const { data: cat } = useLoad<any>(() => api.get('/catalogo'), []);
  const [h, setH] = useState<Record<string, any>>(() => ({ prefix: edit?.prefix ?? 'OC', poDate: edit?.poDate ?? meta?.today ?? '', paymentCondition: edit?.paymentCondition ?? 'CONTADO', currency: edit?.currency ?? 'GTQ', exchangeRate: edit?.exchangeRate ?? 1, clientId: edit?.clientId ?? '', preparedBy: edit?.preparedBy ?? meta?.user.name ?? '', ...Object.fromEntries(HEAD.map((k) => [k, edit?.[k] ?? (k === 'preparedBy' ? meta?.user.name ?? '' : '')])) }));
  const [lines, setLines] = useState<Line[]>(() => (edit?.lines?.length ? edit.lines.map((l: any) => ({ code: l.code ?? '', matType: l.matType, matRef: l.matRef ?? '', description: l.description, qty: String(l.qty), unitPrice: String(l.unitPrice), area: l.area ?? '' })) : [emptyLine()]));
  const [busy, setBusy] = useState(false), [key] = useState(newKey);
  const items: any[] = cat?.items ?? [];
  const set = (k: string, v: any) => setH((x) => ({ ...x, [k]: v }));
  const setL = (i: number, k: keyof Line, v: string) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, [k]: v, ...(k === 'matType' ? { matRef: '', area: '' } : {}) } : l)));
  const total = useMemo(() => lines.reduce((a, l) => a + Math.round((+l.qty || 0) * (+l.unitPrice || 0) * 100) / 100, 0), [lines]);
  const opts = (t: string): [string, string][] => t === 'Etiqueta' ? items.filter((i) => i.kind === 'lab').map((i) => [i.code, i.name]) : t === 'Ribbon' ? items.filter((i) => i.kind === 'rib').map((i) => [i.code, i.name]) : t === 'Insumo' ? items.filter((i) => i.kind === 'ins').map((i) => [i.id, `${i.name} (${i.unit ?? 'u'})`]) : [];
  const pickMat = (i: number, v: string) => { const t = lines[i].matType, o = opts(t).find((x) => x[0] === v); setLines((ls) => ls.map((l, j) => (j === i ? { ...l, matRef: v, description: l.description || (o ? o[1].replace(/ \(.*\)$/, '') : ''), code: l.code || (t === 'Insumo' ? v.replace(/^I:/, '') : v) } : l))); };
  const save = async (emitir: boolean) => {
    setBusy(true);
    try {
      const body: any = { ...h, clientId: h.clientId || undefined, lines: lines.map((l) => ({ ...l, qty: +l.qty, unitPrice: +l.unitPrice || 0, matRef: l.matRef || undefined, area: l.area || undefined })) };
      if (h.currency === 'GTQ') body.exchangeRate = 1;
      for (const k of ['advancePct', 'advanceAmount']) if (body[k] === '') delete body[k];
      if (edit) {
        let reason: string | undefined;
        if (edit.status === 'emitida') { const c = await confirmBox({ title: 'Motivo del cambio', text: 'La orden ya fue emitida: el cambio queda en su historial.', reason: true, okLabel: 'Guardar cambio' }); if (!c.ok) { setBusy(false); return; } reason = c.reason; }
        await api.patch('/ordenes-compra/' + edit.id, { ...body, version: edit.version, reason }); toast('Orden actualizada.');
      } else { const r = await api.post('/ordenes-compra', { ...body, emitir }, key); toast(`Orden ${r.number} ${emitir ? 'emitida' : 'guardada como borrador'}.`); }
      onSaved();
    } catch (e: any) { toast(e.message, true); } finally { setBusy(false); }
  };
  const T = (k: string, label: string, w?: 2 | 3, type = 'text', extra: any = {}) => <div className={'field' + (w ? ' w' + w : '')}><label htmlFor={'oc-' + k}>{label}</label><input id={'oc-' + k} type={type} value={h[k] ?? ''} onChange={(e) => set(k, e.target.value)} {...extra} /></div>;
  return (
    <Modal title={edit ? `Editar ${edit.number}` : 'Generar orden de compra'} onClose={onClose} wide>
      <p className="muted">Formato interno «Orden de compra y/o requerimiento de pago». El número de orden se asigna al guardar (prefijo + consecutivo).</p>
      <fieldset className="fieldset"><legend>Orden</legend><div className="form">
        {edit ? <div className="field"><label>Orden no.</label><input value={edit.number} readOnly /></div> : T('prefix', 'Prefijo de la orden', undefined, 'text', { maxLength: 8, style: { textTransform: 'uppercase' } })}
        {T('poDate', 'Fecha de OC', undefined, 'date', { required: true })}{T('costCenter', 'Centro de costo')}{T('serviceType', 'Servicios / categoría')}
        <div className="field"><label htmlFor="oc-pc">Condición de pago</label><select id="oc-pc" value={h.paymentCondition} onChange={(e) => set('paymentCondition', e.target.value)}><option value="CONTADO">Contado</option><option value="CREDITO">Crédito</option></select></div>
        <div className="field"><label htmlFor="oc-cur">Moneda</label><select id="oc-cur" value={h.currency} onChange={(e) => set('currency', e.target.value)}><option value="GTQ">Quetzales (Q)</option><option value="USD">Dólares (US$)</option></select></div>
        {h.currency === 'USD' && T('exchangeRate', 'Tipo de cambio (a Q)', undefined, 'number', { step: 'any', min: 0.0001 })}
        <div className="field"><label htmlFor="oc-cl">Cliente (opcional)</label><select id="oc-cl" value={h.clientId} onChange={(e) => set('clientId', e.target.value)}><option value="">—</option>{(cat?.clients ?? []).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
      </div></fieldset>
      <fieldset className="fieldset"><legend>Datos del proveedor</legend><div className="form">
        {T('supplier', 'Proveedor *', 2, 'text', { required: true })}{T('supplierContact', 'Contacto')}{T('supplierAddress', 'Dirección', 2)}{T('supplierNit', 'NIT')}{T('supplierPhone', 'Teléfono')}
        {h.paymentCondition === 'CREDITO' && T('creditDays', 'Días de crédito')}{T('advancePct', '% de anticipo', undefined, 'number', { step: 'any', min: 0, max: 100 })}{T('advanceAmount', 'Monto anticipo', undefined, 'number', { step: 'any', min: 0 })}
        {T('paymentMethod', 'Forma de pago')}{T('bankAccount', 'Cuenta bancaria')}{T('bank', 'Banco')}{T('accountType', 'Tipo de cuenta')}{T('instructions', 'Instrucciones', 3)}
      </div></fieldset>
      <fieldset className="fieldset"><legend>Datos del solicitante</legend><div className="form">{T('requestedBy', 'Solicitado por')}{T('deliverTo', 'Entregar a')}{T('deliveryPlace', 'Lugar de entrega', 2)}</div></fieldset>
      <fieldset className="fieldset"><legend>Bienes o servicios</legend>
        <div className="tbl-wrap"><table className="lines-ed"><thead><tr><th style={{ width: 70 }}>Código</th><th style={{ width: 190 }}>Tipo</th><th style={{ width: 170 }}>Material (inventario)</th><th>Descripción *</th><th style={{ width: 80 }}>Cantidad *</th><th style={{ width: 96 }}>Precio unit.</th><th style={{ width: 100 }} className="n">Monto</th><th style={{ width: 30 }} /></tr></thead><tbody>
          {lines.map((l, i) => { const o = opts(l.matType), direct = ['Directo', 'Otro'].includes(l.matType); return (
            <tr key={i}>
              <td><input aria-label="Código" value={l.code} onChange={(e) => setL(i, 'code', e.target.value)} /></td>
              <td><select aria-label="Tipo de material" value={l.matType} onChange={(e) => setL(i, 'matType', e.target.value)}>{MAT_TYPES.map(([a, b]) => <option key={a} value={a}>{b}</option>)}</select></td>
              <td>{o.length ? <select aria-label="Material" value={l.matRef} onChange={(e) => pickMat(i, e.target.value)}><option value="">Selecciona…</option>{o.map(([a, b]) => <option key={a} value={a}>{b}</option>)}</select> : direct ? <select aria-label="Área a la que se carga" value={l.area} onChange={(e) => setL(i, 'area', e.target.value)}><option value="">General</option>{(meta?.areas ?? []).filter((a) => a[0] !== 'gen').map(([a, b]) => <option key={a} value={a}>{b}</option>)}</select> : <span className="muted">—</span>}</td>
              <td><input aria-label="Descripción" value={l.description} onChange={(e) => setL(i, 'description', e.target.value)} /></td>
              <td><input aria-label="Cantidad" type="number" min={0} step="any" value={l.qty} onChange={(e) => setL(i, 'qty', e.target.value)} /></td>
              <td><input aria-label="Precio unitario" type="number" min={0} step="any" value={l.unitPrice} onChange={(e) => setL(i, 'unitPrice', e.target.value)} /></td>
              <td className="n">{money(Math.round((+l.qty || 0) * (+l.unitPrice || 0) * 100) / 100, h.currency)}</td>
              <td>{lines.length > 1 && <button className="btn btn-sm btn-danger" aria-label="Quitar línea" onClick={() => setLines(lines.filter((_, j) => j !== i))}>✕</button>}</td></tr>); })}
        </tbody></table></div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, flexWrap: 'wrap', gap: 8 }}>
          <button className="btn btn-sm" onClick={() => setLines([...lines, emptyLine()])}>＋ Agregar línea</button>
          <span>Monto total en {h.currency}: <b>{money(total, h.currency)}</b>{h.currency === 'USD' && <span className="muted"> · ≈ {money(total * (+h.exchangeRate || 1))}</span>}</span>
        </div>
        <p className="muted" style={{ marginTop: 6 }}>Los tipos Insumo / Etiqueta / Ribbon / Bolsa ingresan al inventario al completar la orden. «Directo» y «Otro» restan su monto del área en el Resumen. ¿Falta un insumo? Créalo en Inventario → Insumos.</p>
      </fieldset>
      <fieldset className="fieldset"><legend>Firmas y control</legend><div className="form">{T('preparedBy', 'Realizado por')}{T('preparedPosition', 'Cargo')}{T('approvedBy', 'Autoriza (nombre)')}{T('approvedPosition', 'Puesto')}{T('lot', 'Lote')}{T('checkNo', 'Cheque')}{T('notes', 'Notas internas', 3)}</div></fieldset>
      <div className="mact">
        <button className="btn" onClick={onClose}>Cancelar</button>
        <button className="btn btn-blue" disabled={busy} onClick={() => save(false)}>{edit ? 'Guardar cambios' : 'Guardar como borrador'}</button>
        {!edit && can('compras.gestionar') && <button className="btn btn-primary" disabled={busy} onClick={() => save(true)}>Guardar y emitir</button>}
      </div>
    </Modal>
  );
}

function Historial() {
  const per = usePeriod(); const [sup, setSup] = useState('');
  const url = per ? `/ordenes-compra/historial?from=${per.start}&to=${per.end}${sup ? '&supplier=' + encodeURIComponent(sup) : ''}` : '';
  const { data, err, loading } = useLoad<any[]>(() => (url ? api.get(url) : Promise.resolve(null as any)), [url]);
  const tot = (data ?? []).reduce((a, r) => a + r.amountGtq, 0);
  return (
    <Card title="Historial de materiales solicitados" sub="Qué se pidió, cantidad, monto y proveedor (órdenes no anuladas; importes en Q)" actions={<input aria-label="Filtrar por proveedor" placeholder="Proveedor" value={sup} onChange={(e) => setSup(e.target.value)} />}>
      <Loading err={err} loading={loading && !data} />
      {data && !data.length && <p className="muted">Sin compras en este periodo.</p>}
      {data && data.length > 0 && <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Orden</th><th>Fecha</th><th>Proveedor</th><th>Material</th><th>Tipo</th><th className="n">Cantidad</th><th className="n">Monto</th><th className="n">Monto Q</th><th>Estado</th></tr></thead><tbody>
        {data.map((r, i) => <tr key={i}><td className="ocnum">{r.number}</td><td>{fmtDate(r.poDate)}</td><td>{r.supplier}</td><td>{r.code ? <span className="sap">{r.code}</span> : null} {r.description}</td><td>{r.matType}</td><td className="n">{nfx(r.qty)}</td><td className="n">{money(r.amount, r.currency)}</td><td className="n">{money(r.amountGtq)}</td><td>{STATUS_PILL[r.status]}</td></tr>)}
      </tbody><tfoot><tr><td colSpan={7}>Total del periodo (Q)</td><td className="n"><b>{money(tot)}</b></td><td /></tr></tfoot></table></div>}
    </Card>
  );
}
