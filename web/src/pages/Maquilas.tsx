import { useMemo, useState } from 'react';
import { api, newKey } from '../api';
import { Card, Loading, Modal, MonthBar, Pill, Tabs, useLoad } from '../components';
import { fmtDate, fmtDT, nfx } from '../format';
import { RecordForm, usePeriod, type FieldDef } from '../records-ui';
import { useApp } from '../store';

type Sub = 'prog' | 'pers' | 'fact';
const ST: Record<string, { l: string; k: 'gray' | 'warn' | 'ok' | 'bad' | 'blue' }> = {
  PROGRAMADA: { l: 'Programada', k: 'gray' }, EN_PROCESO: { l: 'En proceso', k: 'blue' },
  CERRADA: { l: 'Cerrada', k: 'warn' }, VALIDADA_SOP: { l: 'Validada SOP', k: 'blue' },
  VALIDADA_JEFATURA: { l: 'Validada jefatura', k: 'blue' }, VALIDADA: { l: 'Validada', k: 'ok' },
  RECHAZADA: { l: 'Rechazada', k: 'bad' }, EN_CARGO: { l: 'En cargo', k: 'blue' },
  FACTURADA: { l: 'Facturada', k: 'ok' }, COBRADA: { l: 'Cobrada', k: 'ok' }, ANULADA: { l: 'Anulada', k: 'bad' },
};
const est = (s: string) => ST[s] ?? { l: s, k: 'gray' as const };

export default function Maquilas() {
  const { can, meta } = useApp();
  const visibles = meta?.secciones ?? ['programacion', 'personas', 'facturacion', 'reportes', 'ajustes'];
  const items: [Sub, string][] = [];
  if (visibles.includes('programacion') || visibles.includes('cierre')) items.push(['prog', 'Programación']);
  if (visibles.includes('personas')) items.push(['pers', 'Personas']);
  if (visibles.includes('facturacion')) items.push(['fact', 'Por facturar']);
  const [sub, setSub] = useState<Sub>(items[0]?.[0] ?? 'prog');
  if (!items.length) return <Card title="Maquilas"><p className="muted">Tu perfil no tiene secciones de Maquilas habilitadas. Pide acceso a un administrador.</p></Card>;
  return (
    <>
      <MonthBar />
      <Tabs sub items={items} value={sub} onChange={setSub} />
      {sub === 'prog' && <Programacion />}
      {sub === 'pers' && <Personas canEdit={can('maquila.personas')} />}
      {sub === 'fact' && <PorFacturar />}
    </>
  );
}

