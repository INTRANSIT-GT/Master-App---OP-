import { useMemo, useState } from 'react';
import { api, ApiError, newKey } from '../api';
import { Card, Loading, Modal, MonthBar, StatusPill, useLoad } from '../components';
import { fmtDate, nfx } from '../format';
import { RecordForm, usePeriod, type FieldDef } from '../records-ui';
import { useApp } from '../store';

const STATUS: [string, string][] = [['FINALIZADO', 'FINALIZADO'], ['PARCIAL', 'PARCIAL'], ['PROCESO', 'PROCESO']];
const num = (k: string, label: string, extra: Partial<FieldDef> = {}): FieldDef => ({ k, label, type: 'num', ...extra });
const txt = (k: string, label: string, extra: Partial<FieldDef> = {}): FieldDef => ({ k, label, type: 'text', ...extra });

/** Campos por tipo de registro. La fecha se agrega aparte (automática = hoy). */
function fieldsFor(kind: string, p: { products: [string, string][]; labels: [string, string][]; um: string }): { fields: FieldDef[]; hint?: string } {
  const D = (label = 'Fecha'): FieldDef => ({ k: 'date', label, type: 'date', required: true });
  switch (kind) {
    case 'maq': return { fields: [D(), { k: 'sap', label: 'Producto (SAP)', type: 'select', options: p.products, w: 2, required: true, hint: 'La descripción sale del catálogo SAP' }, num('boxes', 'Total (cajas)', { required: true }), txt('notes', 'Observación', { w: 2 })], hint: 'Las HH salen de cajas ÷ cajas por tarima × TT ÷ 60' };
    case 'wm': return { fields: [D(), txt('refDoc', 'Remisión / orden'), { ...txt('productName', 'Producto'), w: 2 }, num('unitsPerBox', 'U. por caja'), num('boxes', 'Cajas', { required: true }), num('units', 'Total unidades', { hint: 'Si lo dejas vacío = cajas × U. por caja' }), txt('notes', 'Observación')], hint: 'Cobro: unidades ÷ 19 si la caja trae 19 o más; si no, unidades ÷ u. por caja' };
    case 'cob': return { fields: [D(), txt('refDoc', 'No. egreso'), num('boxes', 'Cajas', { required: true }), txt('notes', 'Observación', { w: 2 })] };
    case 'desc': return { fields: [D('Fecha de ingreso'), txt('refDoc', 'Factura / contenedor', { required: true }), { k: 'containerType', label: 'Tipo de descarga', type: 'select', required: true, options: [['GALLETA', 'GALLETA'], ['SALADO', 'SALADO'], ['FLUS', 'FLUS'], ['QUAKER', 'QUAKER']] }, num('boxes', 'Cajas descargadas'), txt('notes', 'Observación', { w: 2 })], hint: 'Cada contenedor cuenta 1 en su tipo de descarga' };
    case 'uni': return { fields: [D(), txt('refDoc', 'Remisión'), { k: 'sap', label: 'Material (SAP)', type: 'select', options: p.products, w: 2 }, { ...txt('productName', 'Denominación'), w: 2 }, num('boxes', 'Cajas'), num('unitsPerBox', 'U / caja'), num('units', 'Total U'), num('labelsUsed', 'Etiquetas utilizadas', { hint: 'Descuenta etiqueta 3X2 del inventario' })] };
    case 'dc': return { fields: [D(), txt('refDoc', 'Remisión'), { k: 'sap', label: 'Producto (SAP)', type: 'select', options: p.products, w: 2, required: true }, num('boxes', 'Cajas', { required: true })] };
    case 'revm': return { fields: [D(), txt('sap', 'Código'), { ...txt('productName', 'Material'), w: 2 }, num('boxes', 'Cajas'), num('units', 'Unidades', { required: true }), txt('notes', 'Solicitado por')] };
    case 'etq': case 'noc': case 'qua': return { fields: [{ k: 'kind', label: 'Turno / tipo', type: 'select', required: true, options: [['etq', 'Etiquetado día'], ['noc', 'Etiquetado noche'], ['qua', 'Etiquetado Quaker']] }, D('Fecha de finalización'), txt('refDoc', 'Factura'), txt('presentation', 'Presentación', { list: 'presList' }), { k: 'labelId', label: 'Etiqueta', type: 'select', options: p.labels }, { ...txt('productName', 'Producto'), w: 2 }, num('boxes', 'Cajas a maquilar'), num('units', 'Unidades etiquetadas', { hint: 'Descuentan etiqueta y ribbon' }), num('reviewUnits', 'Unid. mal estado revisadas'), num('badBoxes', 'Cajas mal estado o cruce'), { k: 'processStatus', label: 'Status', type: 'select', options: STATUS }, txt('notes', 'Observación')], hint: 'Lo trabajado ese día, aunque el contenedor no esté finalizado' };
    case 'sun': return { fields: [D('Fecha de finalización'), txt('refDoc', 'Factura'), txt('presentation', 'Presentación'), { ...txt('productName', 'Producto'), w: 2 }, num('boxes', 'Cajas a maquilar'), num('units', 'Unidades etiquetadas'), num('reviewUnits', 'Unid. revisadas'), num('badBoxes', 'Cajas mal estado'), { k: 'processStatus', label: 'Status', type: 'select', options: STATUS }, txt('notes', 'Observación')], hint: 'Sunchips lleva 3 etiquetas por unidad: 1X1, 4X2 y 1.25X0.5' };
    case 'crk': return { fields: [D('Fecha de finalización'), txt('refDoc', 'Factura'), { ...txt('productName', 'Producto (ej. …X64X1)'), w: 2 }, num('boxes', 'Cajas buenas (a maquilar)'), num('badBoxes', 'Cajas en mal estado'), num('reviewUnits', 'Unid. revisadas', { hint: 'Vacío = cajas malas × unidades por caja' }), { k: 'processStatus', label: 'Status', type: 'select', options: STATUS }, txt('notes', 'Observación')], hint: 'Se cobran las cajas buenas; las horas usan buenas + malas × 3.33 min' };
    default: return { fields: [D(), txt('refDoc', 'Documento / referencia'), { ...txt('productName', 'Producto / descripción (opcional)'), w: 2 }, num('boxes', `Cantidad (${p.um.toLowerCase()})`, { required: true }), txt('notes', 'Observación', { w: 2 })], hint: 'Este proyecto se cobra por cantidad × tarifa (área comercial)' };
  }
}
const detail = (r: any) => {
  const parts = [r.sap && <span className="sap" key="s">{r.sap}</span>, r.productName, r.refDoc && `Doc. ${r.refDoc}`, r.containerType, r.notes && `· ${r.notes}`].filter(Boolean);
  return <>{parts.map((x, i) => <span key={i}> {x}</span>)}</>;
};
const qty = (r: any, um: string) => {
  switch (r.kind) {
    case 'wm': case 'uni': case 'revm': return `${nfx(r.units || r.boxes)} ${r.units ? 'unid.' : 'cajas'}`;
    case 'etq': case 'noc': case 'qua': case 'sun': return `${nfx(r.units)} unid.`;
    case 'crk': return `${nfx(r.boxes)} buenas${r.badBoxes ? ` · ${nfx(r.badBoxes)} malas` : ''}`;
    case 'desc': return `${nfx(r.boxes)} cajas`;
    case 'gen': return `${nfx(r.boxes)} ${um.toLowerCase()}`;
    default: return `${nfx(r.boxes)} cajas`;
  }
};

