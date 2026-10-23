import { api } from '../api';
import { Card, Loading, MonthBar, Pill, WeekFilter, useLoad } from '../components';
import { fmtDT, nf, nf1, pf, q2 } from '../format';
import { useApp } from '../store';

export default function Dashboard({ go }: { go: (t: any) => void }) {
  const { month, week, setWeek } = useApp();
  const { data: d, err, loading } = useLoad<any>(() => (month ? api.get('/dashboard?mes=' + month + (week ? '&semana=' + week : '')) : Promise.resolve(null)), [month, week]);
  const max = Math.max(1, ...(d?.weekly ?? []).flatMap((w: any) => [w.hh, w.asistencia ?? 0]));
  return (
    <>
      <MonthBar status={d?.status} extra={<WeekFilter weeks={d?.weekly} />} />
      <Loading err={err} loading={loading && !d} />
      {d && <>
        <div className="kpis">
          <div className="kpi copper"><small>Horas hombre reportadas</small><b>{nf1(d.kpi.hh)}</b></div>
          <div className="kpi"><small>Asistencia (horas pagadas)</small><b>{d.kpi.asistencia ? nf1(d.kpi.asistencia) : 'N/D'}</b></div>
          <div className="kpi"><small>Eficiencia</small><b className={d.kpi.eficiencia != null && d.kpi.eficiencia < 1 ? 'neg' : ''}>{pf(d.kpi.eficiencia)}</b><span className="sub">reportado ÷ asistencia</span></div>
          <div className="kpi"><small>Costo Q</small><b>{q2(d.kpi.costo)}</b></div>
          <div className="kpi"><small>Costo neto</small><b>{q2(d.kpi.costoNeto)}</b><span className="sub">tras requerimientos y materiales</span></div>
          <div className="kpi copper"><small>Margen por HH</small><b>{q2(d.kpi.margen)}</b></div>
        </div>
        <div className="grid g2">
          <Card title="HH reportadas vs. asistencia por semana" sub={d.title + (week ? ' (filtrado por semana; clic de nuevo para ver todo el mes)' : '')}>
            <div className="bars" role="img" aria-label="Barras de horas reportadas y horas pagadas por semana">
              {d.weekly.map((w: any) => (
                <div className={'bargrp' + (w.monday === week ? ' sel' : '')} key={w.week} onClick={() => setWeek(w.monday === week ? '' : w.monday)} style={{ cursor: 'pointer' }} title="Clic para filtrar por esta semana">
                  <div className="pair"><div className="bar" style={{ height: (w.hh / max) * 100 + '%' }} title={`HH ${nf1(w.hh)}`} /><div className="bar b2" style={{ height: ((w.asistencia ?? 0) / max) * 100 + '%' }} title={`Asistencia ${w.asistencia ? nf1(w.asistencia) : 'N/D'}`} /></div>
                  <div className="lbl">Sem {w.week}</div><div className="val">{pf(w.eficiencia)}</div>
                </div>))}
            </div>
            <div className="legend"><span><i style={{ background: 'var(--accent)' }} />HH reportadas</span><span><i style={{ background: 'var(--copper)' }} />Asistencia</span><span>% = eficiencia (N/D sin asistencia)</span></div>
          </Card>
          <Card title="Pendientes" sub={`${d.counts.produccion} registros de producción · ${d.counts.horas} de horas`}>
            {d.pendientes.length ? <ul style={{ margin: 0, paddingLeft: 18 }}>{d.pendientes.map((p: string) => <li key={p}>{p}</li>)}</ul> : <p className="muted">Sin pendientes de datos en este mes.</p>}
          </Card>
        </div>
        <div className="grid g2" style={{ marginTop: 12 }}>
          <Card title="Margen por proceso" actions={<button className="btn btn-sm" onClick={() => go('sum')}>Ver resumen</button>}>
            <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Proceso</th><th className="n">Costo neto</th><th className="n">HH</th><th className="n">Margen</th></tr></thead><tbody>
              {d.sections.map((s: any) => <tr key={s.g}><td>{s.name}</td><td className="n">{q2(s.net)}</td><td className="n">{nf1(s.hh)}</td><td className="n"><b className={s.mg == null ? 'nd' : ''}>{q2(s.mg)}</b></td></tr>)}
            </tbody></table></div>
          </Card>
          <Card title="Inventario: alertas" actions={<button className="btn btn-sm" onClick={() => go('inv')}>Ver inventario</button>} sub={`${d.stockAlerts.length} de ${d.stockTotal} artículos`}>
            {d.stockAlerts.length ? <table className="tbl"><tbody>{d.stockAlerts.map((s: any) => <tr key={s.id}><td>{s.name}</td><td className="n">{nf(s.stock)}</td><td className="n">{s.level === 'negativo' ? <Pill kind="bad">Negativo</Pill> : <Pill kind="warn">~{Math.floor(s.daysCover ?? 0)} días</Pill>}</td></tr>)}</tbody></table> : <p className="muted">Todo el inventario alcanza para 2 semanas o más.</p>}
          </Card>
        </div>
        <Card title="Actividad reciente">
          <table className="tbl"><tbody>{d.recent.map((r: any, i: number) => <tr key={i}><td>{fmtDT(r.at)}</td><td>{r.user_email ?? 'sistema'}</td><td>{r.action}</td><td>{r.entity}</td></tr>)}</tbody></table>
        </Card>
      </>}
    </>
  );
}