function Programacion() {
  const { can, meta, toast, confirmBox } = useApp();
  const per = usePeriod();
  const [fCliente, setFCliente] = useState(''), [fEstado, setFEstado] = useState(''), [busy, setBusy] = useState(false);
  const [cerrar, setCerrar] = useState<any>(null), [asignar, setAsignar] = useState<any>(null), [key] = useState(newKey);
  const { data: cat } = useLoad<any>(() => api.get('/catalogo'), []);
  const { data: gente } = useLoad<any[]>(() => api.get('/maquila/personas?active=true&limit=300'), []);
  const qs = per ? `?from=${per.start}&to=${per.end}&limit=200${fCliente ? '&clientId=' + fCliente : ''}${fEstado ? '&status=' + fEstado : ''}` : '';
  const { data, err, loading, reload } = useLoad<any>(() => (qs ? api.get('/maquila/ordenes' + qs) : Promise.resolve(null)), [qs]);
  const rows: any[] = data?.rows ?? [];
  const clients: any[] = (cat?.clients ?? []).filter((c: any) => c.active);
  const projects: any[] = (cat?.projects ?? []).filter((p: any) => p.active);
  const fields: FieldDef[] = [
    { k: 'date', label: 'Fecha', type: 'date', required: true },
    { k: 'shift', label: 'Turno', type: 'select', required: true, options: [['DIA', 'Día'], ['TARDE', 'Tarde'], ['NOCHE', 'Noche']] },
    { k: 'projectId', label: 'Cliente / proyecto', type: 'select', required: true, w: 2, options: projects.map((p) => [p.id, `${clients.find((c) => c.id === p.clientId)?.name ?? '—'} · ${p.name}`]), onChange: (v, set) => { const p = projects.find((x) => x.id === v); if (p) set('unit', p.um ?? 'UNIDAD'); } },
    { k: 'sap', label: 'Producto (SAP)', type: 'text' },
    { k: 'productName', label: 'Descripción', type: 'text', w: 2 },
    { k: 'targetQty', label: 'Meta', type: 'num' },
    { k: 'unit', label: 'Unidad', type: 'text' },
    { k: 'notes', label: 'Observación', type: 'textarea', w: 2 },
  ];
  const crear = async (v: Record<string, any>) => {
    const p = projects.find((x) => x.id === v.projectId);
    if (!p) return toast('Selecciona el proyecto.', true);
    setBusy(true);
    try { await api.post('/maquila/ordenes', { ...v, clientId: p.clientId }, key); toast('Orden programada.'); reload(); }
    catch (e: any) { toast(e.message, true); } finally { setBusy(false); }
  };
  const iniciar = async (o: any) => {
    const c = await confirmBox({ title: 'Iniciar la maquila', text: `Se registrará la hora de inicio de ${o.clientName} · ${o.productName || o.sap || 'sin producto'}.`, okLabel: 'Iniciar' });
    if (!c.ok) return;
    try { await api.post(`/maquila/ordenes/${o.id}/iniciar`); toast('Maquila iniciada.'); reload(); } catch (e: any) { toast(e.message, true); }
  };
  const guardarCierre = async () => {
    if (!cerrar) return;
    setBusy(true);
    try { await api.post(`/maquila/ordenes/${cerrar.o.id}/cerrar`, { producedQty: Number(cerrar.cantidad || 0), notes: cerrar.notas || undefined, version: cerrar.o.version }); toast('Maquila cerrada.'); setCerrar(null); reload(); }
    catch (e: any) { toast(e.message, true); } finally { setBusy(false); }
  };
  const abrirAsignar = async (o: any) => {
    try {
      const d = await api.get(`/maquila/ordenes/${o.id}`);
      const cur = new Map<string, any>((d.assignments ?? []).filter((a: any) => a.active).map((a: any) => [a.personId, a] as [string, any]));
      setAsignar({ o: d, filas: (gente ?? []).map((p: any) => ({ personId: p.id, code: p.code, name: p.name, on: cur.has(p.id), qty: String(cur.get(p.id)?.qtyAssigned ?? '') })) });
    } catch (e: any) { toast(e.message, true); }
  };
  const guardarAsignar = async () => {
    if (!asignar) return;
    setBusy(true);
    try {
      const personas = asignar.filas.filter((f: any) => f.on).map((f: any) => ({ personId: f.personId, qtyAssigned: Number(f.qty || 0) }));
      await api.put(`/maquila/ordenes/${asignar.o.id}/asignaciones`, { personas });
      toast('Personas asignadas.'); setAsignar(null); reload();
    } catch (e: any) { toast(e.message, true); } finally { setBusy(false); }
  };
  return (
    <>
      {can('maquila.programar') && per?.status !== 'cerrado' && (
        <Card title="Programar maquila" sub="Cliente, producto, turno y meta. Después asigna las personas.">
          <RecordForm fields={fields} initial={{ date: meta?.today, shift: 'DIA', unit: 'UNIDAD', targetQty: 0 }} onSubmit={crear} submitLabel="Programar" busy={busy} />
        </Card>
      )}
      {per?.status === 'cerrado' && <div className="note">El periodo está cerrado: no se programan maquilas nuevas en estas fechas.</div>}
      <Card title={`Maquilas · ${per?.month ?? ''}`} sub={`${rows.length} órdenes`} actions={
        <span style={{ display: 'flex', gap: 8 }}>
          <select value={fCliente} onChange={(e) => setFCliente(e.target.value)} aria-label="Cliente"><option value="">Todos los clientes</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          <select value={fEstado} onChange={(e) => setFEstado(e.target.value)} aria-label="Estado"><option value="">Todos</option>{Object.entries(ST).map(([k, v]) => <option key={k} value={k}>{v.l}</option>)}</select>
        </span>
      }>
        <Loading err={err} loading={loading && !data} />
        {data && !rows.length && <p className="muted">Sin maquilas en este periodo.</p>}
        {rows.length > 0 && <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Fecha</th><th>Cliente / proyecto</th><th>Producto</th><th className="n">Meta</th><th className="n">Producido</th><th className="n">Personas</th><th>Estado</th><th /></tr></thead><tbody>
          {rows.map((o) => (
            <tr key={o.id}>
              <td>{fmtDate(o.date)}<div className="muted">{o.shift}</div></td>
              <td><b>{o.clientName}</b><div className="muted">{o.projectName}</div></td>
              <td>{o.sap && <span className="sap">{o.sap}</span>} {o.productName || '—'}</td>
              <td className="n">{nfx(o.targetQty)}</td>
              <td className="n">{nfx(o.producedQty)} <span className="muted">{o.unit}</span></td>
              <td className="n">{o.people}</td>
              <td><Pill kind={est(o.status).k}>{est(o.status).l}</Pill>{o.startedAt && <div className="muted">{fmtDT(o.startedAt)}</div>}</td>
              <td style={{ whiteSpace: 'nowrap' }}>
                {(o.status === 'PROGRAMADA' || o.status === 'EN_PROCESO') && can('maquila.asignar') && <button className="btn btn-sm" onClick={() => abrirAsignar(o)}>Asignar</button>}{' '}
                {o.status === 'PROGRAMADA' && can('maquila.iniciar') && <button className="btn btn-sm btn-blue" onClick={() => iniciar(o)}>Iniciar</button>}{' '}
                {o.status === 'EN_PROCESO' && can('maquila.cerrar') && <button className="btn btn-sm btn-blue" onClick={() => setCerrar({ o, cantidad: o.producedQty || '', notas: o.notes || '' })}>Cerrar</button>}
              </td>
            </tr>))}
        </tbody></table></div>}
      </Card>
      {cerrar && <Modal title="Cerrar maquila" onClose={() => setCerrar(null)}>
        <p className="muted">{cerrar.o.clientName} · {cerrar.o.productName || cerrar.o.sap} · inicio {cerrar.o.startedAt ? fmtDT(cerrar.o.startedAt) : '—'}</p>
        <label>Cantidad producida ({cerrar.o.unit})<input type="number" min="0" step="any" value={cerrar.cantidad} onChange={(e) => setCerrar({ ...cerrar, cantidad: e.target.value })} autoFocus /></label>
        <label>Observación<textarea rows={2} value={cerrar.notas} onChange={(e) => setCerrar({ ...cerrar, notas: e.target.value })} /></label>
        <div className="mact"><button className="btn" onClick={() => setCerrar(null)}>Cancelar</button><button className="btn btn-blue" disabled={busy} onClick={guardarCierre}>Cerrar maquila</button></div>
      </Modal>}
      {asignar && <Modal title={`Asignar personas · ${asignar.o.clientName}`} onClose={() => setAsignar(null)} wide>
        {!asignar.filas.length && <p className="muted">No hay personas activas en esta sede. Agrégalas en la pestaña Personas.</p>}
        {asignar.filas.length > 0 && <div className="tbl-wrap"><table className="tbl"><thead><tr><th></th><th>Código</th><th>Nombre</th><th className="n">Cantidad asignada</th></tr></thead><tbody>
          {asignar.filas.map((f: any, i: number) => <tr key={f.personId}>
            <td><input type="checkbox" checked={f.on} onChange={(e) => setAsignar({ ...asignar, filas: asignar.filas.map((x: any, j: number) => j === i ? { ...x, on: e.target.checked } : x) })} /></td>
            <td><code>{f.code}</code></td><td>{f.name}</td>
            <td className="n"><input type="number" min="0" step="any" value={f.qty} onChange={(e) => setAsignar({ ...asignar, filas: asignar.filas.map((x: any, j: number) => j === i ? { ...x, qty: e.target.value } : x) })} style={{ width: 110 }} /></td>
          </tr>)}
        </tbody></table></div>}
        <div className="mact"><button className="btn" onClick={() => setAsignar(null)}>Cancelar</button><button className="btn btn-blue" disabled={busy} onClick={guardarAsignar}>Guardar asignación</button></div>
      </Modal>}
    </>
  );
}

