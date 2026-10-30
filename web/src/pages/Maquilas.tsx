import { useEffect, useState } from 'react';
import { api, newKey } from '../api';
import { Card, Loading, Modal, MonthBar, Pill, Tabs, useLoad } from '../components';
import { fmtDate, fmtDT, nfx, q2 } from '../format';
import { RecordForm, usePeriod, type FieldDef } from '../records-ui';
import { useApp } from '../store';

type Sub = 'prog' | 'pers' | 'val' | 'fact';
const ST: Record<string, { l: string; k: 'gray' | 'warn' | 'ok' | 'bad' | 'blue' }> = {
  PROGRAMADA: { l: 'Programada', k: 'gray' }, EN_PROCESO: { l: 'En proceso', k: 'blue' },
  CERRADA: { l: 'Cerrada', k: 'warn' }, VALIDADA_SOP: { l: 'Validada SOP', k: 'blue' },
  VALIDADA_JEFATURA: { l: 'Validada jefatura', k: 'blue' }, VALIDADA: { l: 'Validada', k: 'ok' },
  RECHAZADA: { l: 'Rechazada', k: 'bad' }, EN_CARGO: { l: 'En cargo', k: 'blue' },
  FACTURADA: { l: 'Facturada', k: 'ok' }, COBRADA: { l: 'Cobrada', k: 'ok' }, ANULADA: { l: 'Anulada', k: 'bad' },
};
const est = (s: string) => ST[s] ?? { l: s, k: 'gray' as const };
const q2n = (x: number) => Math.round(x * 100) / 100;
/** Cantidad por parte cuando el proyecto la desglosa (p. ej. Cartón A 120 · Cartón B 45). */
function Desglose({ o }: { o: any }) {
  const d = Object.entries(o.producedDetail ?? {});
  return d.length ? <div className="muted">{d.map(([k, v]) => `${k} ${nfx(Number(v))}`).join(' · ')}</div> : null;
}
const proyecto = (o: any) => o.projectName + (o.activityName ? ' · ' + o.activityName : '') + (o.category === 'OUTSOURCING' ? ' (outsourcing)' : '');

export default function Maquilas() {
  const { can, meta } = useApp();
  const visibles = meta?.secciones ?? ['programacion', 'personas', 'facturacion', 'reportes', 'ajustes'];
  const items: [Sub, string][] = [];
  if (visibles.includes('programacion') || visibles.includes('cierre')) items.push(['prog', 'Programación']);
  if (visibles.includes('personas')) items.push(['pers', 'Personas']);
  if (visibles.includes('validacion')) items.push(['val', 'Validación']);
  if (visibles.includes('facturacion')) items.push(['fact', 'Facturación']);
  const [sub, setSub] = useState<Sub>(items[0]?.[0] ?? 'prog');
  if (!items.length) return <Card title="Maquilas"><p className="muted">Tu perfil no tiene secciones de Maquilas habilitadas. Pide acceso a un administrador.</p></Card>;
  return (
    <>
      <MonthBar />
      <Tabs sub items={items} value={sub} onChange={setSub} />
      {sub === 'prog' && <Programacion />}
      {sub === 'pers' && <Personas canEdit={can('maquila.personas')} />}
      {sub === 'val' && <Validacion />}
      {sub === 'fact' && <Facturacion />}
    </>
  );
}

