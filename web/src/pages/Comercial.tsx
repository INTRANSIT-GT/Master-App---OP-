import { useState } from 'react';
import { api } from '../api';
import { Card, Loading, MonthBar, Tabs, WeekFilter, useLoad } from '../components';
import { fmtDate, nfx, q2 } from '../format';
import { useApp } from '../store';

export default function Comercial() {
  const [tab, setTab] = useState<'cobro' | 'tarifas'>('cobro');
  return (
    <>
      <Tabs sub value={tab} onChange={setTab} items={[['cobro', 'Reporte de cobro'], ['tarifas', 'Tarifas por cliente']]} />
      {tab === 'cobro' ? <Cobro /> : <Tarifas />}
    </>
  );
}

function Cobro() {
  const { month, week, toast } = useApp();
  const [clientId, setClientId] = useState('');
  const { data: wk } = useLoad<any>(() => (month ? api.get('/resumen?mes=' + month) : Promise.resolve(null)), [month]);
  const qs = month ? (week ? `semana=${week}` : `mes=${month}`) + (clientId ? `&clientId=${clientId}` : '') : '';
  const { data, err, loading } = useLoad<any>(() => (qs ? api.get('/comercial/cobro?' + qs) : Promise.resolve(null)), [qs]);
  const { data: cl } = useLoad<any>(() => api.get('/catalogo'), []);
  return (
    <>
      <MonthBar extra={<>
        <WeekFilter weeks={wk?.period?.weeks} />
        <label className="wkf"><span>Cliente</span><select aria-label="Cliente" value={clientId} onChange={(e) => setClientId(e.target.value)}><option value="">Todos</option>{(cl?.clients ?? []).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <button className="btn btn-primary" disabled={!qs} onClick={() => api.download('/comercial/cobro/excel?' + qs, `Cobro_${week || month}.xlsx`).catch((e) => toast(e.message, true))}>Descargar Excel</button>
      </>} />
      <Loading err={err} loading={loading && !data} />
      {data && <>
        <div className="tiles"><div className="tile"><div className="nm">Total a cobrar · {data.label}</div><div className="sv">{q2(data.total)}</div><small>Importes en quetzales</small></div>
          <div className={"tile " + (data.pendientes ? "warn" : "")}><div className="nm">Filas sin tarifa</div><div className="sv">{data.pendientes}</div><small>No suman hasta definir la tarifa</small></div></div>
        {!data.clients.length && <p className="muted">Sin producción confirmada en este periodo.</p>}
        {data.clients.map((c: any) => (
          <Card key={c.id} title={c.name} sub={`${fmtDate(data.desde)} al ${fmtDate(data.hasta)}`} actions={<b>{q2(c.total)}</b>}>
            <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Proyecto</th><th>Detalle</th><th>U/M</th><th className="n">Producido</th><th className="n">Cantidad a cobrar</th><th className="n">Tarifa</th><th className="n">Monto Q</th></tr></thead><tbody>
              {c.rows.map((r: any, i: number) => <tr key={i}><td>{r.project}</td><td>{r.detail}</td><td>{r.unit}</td><td className="n">{nfx(r.qty)}</td><td className="n">{nfx(r.billableQty)}</td><td className="n">{r.rate == null ? 'N/D' : q2(r.rate)}</td><td className="n">{r.amount == null ? <span className="pill p-warn" title={r.issues.join('; ')}>sin tarifa</span> : q2(r.amount)}</td></tr>)}
            </tbody></table></div>
          </Card>))}
        <p className="muted">{data.nota}</p>
      </>}
    </>
  );
}

function Tarifas() {
  const { can, toast, meta } = useApp();
  const { data, err, loading, reload } = useLoad<any>(() => api.get('/comercial/tarifas'), []);
  const [f, setF] = useState({ projectId: '', rate: '', unit: '', validFrom: meta?.today ?? '', note: '' });
  const save = async () => {
    try { await api.post('/comercial/tarifas', { ...f, rate: +f.rate, note: f.note || undefined }); toast('Tarifa registrada.'); setF({ ...f, rate: '', note: '' }); reload(); } catch (e: any) { toast(e.message, true); }
  };
  const pName = (id: string) => data?.projects.find((p: any) => p.id === id);
  return (
    <>
      <Loading err={err} loading={loading && !data} />
      {data && <>
        {can('comercial.tarifas') && <Card title="Nueva tarifa" sub="Una nueva tarifa cierra la anterior del proyecto; aplica por fecha del registro.">
          <div className="form">
            <div className="field w2"><label htmlFor="t-p">Proyecto</label><select id="t-p" value={f.projectId} onChange={(e) => { const p = pName(e.target.value); setF({ ...f, projectId: e.target.value, unit: p?.um ?? f.unit }); }}><option value="">Selecciona…</option>{data.projects.filter((p: any) => !p.motor).map((p: any) => <option key={p.id} value={p.id}>{p.client} · {p.name}</option>)}</select></div>
            <div className="field"><label htmlFor="t-r">Tarifa (Q)</label><input id="t-r" type="number" min={0} step="any" value={f.rate} onChange={(e) => setF({ ...f, rate: e.target.value })} /></div>
            <div className="field"><label htmlFor="t-u">Unidad</label><input id="t-u" value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })} /></div>
            <div className="field"><label htmlFor="t-d">Vigente desde</label><input id="t-d" type="date" value={f.validFrom} onChange={(e) => setF({ ...f, validFrom: e.target.value })} /></div>
            <div className="field w2"><label htmlFor="t-n">Nota</label><input id="t-n" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></div>
            <div className="field"><button className="btn btn-primary" disabled={!f.projectId || !f.rate || !f.unit} onClick={save}>Registrar tarifa</button></div>
          </div>
        </Card>}
        <Card title="Tarifas vigentes e historial" sub={data.nota}>
          <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Cliente</th><th>Proyecto</th><th className="n">Tarifa</th><th>Unidad</th><th>Desde</th><th>Hasta</th><th>Nota</th></tr></thead><tbody>
            {data.rates.map((r: any) => { const p = pName(r.projectId); return <tr key={r.id}><td>{p?.client}</td><td>{p?.name}</td><td className="n">{q2(r.rate)}</td><td>{r.unit}</td><td>{fmtDate(r.validFrom)}</td><td>{r.validTo ? fmtDate(r.validTo) : 'vigente'}</td><td>{r.note}</td></tr>; })}
            {!data.rates.length && <tr><td colSpan={7} className="muted">Aún no hay tarifas registradas.</td></tr>}
          </tbody></table></div>
        </Card>
        <Card title="Fritolay (desde Estándares)" sub="Se editan en Ajustes → Estándares de costo.">
          <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Línea</th><th>Proyecto</th><th className="n">Tarifa vigente</th></tr></thead><tbody>
            {data.motor.map((m: any) => <tr key={m.key}><td>{m.name}</td><td>{m.project}</td><td className="n">{m.rate == null ? 'N/D' : q2(m.rate)}</td></tr>)}
          </tbody></table></div>
        </Card>
      </>}
    </>
  );
}
