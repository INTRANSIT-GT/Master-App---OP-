import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ApiError } from './api';
import { addMonth, monthLabel } from './format';
import { useApp } from './store';

/** Carga datos del API y los recarga cuando cambia el mes o se pide refrescar. */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[]) {
  const { refreshKey } = useApp();
  const [data, setData] = useState<T | null>(null), [err, setErr] = useState<string | null>(null), [loading, setLoading] = useState(true);
  const seq = useRef(0), fnRef = useRef(fn); fnRef.current = fn;
  const reload = useCallback(() => {
    const n = ++seq.current; setLoading(true);
    fnRef.current().then((d) => { if (n === seq.current) { setData(d); setErr(null); } }).catch((e) => { if (n === seq.current) setErr(e instanceof ApiError ? e.message : String(e)); }).finally(() => { if (n === seq.current) setLoading(false); });
  }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(reload, [...deps, refreshKey]);
  return { data, err, loading, reload };
}
export function Loading({ err, loading }: { err: string | null; loading: boolean }) {
  if (err) return <div className="errline" role="alert">{err}</div>;
  return loading ? <p className="muted" role="status">Cargando…</p> : null;
}
export function Card({ title, sub, children, actions }: { title?: ReactNode; sub?: ReactNode; children: ReactNode; actions?: ReactNode }) {
  return <section className="card">{(title || actions) && <div className="card-head"><h3>{title}</h3>{sub && <p>{sub}</p>}{actions}</div>}{children}</section>;
}
export const Pill = ({ kind = 'gray', children, title }: { kind?: 'warn' | 'ok' | 'bad' | 'blue' | 'gray'; children: ReactNode; title?: string }) => <span className={'pill p-' + kind} title={title}>{children}</span>;
export const StatusPill = ({ s }: { s: string }) => s === 'borrador' ? <Pill kind="warn">Borrador</Pill> : s === 'anulado' ? <Pill kind="bad">Anulado</Pill> : <Pill kind="ok">Confirmado</Pill>;

export function Field({ label, children, w, hint }: { label: string; children: ReactNode; w?: 2 | 3; hint?: string }) {
  return <div className={'field' + (w ? ' w' + w : '')}><label>{label}{children}</label>{hint && <small>{hint}</small>}</div>;
}
export function Tabs<T extends string>({ items, value, onChange, sub }: { items: [T, string][]; value: T; onChange: (v: T) => void; sub?: boolean }) {
  return <div className={sub ? 'subtabs' : 'tabs'} role="tablist">{items.map(([k, n]) => <button key={k} role="tab" className={sub ? 'stab' : 'tab'} aria-selected={k === value} onClick={() => onChange(k)}>{n}</button>)}</div>;
}
export function MonthBar({ status, weeks, extra }: { status?: string; weeks?: string; extra?: ReactNode }) {
  const { month, setMonth, meta } = useApp();
  const first = meta?.inicio.slice(0, 7) ?? '2026-10';
  const opts: string[] = []; for (let m = first; m <= addMonth(meta?.defaultMonth ?? month, 1) || opts.length < 1; m = addMonth(m, 1)) { opts.push(m); if (opts.length > 60) break; }
  if (!opts.includes(month) && month) opts.push(month);
  return (
    <div className="pbar">
      <button className="btn btn-icon" aria-label="Mes anterior" disabled={month <= first} onClick={() => setMonth(addMonth(month, -1))}>‹</button>
      <select className="mon-sel" aria-label="Mes" value={month} onChange={(e) => setMonth(e.target.value)}>{opts.sort().map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}</select>
      <button className="btn btn-icon" aria-label="Mes siguiente" onClick={() => setMonth(addMonth(month, 1))}>›</button>
      {weeks && <span className="psub">{weeks}</span>}
      {status === 'cerrado' && <span className="pill p-blue" title="Las cifras están congeladas y los registros no se pueden modificar">Periodo cerrado</span>}
      {extra}
    </div>
  );
}
/** Filtro por semana del mes (vacío = todo el mes). Lo usa Comercial. */
export function WeekFilter({ weeks }: { weeks?: { monday: string; week: number }[] }) {
  const { week, setWeek } = useApp();
  if (!weeks?.length) return null;
  return (
    <label className="wkf"><span>Semana</span>
      <select aria-label="Filtrar por semana" value={week} onChange={(e) => setWeek(e.target.value)}>
        <option value="">Todo el mes</option>
        {weeks.map((w) => <option key={w.monday} value={w.monday}>Semana {w.week} · {w.monday.slice(8)}/{w.monday.slice(5, 7)}</option>)}
      </select>
    </label>
  );
}
export function Empty({ title, text }: { title: string; text?: string }) { return <div className="card empty"><h3>{title}</h3>{text && <p>{text}</p>}</div>; }
export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  return <div className="modal-bg" role="dialog" aria-modal="true" aria-label={title} onKeyDown={(e) => e.key === 'Escape' && onClose()}><div className={'modal' + (wide ? ' wide' : '')}><h3>{title}</h3>{children}</div></div>;
}