function Programacion() {
  const { can, meta, toast, confirmBox } = useApp();
  const per = usePeriod();
  const [fCliente, setFCliente] = useState(''), [fEstado, setFEstado] = useState(''), [busy, setBusy] = useState(false);
  const [cerrar, setCerrar] = useState<any>(null), [asignar, setAsignar] = useState<any>(null), [confirmar, setConfirmar] = useState<any>(null), [key] = useState(newKey);
  const [selP, setSelP] = useState('');
  const { data: cat } = useLoad<any>(() => api.get('/catalogo'), []);
  const { data: gente } = useLoad<any[]>(() => api.get('/maquila/personas?active=true&limit=300'), []);
  const qs = per ? `?from=${per.start}&to=${per.end}&limit=200${fCliente ? '&clientId=' + fCliente : ''}${fEstado ? '&status=' + fEstado : ''}` : '';
  const { data, err, loading, reload } = useLoad<any>(() => (qs ? api.get('/maquila/ordenes' + qs) : Promise.resolve(null)), [qs]);
  const rows: any[] = data?.rows ?? [];
  // cada sede trabaja sus propios proyectos (los clientes son comunes)
  const projects: any[] = (cat?.projects ?? []).filter((p: any) => p.active && p.sedeId === meta?.sede?.id);
  const clients: any[] = (cat?.clients ?? []).filter((c: any) => c.active && projects.some((p) => p.clientId === c.id));
  const sp = projects.find((p) => p.id === selP), acts: any[] = (sp?.activities ?? []).filter((a: any) => a.active);
  // los campos son siempre los mismos (RecordForm reinicia los valores si cambian); cambian opciones y textos según el proyecto
  const fields: FieldDef[] = [
    { k: 'date', label: 'Fecha', type: 'date', required: true },
    { k: 'shift', label: 'Turno', type: 'select', required: true, options: [['DIA', 'Día'], ['TARDE', 'Tarde'], ['NOCHE', 'Noche']] },
    { k: 'projectId', label: 'Cliente / proyecto', type: 'select', required: true, w: 2, options: projects.map((p) => [p.id, `${clients.find((c) => c.id === p.clientId)?.name ?? '—'} · ${p.name}${p.category === 'OUTSOURCING' ? ' (outsourcing)' : ''}`]),
      onChange: (v, set) => { setSelP(v); const p = projects.find((x) => x.id === v); if (p) set('unit', p.um ?? 'UNIDAD'); const a = (p?.activities ?? []).filter((x: any) => x.active); set('activityId', a.length === 1 ? a[0].id : ''); } },
    { k: 'activityId', label: 'Actividad', type: 'select', required: acts.length > 0, readOnly: !acts.length, options: acts.map((a) => [a.id, a.name]), hint: sp && !acts.length ? 'El proyecto no tiene actividades' : undefined },
    { k: 'clientConfirmation', label: sp?.confirmLabel ?? 'Confirmación del cliente', type: 'text', w: 2, readOnly: !sp?.confirmLabel, hint: sp?.confirmLabel ? 'Necesaria para iniciar; puedes registrarla después' : sp ? 'No se requiere en este proyecto' : undefined },
    { k: 'sap', label: 'Producto (SAP)', type: 'text' },
    { k: 'productName', label: 'Descripción', type: 'text', w: 2 },
    { k: 'targetQty', label: 'Meta', type: 'num' },
    // con otras unidades admitidas (p. ej. packs o bandejas) la unidad se elige de la lista
    sp?.altUnits?.length ? { k: 'unit', label: 'Unidad', type: 'select', required: true, options: [sp.um, ...sp.altUnits].map((u: string) => [u, u] as [string, string]) } : { k: 'unit', label: 'Unidad', type: 'text' },
    { k: 'notes', label: 'Observación', type: 'textarea', w: 2 },
  ];
  const crear = async (v: Record<string, any>) => {
    const p = projects.find((x) => x.id === v.projectId);
    if (!p) return toast('Selecciona el proyecto.', true);
    setBusy(true);
    const body: Record<string, any> = { ...v, clientId: p.clientId };
    for (const k of ['activityId', 'clientConfirmation']) if (!body[k]) delete body[k];
    try { await api.post('/maquila/ordenes', body, key); toast('Orden programada.'); reload(); }
    catch (e: any) { toast(e.message, true); } finally { setBusy(false); }
  };
  const iniciar = async (o: any) => {
    const c = await confirmBox({ title: 'Iniciar la maquila', text: `Se registrará la hora de inicio de ${o.clientName} · ${o.productName || o.sap || 'sin producto'}.`, okLabel: 'Iniciar' });
    if (!c.ok) return;
    try { await api.post(`/maquila/ordenes/${o.id}/iniciar`); toast('Maquila iniciada.'); reload(); } catch (e: any) { toast(e.message, true); }
  };
  const partes = (o: any): string[] => o?.outputParts ?? [];
  const sumaPartes = (c: any) => q2n(partes(c.o).reduce((a, k) => a + Number(c.det[k] || 0), 0));
  const guardarCierre = async () => {
    if (!cerrar) return;
    setBusy(true);
    // con desglose (p. ej. cartón A/B/C) se envían las partes y el servidor suma la cantidad
    const cant = partes(cerrar.o).length
      ? { producedDetail: Object.fromEntries(partes(cerrar.o).map((k) => [k, Number(cerrar.det[k] || 0)])) }
      : { producedQty: Number(cerrar.cantidad || 0) };
    try { await api.post(`/maquila/ordenes/${cerrar.o.id}/cerrar`, { ...cant, notes: cerrar.notas || undefined, version: cerrar.o.version }); toast('Maquila cerrada.'); setCerrar(null); reload(); }
    catch (e: any) { toast(e.message, true); } finally { setBusy(false); }
  };
  const guardarConfirmacion = async () => {
    if (!confirmar) return;
    setBusy(true);
    try { await api.post(`/maquila/ordenes/${confirmar.o.id}/confirmar`, { text: confirmar.texto }); toast('Confirmación del cliente registrada.'); setConfirmar(null); reload(); }
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
        <Card title="Programar maquila" sub={`Proyectos de ${meta?.sede?.name ?? 'esta sede'}: cliente, actividad, producto, turno y meta. Después asigna las personas.`}>
          {!projects.length && cat && <p className="muted">Esta sede no tiene proyectos activos. Agrégalos en Ajustes › Clientes y proyectos.</p>}
          <RecordForm fields={fields} initial={{ date: meta?.today, shift: 'DIA', unit: 'UNIDAD', targetQty: 0 }} onSubmit={crear} submitLabel="Programar" busy={busy} />
          {sp?.processNotes && <div className="note" style={{ marginTop: 8 }}><b>Cómo se trabaja {sp.name}:</b> {sp.processNotes}</div>}
          {sp && partes({ outputParts: sp.outputParts }).length > 0 && <p className="muted" style={{ marginTop: 6 }}>Al cerrar se registra la cantidad de cada parte: {sp.outputParts.join(', ')}.</p>}
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
              <td><b>{o.clientName}</b><div className="muted">{proyecto(o)}</div>
                {o.confirmLabel && (o.clientConfirmation ? <div className="muted" title={o.confirmLabel}>✓ {o.clientConfirmation}</div> : <Pill kind="warn">Falta confirmación del cliente</Pill>)}</td>
              <td>{o.sap && <span className="sap">{o.sap}</span>} {o.productName || '—'}</td>
              <td className="n">{nfx(o.targetQty)}</td>
              <td className="n">{nfx(o.producedQty)} <span className="muted">{o.unit}</span><Desglose o={o} /></td>
              <td className="n">{o.people}</td>
              <td><Pill kind={est(o.status).k}>{est(o.status).l}</Pill>{o.startedAt && <div className="muted">{fmtDT(o.startedAt)}</div>}</td>
              <td style={{ whiteSpace: 'nowrap' }}>
                {(o.status === 'PROGRAMADA' || o.status === 'EN_PROCESO') && can('maquila.asignar') && <button className="btn btn-sm" onClick={() => abrirAsignar(o)}>Asignar</button>}{' '}
                {o.status === 'PROGRAMADA' && o.confirmLabel && can('maquila.programar') && <button className="btn btn-sm" onClick={() => setConfirmar({ o, texto: o.clientConfirmation || '' })}>{o.clientConfirmation ? 'Cambiar confirmación' : 'Confirmar cliente'}</button>}{' '}
                {o.status === 'PROGRAMADA' && can('maquila.iniciar') && <button className="btn btn-sm btn-blue" disabled={!!o.confirmLabel && !o.clientConfirmation} title={o.confirmLabel && !o.clientConfirmation ? 'Primero registra la confirmación del cliente' : undefined} onClick={() => iniciar(o)}>Iniciar</button>}{' '}
                {o.status === 'EN_PROCESO' && can('maquila.cerrar') && <button className="btn btn-sm btn-blue" onClick={() => setCerrar({ o, cantidad: o.producedQty || '', det: { ...(o.producedDetail ?? {}) }, notas: o.notes || '' })}>Cerrar</button>}
              </td>
            </tr>))}
        </tbody></table></div>}
      </Card>
      {cerrar && <Modal title="Cerrar maquila" onClose={() => setCerrar(null)}>
        <p className="muted">{cerrar.o.clientName} · {cerrar.o.productName || cerrar.o.sap} · inicio {cerrar.o.startedAt ? fmtDT(cerrar.o.startedAt) : '—'}</p>
        {partes(cerrar.o).length ? <>
          <div className="form">{partes(cerrar.o).map((k, i) => <div className="field" key={k}><label htmlFor={'parte-' + i}>{k} ({cerrar.o.unit})</label>
            <input id={'parte-' + i} type="number" min="0" step="any" value={cerrar.det[k] ?? ''} onChange={(e) => setCerrar({ ...cerrar, det: { ...cerrar.det, [k]: e.target.value } })} autoFocus={i === 0} /></div>)}</div>
          <p><b>Total producido: {nfx(sumaPartes(cerrar))} {cerrar.o.unit}</b></p>
        </> : <label>Cantidad producida ({cerrar.o.unit})<input type="number" min="0" step="any" value={cerrar.cantidad} onChange={(e) => setCerrar({ ...cerrar, cantidad: e.target.value })} autoFocus /></label>}
        <label>Observación<textarea rows={2} value={cerrar.notas} onChange={(e) => setCerrar({ ...cerrar, notas: e.target.value })} /></label>
        <div className="mact"><button className="btn" onClick={() => setCerrar(null)}>Cancelar</button><button className="btn btn-blue" disabled={busy} onClick={guardarCierre}>Cerrar maquila</button></div>
      </Modal>}
      {confirmar && <Modal title="Confirmación del cliente" onClose={() => setConfirmar(null)}>
        <p className="muted">{confirmar.o.clientName} · {confirmar.o.projectName}</p>
        {confirmar.o.processNotes && <div className="note">{confirmar.o.processNotes}</div>}
        <label>{confirmar.o.confirmLabel}<input value={confirmar.texto} onChange={(e) => setConfirmar({ ...confirmar, texto: e.target.value })} autoFocus /></label>
        <div className="mact"><button className="btn" onClick={() => setConfirmar(null)}>Cancelar</button><button className="btn btn-blue" disabled={busy || confirmar.texto.trim().length < 2} onClick={guardarConfirmacion}>Registrar confirmación</button></div>
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

function Validacion() {
  const { can, toast, confirmBox } = useApp();
  const per = usePeriod();
  const qs = per ? `?from=${per.start}&to=${per.end}` : '';
  const { data, err, loading, reload } = useLoad<Record<string, any[]>>(() => (qs ? api.get('/maquila/validacion' + qs) : Promise.resolve({})), [qs]);
  const [rechazo, setRechazo] = useState<any>(null);
  const [reapertura, setReapertura] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const etapas = [
    { key: 'SOP', label: 'Pendientes de SOP', perm: 'maquila.validar_sop' },
    { key: 'JEFATURA', label: 'Pendientes de jefatura', perm: 'maquila.validar_jefatura' },
    { key: 'VALIDADOR', label: 'Pendientes del validador', perm: 'maquila.validar' },
  ] as const;
  const ruta = (stage: string) => (stage === 'VALIDADOR' ? 'validar' : `validar-${stage.toLowerCase()}`);
  const aprobar = async (o: any, stage: string) => {
    const c = await confirmBox({ title: 'Aprobar validación', text: `${o.clientName} · ${o.productName || o.sap || 'sin producto'} · ${nfx(o.producedQty)} ${o.unit}.`, okLabel: 'Aprobar' });
    if (!c.ok) return;
    try { await api.post(`/maquila/ordenes/${o.id}/${ruta(stage)}`, { decision: 'APROBADA' }); toast('Validación aprobada.'); reload(); }
    catch (e: any) { toast(e.message, true); }
  };
  const rechazar = async () => {
    if (!rechazo) return;
    setBusy(true);
    try { await api.post(`/maquila/ordenes/${rechazo.o.id}/${ruta(rechazo.stage)}`, { decision: 'RECHAZADA', reason: rechazo.motivo }); toast('Maquila rechazada.'); setRechazo(null); reload(); }
    catch (e: any) { toast(e.message, true); } finally { setBusy(false); }
  };
  const reabrir = async () => {
    if (!reapertura) return;
    setBusy(true);
    try { await api.post(`/maquila/ordenes/${reapertura.o.id}/reabrir`, { reason: reapertura.motivo }); toast('Maquila reabierta.'); setReapertura(null); reload(); }
    catch (e: any) { toast(e.message, true); } finally { setBusy(false); }
  };
  const lista = (k: string) => data?.[k] ?? [];
  return (
    <>
      <Card title="Validación de maquilas" sub="Cada etapa deja su registro. El rechazo exige un motivo y devuelve la maquila al coordinador.">
        <Loading err={err} loading={loading && !data} />
        {etapas.map((e) => {
          const rows = lista(e.key);
          return (
            <div key={e.key} style={{ marginBottom: 20 }}>
              <h4>{e.label} <span className="muted">({rows.length})</span></h4>
              {!rows.length && <p className="muted">Sin pendientes.</p>}
              {rows.length > 0 && <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Fecha</th><th>Cliente / proyecto</th><th>Producto</th><th className="n">Producido</th><th>Estado</th><th /></tr></thead><tbody>
                {rows.map((o: any) => <tr key={o.id}>
                  <td>{fmtDate(o.date)}<div className="muted">{o.shift}</div></td>
                  <td><b>{o.clientName}</b><div className="muted">{proyecto(o)}</div></td>
                  <td>{o.sap && <span className="sap">{o.sap}</span>} {o.productName || '—'}</td>
                  <td className="n">{nfx(o.producedQty)} {o.unit}<Desglose o={o} /></td>
                  <td><Pill kind={est(o.status).k}>{est(o.status).l}</Pill></td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {can(e.perm) && <><button className="btn btn-sm btn-blue" onClick={() => aprobar(o, e.key)}>Aprobar</button>{' '}<button className="btn btn-sm btn-danger" onClick={() => setRechazo({ o, stage: e.key, motivo: '' })}>Rechazar</button></>}
                  </td>
                </tr>)}
              </tbody></table></div>}
            </div>
          );
        })}
        <h4>Rechazadas <span className="muted">({lista('RECHAZADA').length})</span></h4>
        {!lista('RECHAZADA').length && <p className="muted">Sin rechazos.</p>}
        {lista('RECHAZADA').length > 0 && <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Fecha</th><th>Cliente / proyecto</th><th>Producto</th><th>Estado</th><th /></tr></thead><tbody>
          {lista('RECHAZADA').map((o: any) => <tr key={o.id}><td>{fmtDate(o.date)}</td><td>{o.clientName} · {proyecto(o)}</td><td>{o.productName || o.sap || '—'}</td><td><Pill kind="bad">Rechazada</Pill></td><td>{can('maquila.editar') && <button className="btn btn-sm" onClick={() => setReapertura({ o, motivo: '' })}>Reabrir</button>}</td></tr>)}
        </tbody></table></div>}
      </Card>
      {rechazo && <Modal title="Rechazar maquila" onClose={() => setRechazo(null)}>
        <p className="muted">{rechazo.o.clientName} · {rechazo.o.productName || rechazo.o.sap || 'sin producto'}</p>
        <label>Motivo del rechazo (obligatorio)<textarea rows={3} value={rechazo.motivo} onChange={(e) => setRechazo({ ...rechazo, motivo: e.target.value })} autoFocus /></label>
        <div className="mact"><button className="btn" onClick={() => setRechazo(null)}>Cancelar</button><button className="btn btn-danger" disabled={busy || rechazo.motivo.trim().length < 5} onClick={rechazar}>Rechazar</button></div>
      </Modal>}
      {reapertura && <Modal title="Reabrir maquila" onClose={() => setReapertura(null)}>
        <p className="muted">Vuelve a «en proceso» para corregir y cerrar de nuevo. Explica el motivo.</p>
        <label>Motivo (obligatorio)<textarea rows={3} value={reapertura.motivo} onChange={(e) => setReapertura({ ...reapertura, motivo: e.target.value })} autoFocus /></label>
        <div className="mact"><button className="btn" onClick={() => setReapertura(null)}>Cancelar</button><button className="btn btn-blue" disabled={busy || reapertura.motivo.trim().length < 5} onClick={reabrir}>Reabrir</button></div>
      </Modal>}
    </>
  );
}

function Facturacion() {
  const { can, toast, confirmBox } = useApp();
  const per = usePeriod();
  const qs = per ? `?from=${per.start}&to=${per.end}&limit=500` : '';
  const { data: pend, err, loading, reload: reloadPend } = useLoad<any[]>(() => (qs ? api.get('/maquila/por-facturar' + qs) : Promise.resolve([])), [qs]);
  const { data: cargos, reload: reloadCargos } = useLoad<any[]>(() => api.get('/maquila/cargos?limit=200'), []);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [periodKind, setPeriodKind] = useState<'MES' | 'SEMANA' | 'DEMANDA'>('MES');
  const [periodKey, setPeriodKey] = useState(per?.month ?? '');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [anular, setAnular] = useState<any>(null);
  const [key, setKey] = useState(newKey);
  useEffect(() => { if (per?.month) setPeriodKey((k) => k || per.month); }, [per?.month]);
  const rows = pend ?? [];
  const selected = rows.filter((r) => sel.has(r.id));
  const clientId = selected.length ? selected[0].clientId : undefined;
  const mixed = selected.some((r) => r.clientId !== clientId);
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const crear = async () => {
    if (!selected.length) return toast('Selecciona al menos una maquila.', true);
    if (mixed) return toast('Todas las maquilas deben ser del mismo cliente.', true);
    setBusy(true);
    try {
      await api.post('/maquila/cargos', { clientId, periodKind, periodKey: periodKey.trim(), orderIds: selected.map((r) => r.id), notes: notes || undefined }, key);
      toast('Cargo creado.'); setSel(new Set()); setNotes(''); setKey(newKey()); reloadPend(); reloadCargos();
    } catch (e: any) { toast(e.message, true); } finally { setBusy(false); }
  };
  const cerrar = async (c: any) => {
    const r = await confirmBox({ title: 'Cerrar cargo', text: `Se congela el cargo de ${c.clientName} por ${q2(c.total)}.`, okLabel: 'Cerrar cargo' });
    if (!r.ok) return;
    try { await api.post(`/maquila/cargos/${c.id}/cerrar`); toast('Cargo cerrado.'); reloadCargos(); }
    catch (e: any) { toast(e.message, true); }
  };
  const anularCargo = async () => {
    if (!anular) return;
    setBusy(true);
    try { await api.post(`/maquila/cargos/${anular.c.id}/anular`, { reason: anular.motivo }); toast('Cargo anulado; las maquilas vuelven a por facturar.'); setAnular(null); reloadPend(); reloadCargos(); }
    catch (e: any) { toast(e.message, true); } finally { setBusy(false); }
  };
  return (
    <>
      <Card title="Maquilas validadas por facturar" sub={`${rows.length} disponibles`}>
        <p className="muted">Selecciona maquilas del mismo cliente. El importe sale de la tarifa vigente del proyecto; si falta, el cargo se rechaza y hay que definirla en Comercial › Tarifas.</p>
        <Loading err={err} loading={loading && !pend} />
        {!rows.length && <p className="muted">No hay maquilas validadas pendientes en este periodo.</p>}
        {rows.length > 0 && <>
          <div className="form" style={{ marginBottom: 10 }}>
            <div className="field"><label>Periodo</label><select value={periodKind} onChange={(e) => setPeriodKind(e.target.value as any)}><option value="MES">Mes</option><option value="SEMANA">Semana</option><option value="DEMANDA">Por demanda</option></select></div>
            <div className="field"><label>Clave</label><input value={periodKey} onChange={(e) => setPeriodKey(e.target.value)} placeholder={periodKind === 'MES' ? '2026-10' : '2026-10-05'} /></div>
            <div className="field w2"><label>Observación</label><input value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
            <div className="factions"><button className="btn btn-blue" disabled={busy || !selected.length || mixed || !periodKey.trim()} onClick={crear}>Crear cargo ({selected.length})</button></div>
          </div>
          {mixed && <div className="note">La selección mezcla clientes: un cargo solo puede ser de uno.</div>}
          <div className="tbl-wrap"><table className="tbl"><thead><tr><th></th><th>Fecha</th><th>Cliente</th><th>Proyecto</th><th>Producto</th><th className="n">Cantidad</th><th>Validada</th></tr></thead><tbody>
            {rows.map((r) => <tr key={r.id}><td><input type="checkbox" aria-label={`Seleccionar ${r.id}`} checked={sel.has(r.id)} onChange={() => toggle(r.id)} /></td><td>{fmtDate(r.date)}</td><td>{r.clientName}</td><td>{proyecto(r)}</td><td>{r.sap && <span className="sap">{r.sap}</span>} {r.productName || '—'}</td><td className="n">{nfx(r.producedQty)} {r.unit}<Desglose o={r} /></td><td>{r.validatedAt ? fmtDT(r.validatedAt) : '—'}</td></tr>)}
          </tbody></table></div>
        </>}
      </Card>
      <Card title="Cargos" sub={`${(cargos ?? []).length} cargos`}>
        {!(cargos ?? []).length && <p className="muted">Sin cargos registrados.</p>}
        {(cargos ?? []).length > 0 && <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Cargo</th><th>Cliente</th><th>Periodo</th><th className="n">Maquilas</th><th className="n">Total</th><th>Estado</th><th /></tr></thead><tbody>
          {(cargos ?? []).map((c) => <tr key={c.id}>
            <td><code>{c.id.slice(0, 8)}</code><div className="muted">{fmtDT(c.createdAt)}</div></td>
            <td>{c.clientName}</td><td>{c.periodKind} · {c.periodKey}</td><td className="n">{c.lines}</td><td className="n">{q2(c.total)}</td>
            <td><Pill kind={c.status === 'ABIERTO' ? 'warn' : c.status === 'CERRADO' ? 'ok' : c.status === 'ANULADO' ? 'bad' : 'blue'}>{c.status}</Pill>{c.voidReason && <div className="muted">{c.voidReason}</div>}</td>
            <td style={{ whiteSpace: 'nowrap' }}>
              {c.status === 'ABIERTO' && can('maquila.agrupar') && <button className="btn btn-sm btn-blue" onClick={() => cerrar(c)}>Cerrar</button>}{' '}
              {c.status !== 'ANULADO' && c.status !== 'FACTURADO' && c.status !== 'COBRADO' && can('maquila.anular') && <button className="btn btn-sm btn-danger" onClick={() => setAnular({ c, motivo: '' })}>Anular</button>}
            </td>
          </tr>)}
        </tbody></table></div>}
        <p className="muted">El número de factura se genera en el módulo comercial compartido (fase de integración con Transportes).</p>
      </Card>
      {anular && <Modal title="Anular cargo" onClose={() => setAnular(null)}>
        <p className="muted">{anular.c.clientName} · {anular.c.periodKind} {anular.c.periodKey} · {q2(anular.c.total)}</p>
        <label>Motivo (obligatorio)<textarea rows={3} value={anular.motivo} onChange={(e) => setAnular({ ...anular, motivo: e.target.value })} autoFocus /></label>
        <div className="mact"><button className="btn" onClick={() => setAnular(null)}>Cancelar</button><button className="btn btn-danger" disabled={busy || anular.motivo.trim().length < 5} onClick={anularCargo}>Anular cargo</button></div>
      </Modal>}
    </>
  );
}