export default function Produccion() {
  const { can, toast, refresh, confirmBox, meta } = useApp();
  const per = usePeriod(); const closed = per?.status === 'cerrado';
  const { data: cat } = useLoad<any>(() => api.get('/catalogo'), []);
  const clients: any[] = (cat?.clients ?? []).filter((c: any) => c.active), projects: any[] = cat?.projects ?? [];
  // para elegir, solo los proyectos de la sede actual (y sus clientes); el historial conserva los nombres de todos
  const sedeProj = projects.filter((p) => p.sedeId === meta?.sede?.id), sedeCli = clients.filter((c) => sedeProj.some((p) => p.clientId === c.id));
  const [fc, setFc] = useState(''), [fp, setFp] = useState(''), [showVoid, setShowVoid] = useState(false), [adding, setAdding] = useState(false), [edit, setEdit] = useState<any>(null);
  const projIds = useMemo(() => (fp ? [fp] : fc ? projects.filter((p) => p.clientId === fc).map((p) => p.id) : []), [fc, fp, projects]);
  const url = per ? `/produccion?from=${per.start}&to=${per.end}&limit=500${projIds.length ? '&project=' + projIds.join(',') : ''}` : '';
  const { data, err, loading, reload } = useLoad<any>(() => (url ? api.get(url) : Promise.resolve(null)), [url]);
  const rows: any[] = (data?.rows ?? []).filter((r: any) => showVoid || r.status !== 'anulado');
  const pr = (id: string) => projects.find((p) => p.id === id), cl = (id: string) => clients.find((c) => c.id === id)?.name ?? '';
  const products: [string, string][] = (cat?.products ?? []).filter((p: any) => p.active).map((p: any) => [p.sap, `${p.sap} · ${p.name}`]);
  const labels: [string, string][] = (cat?.items ?? []).filter((i: any) => i.kind === 'lab').map((i: any) => [i.code, i.code]);

  const voidIt = async (r: any) => {
    const c = await confirmBox({ title: 'Anular registro', text: 'No se borra: queda anulado con su justificación y deja de sumar en los cálculos.', reason: true, okLabel: 'Anular', danger: true });
    if (!c.ok) return;
    try { await api.post(`/produccion/${r.id}/anular`, { reason: c.reason }); toast('Registro anulado.'); reload(); refresh(); } catch (e: any) { toast(e.message, true); }
  };
  const confirmIt = async (r: any) => { try { await api.post(`/produccion/${r.id}/confirmar`); toast('Borrador confirmado.'); reload(); refresh(); } catch (e: any) { toast(e.message, true); } };
  const saveEdit = async (vals: Record<string, any>) => {
    let reason: string | undefined;
    if (edit.status === 'confirmado') { const c = await confirmBox({ title: 'Motivo del cambio', text: 'Este registro ya está confirmado: el cambio queda en la bitácora.', reason: true, okLabel: 'Guardar cambio' }); if (!c.ok) return; reason = c.reason; }
    try { await api.patch(`/produccion/${edit.id}`, { ...vals, version: edit.version, reason }); toast('Cambio guardado.'); setEdit(null); reload(); refresh(); } catch (e: any) { toast(e.message, true); }
  };
  const editProj = edit ? pr(edit.projectId) : null;
  return (
    <>
      <MonthBar status={per?.status} />
      <datalist id="presList"><option>FLUS</option><option>GALLETA</option><option>QUAKER</option><option>WALMART</option><option>SALADO</option></datalist>
      <Card title="Registros de producción" sub={`${rows.length} registros en ${per?.month ?? ''}`}
        actions={<div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <select aria-label="Filtrar por cliente" value={fc} onChange={(e) => { setFc(e.target.value); setFp(''); }}><option value="">Todos los clientes</option>{sedeCli.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          <select aria-label="Filtrar por proyecto" value={fp} onChange={(e) => setFp(e.target.value)} disabled={!fc}><option value="">Todos los proyectos</option>{sedeProj.filter((p) => p.clientId === fc).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
          <label className="chk" style={{ fontSize: 13 }}><input type="checkbox" checked={showVoid} onChange={(e) => setShowVoid(e.target.checked)} /> Ver anulados</label>
          {can('registro.crear') && <button className="btn btn-primary big-btn" onClick={() => setAdding(true)} disabled={!cat}>＋ Añadir nuevo registro</button>}
        </div>}>
        <Loading err={err} loading={loading && !data} />
        {closed && <div className="note">El periodo está cerrado: no se pueden agregar ni modificar registros en estas fechas.</div>}
        {data && !rows.length && <p className="muted">Sin registros en este periodo{fc ? ' para el filtro elegido' : ''}.</p>}
        {rows.length > 0 && <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Fecha</th><th>Cliente</th><th>Proyecto</th><th>Detalle</th><th className="n">Cantidad</th><th>Estado</th><th /></tr></thead><tbody>
          {rows.map((r) => { const p = pr(r.projectId); return (
            <tr key={r.id} className={r.status === 'anulado' ? 'void' : r.status === 'borrador' ? 'draft' : ''}>
              <td>{fmtDate(r.recordDate)}</td><td>{p ? cl(p.clientId) : ''}</td><td>{p?.name}{(r.kind === 'noc' || r.kind === 'qua') && <span className="muted"> · {r.kind === 'noc' ? 'noche' : 'Quaker'}</span>}</td><td>{detail(r)}</td><td className="n">{qty(r, p?.um ?? '')}</td>
              <td><StatusPill s={r.status} />{r.isDemo && <> <span className="pill p-warn">demo</span></>}{r.status === 'anulado' && <div className="muted">{r.voidReason}</div>}</td>
              <td style={{ whiteSpace: 'nowrap' }}>
                {r.status === 'borrador' && <button className="btn btn-sm" onClick={() => confirmIt(r)}>Confirmar</button>}{' '}
                {r.status !== 'anulado' && !closed && (can('registro.editar') || (r.status === 'borrador' && can('registro.editar_propio'))) && <button className="btn btn-sm" onClick={() => setEdit(r)}>Editar</button>}{' '}
                {r.status !== 'anulado' && !closed && can('registro.anular') && <button className="btn btn-sm btn-danger" onClick={() => voidIt(r)}>Anular</button>}
              </td></tr>); })}
        </tbody></table></div>}
        <p className="muted" style={{ marginTop: 8 }}>Los registros no se borran: se modifican (con motivo) o se anulan, y cada cambio queda en la bitácora.</p>
      </Card>
      {adding && <NewRecord clients={sedeCli} projects={sedeProj} products={products} labels={labels} today={meta?.today ?? ''} onClose={() => setAdding(false)} onSaved={() => { reload(); refresh(); }} />}
      {edit && editProj && <Modal title={`Editar · ${editProj.name}`} onClose={() => setEdit(null)} wide>
        <RecordForm fields={fieldsFor(edit.kind, { products, labels, um: editProj.um }).fields} initial={{ ...edit, date: edit.recordDate }} onSubmit={saveEdit} submitLabel="Guardar cambio" />
        <div className="mact"><button className="btn" onClick={() => setEdit(null)}>Cancelar</button></div></Modal>}
    </>
  );
}

function NewRecord({ clients, projects, products, labels, today, onClose, onSaved }: { clients: any[]; projects: any[]; products: [string, string][]; labels: [string, string][]; today: string; onClose: () => void; onSaved: () => void }) {
  const { toast, can, confirmBox } = useApp();
  const [cid, setCid] = useState(''), [pid, setPid] = useState(''), [otherDate, setOtherDate] = useState(false), [draft, setDraft] = useState(false), [busy, setBusy] = useState(false), [key, setKey] = useState(newKey), [n, setN] = useState(0);
  const proj = projects.find((p) => p.id === pid);
  const kind: string = proj?.kinds?.[0] ?? '';
  const spec = proj ? fieldsFor(kind, { products, labels, um: proj.um }) : null;
  const fields = spec?.fields.map((f) => (f.k === 'date' ? { ...f, readOnly: !otherDate, label: otherDate ? f.label : `${f.label} (hoy, automática)` } : f)) ?? [];
  const save = async (vals: Record<string, any>) => {
    setBusy(true);
    const body = { kind: vals.kind ?? kind, projectId: pid, ...vals, date: otherDate ? vals.date : today, status: draft ? 'borrador' : 'confirmado' };
    const ok = () => { toast(`Registro guardado en ${proj.name}.`); setKey(newKey()); setN((x) => x + 1); onSaved(); };
    try { await api.post('/produccion', body, key); ok(); }
    catch (e: any) {
      if (e instanceof ApiError && e.code === 'DUPLICADO') {
        if (can('registro.confirmar')) {
          const c = await confirmBox({ title: 'Registro duplicado', text: 'Ya existe un registro idéntico. Si de verdad es otro, regístralo de todos modos.', okLabel: 'Registrar duplicado' });
          if (c.ok) { try { await api.post('/produccion', { ...body, allowDuplicate: true }, newKey()); ok(); } catch (e2: any) { toast(e2.message, true); } }
        } else toast('Ya existe un registro idéntico; no se guardó. Si es otro, pide a un supervisor que lo registre.', true);
      } else toast(e.message, true);
    } finally { setBusy(false); }
  };
  return (
    <Modal title="Añadir nuevo registro" onClose={onClose} wide>
      <div className="form" style={{ marginBottom: 6 }}>
        <div className="field"><label htmlFor="nr-c">Cliente *</label><select id="nr-c" value={cid} onChange={(e) => { setCid(e.target.value); setPid(''); }}><option value="">Selecciona…</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
        <div className="field w2"><label htmlFor="nr-p">Proyecto *</label><select id="nr-p" value={pid} disabled={!cid} onChange={(e) => setPid(e.target.value)}><option value="">{cid ? 'Selecciona el proyecto…' : 'Primero elige el cliente'}</option>{projects.filter((p) => p.clientId === cid && p.active).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
      </div>
      {spec && <>
        {spec.hint && <p className="muted" style={{ margin: '4px 0 8px' }}>{spec.hint}</p>}
        <RecordForm key={pid + n} fields={fields} initial={{ date: today, ...(kind === 'etq' ? { kind: 'etq' } : {}) }} onSubmit={save} submitLabel="Guardar registro" busy={busy} />
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 8, fontSize: 13 }}>
          <label className="chk"><input type="checkbox" checked={otherDate} onChange={(e) => setOtherDate(e.target.checked)} /> Registrar en otra fecha</label>
          <label className="chk"><input type="checkbox" checked={draft} onChange={(e) => setDraft(e.target.checked)} /> Guardar como borrador (no suma hasta confirmarlo)</label>
        </div>
      </>}
      <div className="mact"><button className="btn" onClick={onClose}>Cerrar</button></div>
    </Modal>
  );
}
