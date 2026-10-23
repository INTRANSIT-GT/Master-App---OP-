import { api } from '../api';
import { Card, Empty, Loading, MonthBar, Pill, WeekFilter, useLoad } from '../components';
import { nf2, nfx, q2 } from '../format';
import { useApp } from '../store';
import PeriodControls from './PeriodControls';

export default function Resumen() {
  const { month, week } = useApp();
  const { data, err, loading } = useLoad<any>(() => (month ? api.get('/resumen?mes=' + month + (week ? '&semana=' + week : '')) : Promise.resolve(null)), [month, week]);
  const R = data?.resumen;
  const mg = (v: number | null) => (v == null ? <span className="nd" title="Datos insuficientes: falta costo u horas">N/D</span> : q2(v));
  return (
    <>
      <MonthBar status={data?.status} extra={<><WeekFilter weeks={data?.weeks} /><PeriodControls /></>} />
      {data && <p className="muted" style={{ margin: '0 0 8px' }}>Mostrando: <b>{data.period.title}</b> · HH {nf2(data.weekly.HH)} · asistencia {data.weekly.asis ? nf2(data.weekly.asis) : 'N/D'} · eficiencia {data.weekly.eff == null ? 'N/D' : Math.round(data.weekly.eff * 1000) / 10 + ' %'}</p>}
      <Loading err={err} loading={loading && !data} />
      {R && !R.list.length && <Empty title={`Sin datos en ${month}`} text="Captura la producción del mes o importa los estatus." />}
      {R && R.list.length > 0 && <>
        <Card title="Margen por proceso" sub="Margen = costo neto ÷ horas hombre · N/D cuando no hay costo u horas">
          <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Proceso</th><th className="n">Costo Q</th><th className="n">Requerimientos</th><th className="n">Etiqueta / bolsa</th><th className="n">Costo neto</th><th className="n">HH</th><th className="n">Margen</th></tr></thead><tbody>
            {R.list.map((o: any) => <tr key={o.g}><td><a href={'#sec-' + o.g}>{o.name}</a></td><td className="n">{o.cost ? q2(o.cost) : '—'}</td><td className={'n ' + (o.req ? 'neg' : '')}>{o.req ? '−' + q2(o.req) : '—'}</td><td className={'n ' + (o.mat ? 'neg' : '')}>{o.mat ? '−' + q2(o.mat) : '—'}</td><td className="n"><b>{o.cost || o.req || o.mat ? q2(o.net) : '—'}</b></td><td className="n">{nf2(o.hh)}</td><td className="n"><b>{mg(o.mg)}</b></td></tr>)}
            {R.T.gen > 0 && <tr><td>Requerimientos generales</td><td /><td className="n neg">−{q2(R.T.gen)}</td><td /><td className="n">−{q2(R.T.gen)}</td><td /><td /></tr>}
          </tbody><tfoot><tr><td>Total</td><td className="n">{q2(R.T.cost)}</td><td className="n">{R.T.req + R.T.gen ? '−' + q2(R.T.req + R.T.gen) : '—'}</td><td className="n">{R.T.mat ? '−' + q2(R.T.mat) : '—'}</td><td className="n">{q2(R.T.net)}</td><td className="n">{nf2(R.T.hh)}</td><td className="n">{mg(R.T.mg)}</td></tr></tfoot></table></div>
        </Card>
        {R.list.map((o: any) => (
          <section className="card" id={'sec-' + o.g} key={o.g}>
            <div className="card-head"><h3>{o.name}</h3><p>HH <b>{nf2(o.hh)}</b> · Costo neto <b>{o.cost || o.req || o.mat ? q2(o.net) : '—'}</b> · Margen <b>{mg(o.mg)}</b></p></div>
            <div className="tbl-wrap"><table className="tbl"><thead><tr><th className="n">Costo unitario</th><th>Línea</th><th>U/M</th>{data.period.weeks.map((w: any) => <th key={w.monday} className="n">Sem {w.week}</th>)}<th className="n">Total</th><th className="n">HH</th><th className="n">Costo Q</th></tr></thead><tbody>
              {o.lines.map((x: any) => { const cb = !!x.billableLabel, man = x.mode === 'man' || x.mode === 'hrs'; return (
                <tr key={x.k}><td className="n">{man ? '' : x.rate != null ? nf2(x.rate) : <Pill kind="warn">Sin costo</Pill>}</td>
                  <td>{x.k.startsWith('m:') && <span className="sap">{x.k.slice(2)}</span>} {x.name}{cb && <><br /><span className="muted">{x.k === 'crk' ? `${nfx(x.q)} cajas (buenas y malas) para horas · se cobran solo las buenas` : `${nfx(x.q)} unidades · se cobra por caja de cobro`}</span></>}</td>
                  <td>{cb ? x.billableLabel.toUpperCase() : x.um}</td>{(cb ? x.wb : x.wq).map((v: number, i: number) => <td key={i} className="n">{v ? nfx(v) : ''}</td>)}<td className="n"><b>{nfx(cb ? x.b : x.q)}</b></td><td className="n">{nf2(x.hh)}</td><td className="n">{x.rate != null ? q2(x.cost) : man ? '' : <Pill kind="warn">Sin costo</Pill>}</td></tr>); })}
              <tr><td /><td colSpan={data.period.weeks.length + 4}>Costo Q</td><td className="n"><b>{q2(o.cost)}</b></td></tr>
              {o.req > 0 && <tr><td /><td colSpan={data.period.weeks.length + 4}>− Requerimientos del proceso</td><td className="n neg">−{q2(o.req)}</td></tr>}
              {o.mat > 0 && <tr><td /><td colSpan={data.period.weeks.length + 4}>− {o.g === 'maq' ? 'Bolsa consumida' : 'Etiqueta y ribbon consumidos'}</td><td className="n neg">−{q2(o.mat)}</td></tr>}
              <tr><td /><td colSpan={data.period.weeks.length + 4}><b>Costo neto</b> ÷ {nf2(o.hh)} HH = <b>margen {mg(o.mg)}</b></td><td className="n"><b>{q2(o.net)}</b></td></tr>
            </tbody></table></div>
          </section>))}
      </>}
    </>
  );
}