function Personas({ canEdit }: { canEdit: boolean }) {
  const { toast } = useApp();
  const [q, setQ] = useState(''), [busy, setBusy] = useState(false), [key] = useState(newKey);
  const { data, err, loading, reload } = useLoad<any[]>(() => api.get('/maquila/personas?limit=300' + (q ? '&q=' + encodeURIComponent(q) : '')), [q]);
  const rows = data ?? [];
  const crear = async (v: Record<string, any>) => {
    setBusy(true);
    try { await api.post('/maquila/personas', v, key); toast('Persona agregada.'); reload(); }
    catch (e: any) { toast(e.message, true); } finally { setBusy(false); }
  };
  const alternar = async (p: any) => {
    try { await api.patch(`/maquila/personas/${p.id}`, { active: !p.active }); toast(p.active ? 'Persona desactivada.' : 'Persona activada.'); reload(); }
    catch (e: any) { toast(e.message, true); }
  };
  return (
    <>
      {canEdit && <Card title="Agregar persona" sub="Lista local de la maquila. Cuando exista GEOVICTORIA se sincroniza por código externo.">
        <RecordForm fields={[{ k: 'code', label: 'Código', type: 'text', required: true }, { k: 'name', label: 'Nombre', type: 'text', required: true, w: 2 }, { k: 'position', label: 'Puesto', type: 'text' }]} initial={{ active: true }} onSubmit={crear} submitLabel="Agregar" busy={busy} />
      </Card>}
      <Card title="Personas de maquila" sub={`${rows.length} personas`} actions={<input type="search" placeholder="Buscar por nombre o código" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar persona" />}>
        <Loading err={err} loading={loading && !data} />
        {data && !rows.length && <p className="muted">Sin personas. {canEdit ? 'Agrega la primera arriba.' : ''}</p>}
        {rows.length > 0 && <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Código</th><th>Nombre</th><th>Puesto</th><th>Origen</th><th>Estado</th><th /></tr></thead><tbody>
          {rows.map((p) => <tr key={p.id} className={p.active ? '' : 'void'}>
            <td><code>{p.code}</code></td><td>{p.name}</td><td>{p.position || '—'}</td>
            <td>{p.source === 'GEOVICTORIA' ? 'GEOVICTORIA' : 'Local'}</td>
            <td><Pill kind={p.active ? 'ok' : 'gray'}>{p.active ? 'Activa' : 'Inactiva'}</Pill></td>
            <td>{canEdit && <button className="btn btn-sm" onClick={() => alternar(p)}>{p.active ? 'Desactivar' : 'Activar'}</button>}</td>
          </tr>)}
        </tbody></table></div>}
      </Card>
    </>
  );
}

function PorFacturar() {
  const per = usePeriod();
  const qs = per ? `?from=${per.start}&to=${per.end}&limit=500` : '';
  const { data, err, loading } = useLoad<any[]>(() => (qs ? api.get('/maquila/por-facturar' + qs) : Promise.resolve([])), [qs]);
  const rows = data ?? [];
  const total = useMemo(() => rows.length, [rows]);
  return (
    <Card title="Maquilas validadas por facturar" sub={`${total} listas para agrupar en un cargo`}>
      <p className="muted">La agrupación en cargo y la factura se habilitan en la fase de facturación. El número de factura se genera en el módulo comercial compartido.</p>
      <Loading err={err} loading={loading && !data} />
      {data && !rows.length && <p className="muted">No hay maquilas validadas pendientes en este periodo.</p>}
      {rows.length > 0 && <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Fecha</th><th>Cliente</th><th>Proyecto</th><th>Producto</th><th className="n">Cantidad</th><th>Validada</th></tr></thead><tbody>
        {rows.map((r) => <tr key={r.id}><td>{fmtDate(r.date)}</td><td>{r.clientName}</td><td>{r.projectName}</td><td>{r.sap && <span className="sap">{r.sap}</span>} {r.productName || '—'}</td><td className="n">{nfx(r.producedQty)} {r.unit}</td><td>{r.validatedAt ? fmtDT(r.validatedAt) : '—'}</td></tr>)}
      </tbody></table></div>}
    </Card>
  );
}
