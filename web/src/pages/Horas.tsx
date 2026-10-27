import { useMemo, useState } from 'react';
import { api } from '../api';
import { Card, Loading, MonthBar, Tabs, useLoad } from '../components';
import { fmtDate, nf2, nfx, pf } from '../format';
import { D, RecordsPanel, usePeriod, type Col, type FieldDef } from '../records-ui';
import { useApp } from '../store';

export default function Horas() {
  const [tab, setTab] = useState<'grid' | 'maqp'>('maqp');
  const { data: cat } = useLoad<any>(() => api.get('/catalogo'), []);
  const projects: any[] = cat?.projects ?? [], clients: any[] = cat?.clients ?? [];
  const label = (id: string) => { const p = projects.find((x) => x.id === id); return p ? `${clients.find((c) => c.id === p.clientId)?.name ?? ''} · ${p.name}` : ''; };
  const fields: FieldDef[] = [
    { k: 'date', label: 'Fecha', type: 'date', required: true },
    { k: 'projectId', label: 'Cliente · proyecto', type: 'select', w: 2, options: projects.filter((p) => p.active).map((p) => [p.id, label(p.id)] as [string, string]) },
    { k: 'workerName', label: 'Personal / cuadrilla', type: 'text', w: 2 }, { k: 'hoursDay', label: 'Horas diurnas (total)', type: 'num' }, { k: 'hoursNight', label: 'Horas nocturnas (total)', type: 'num' }, { k: 'notes', label: 'Observación', type: 'text', w: 2 },
  ];
  const cols: Col[] = [{ h: 'Fecha', cell: D }, { h: 'Cliente · proyecto', cell: (r) => label(r.projectId) }, { h: 'Personal', cell: (r) => r.workerName }, { h: 'H día', n: true, cell: (r) => nfx(r.hoursDay) }, { h: 'H noche', n: true, cell: (r) => nfx(r.hoursNight) }, { h: 'Total', n: true, cell: (r) => nfx(r.hoursDay + r.hoursNight) }];
  return (
    <>
      <MonthBar />
      <Tabs sub value={tab} onChange={setTab} items={[['maqp', 'Personal de maquila'], ['grid', 'Impresión y asistencia']]} />
      {tab === 'grid' ? <WeekGrid /> : <>
        <p className="note">Aquí se captura el <b>personal de maquila</b>: como se trabaja por metas, las horas son informativas. Pendiente: catálogo de a cuántas horas equivale la productividad (se cargará después y se conectará al cálculo). No suman a las HH del resumen del mes.</p>
        <RecordsPanel key="maqp" title="Personal de maquila" path="horas" fixed={{ kind: 'maqp' }} query="kind=maqp" fields={fields} columns={cols} createPerm="registro.crear" hint="Horas del personal por día y proyecto" />
      </>}
    </>
  );
}

const DAYS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
function WeekGrid() {
  const { toast, can, refresh, confirmBox, month } = useApp();
  const per = usePeriod();
  const [monday, setMonday] = useState<string | null>(null);
  const { data: res } = useLoad<any>(() => (month ? api.get('/resultados?mes=' + month) : Promise.resolve(null)), [month]);
  const weeks: { monday: string; week: number }[] = res?.results.period.weeks ?? [];
  const m0 = monday && weeks.some((w) => w.monday === monday) ? monday : weeks.at(-1)?.monday ?? weeks[0]?.monday;
  const wi = weeks.findIndex((w) => w.monday === m0);
  const dayIso = (i: number) => new Date(Date.parse(m0 ?? '') + i * 864e5).toISOString().slice(0, 10);
  const range = m0 ? `from=${m0}&to=${dayIso(6)}` : '';
  const { data: hrs, err, loading, reload } = useLoad<any>(() => (m0 ? Promise.all([api.get(`/horas?kind=imp&${range}&status=confirmado`), api.get(`/asistencia?from=${m0}&to=${m0}`)]) : Promise.resolve(null)), [m0]);
  const existing = useMemo(() => { const o: Record<string, any> = {}; for (const r of hrs?.[0].rows ?? []) o['imp' + r.recordDate] = r; return o; }, [hrs]);
  const [edits, setEdits] = useState<Record<string, string>>({}), [asis, setAsis] = useState<string | null>(null), [busy, setBusy] = useState(false);
  const closed = per?.status === 'cerrado', editable = can('registro.crear') && !closed;
  const val = (k: string, i: number) => { const key = k + dayIso(i); return key in edits ? edits[key] : existing[key] ? String(existing[key].hoursDay) : ''; };
  const dirty = Object.keys(edits).length > 0 || asis !== null;
  const rep = res?.results.wHH[wi] ?? 0, asisSaved = hrs?.[1][0]?.paidHours ?? 0, asisNow = asis !== null ? +asis || 0 : asisSaved;

  const save = async () => {
    setBusy(true);
    try {
      const changes = Object.entries(edits).map(([key, v]) => ({ kind: 'imp' as const, date: key.slice(key.indexOf('20')), v, cur: existing[key] })).filter((c) => (c.cur ? String(c.cur.hoursDay) : '') !== c.v);
      const touchesConfirmed = changes.some((c) => c.cur);
      let reason: string | undefined;
      if (touchesConfirmed) { const r = await confirmBox({ title: 'Motivo del cambio', text: 'Estás modificando horas ya confirmadas; queda en la bitácora.', reason: true, okLabel: 'Guardar' }); if (!r.ok) return; reason = r.reason; }
      for (const c of changes) {
        const n = c.v === '' ? 0 : Number(c.v);
        if (c.cur && (n === 0 || c.v === '')) await api.post(`/horas/${c.cur.id}/anular`, { reason: reason ?? 'Horas en cero' });
        else if (c.cur) await api.patch(`/horas/${c.cur.id}`, { version: c.cur.version, hoursDay: n, reason });
        else if (n > 0) await api.post('/horas', { kind: c.kind, date: c.date, hoursDay: n }, `${c.kind}-${c.date}-${n}`);
      }
      if (asis !== null && asis !== '') await api.put(`/asistencia/${m0}`, { paidHours: Number(asis) });
      toast('Horas guardadas.'); setEdits({}); setAsis(null); reload(); refresh();
    } catch (e: any) { toast(e.message, true); } finally { setBusy(false); }
  };
  return (
    <Card title="Horas capturadas por día" sub="Impresión de etiquetas y asistencia semanal (horas pagadas)">
      <div className="subtabs">{weeks.map((w) => <button key={w.monday} className="stab" aria-selected={w.monday === m0} onClick={() => { setMonday(w.monday); setEdits({}); setAsis(null); }}>Semana {w.week} <span className="muted">{fmtDate(w.monday).slice(0, 5)}</span></button>)}</div>
      <Loading err={err} loading={loading && !hrs} />
      {hrs && <>
        <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Horas</th>{DAYS.map((d, i) => <th key={d} className="n">{d} {+dayIso(i).slice(8)}</th>)}<th className="n">Semana</th></tr></thead><tbody>
          {([['imp', 'Impresión de etiquetas']] as const).map(([k, n]) => (
            <tr key={k}><td><b>{n}</b></td>{DAYS.map((d, i) => <td key={d} className="n"><input className="num" style={{ width: 64 }} type="number" min={0} max={24} step={0.5} disabled={!editable} aria-label={`${n} ${d}`} value={val(k, i)} onChange={(e) => setEdits({ ...edits, [k + dayIso(i)]: e.target.value })} /></td>)}
              <td className="n"><b>{nfx(DAYS.reduce((a, _, i) => a + (+val(k, i) || 0), 0))}</b></td></tr>))}
        </tbody></table></div>
        <div style={{ display: 'flex', gap: 16, alignItems: 'end', flexWrap: 'wrap', marginTop: 12 }}>
          <div className="field" style={{ maxWidth: 220 }}><label htmlFor="asis">Asistencia de la semana (horas pagadas)</label><input id="asis" type="number" min={0} step={0.5} disabled={!can('registro.editar') || closed} value={asis ?? (asisSaved || '')} onChange={(e) => setAsis(e.target.value)} /></div>
          <div>Reportado en estatus: <b>{nf2(rep)} HH</b>{asisNow > 0 ? <> · Eficiencia <b className={rep < asisNow ? 'neg' : ''}>{pf(rep / asisNow)}</b>{rep < asisNow && <> · se pagan {nf2(asisNow - rep)} h más de las que se cobran</>}</> : <> · Eficiencia <span className="nd">N/D</span> (falta asistencia)</>}</div>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}><button className="btn btn-blue" disabled={!dirty || busy || closed} onClick={save}>{busy ? 'Guardando…' : 'Guardar semana'}</button></div>
        </div>
        {closed && <p className="note" style={{ marginTop: 10 }}>Periodo cerrado: solo lectura.</p>}
      </>}
    </Card>
  );
}
