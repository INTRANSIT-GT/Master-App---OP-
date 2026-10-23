import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, ApiError, newKey } from './api';
import { Card, Field, Loading, Modal, StatusPill, useLoad } from './components';
import { fmtDate } from './format';
import { useApp } from './store';

export interface FieldDef { k: string; label: string; type: 'date' | 'text' | 'num' | 'int' | 'select' | 'textarea'; options?: [string, string][]; list?: string; w?: 2 | 3; hint?: string; required?: boolean; readOnly?: boolean; step?: string; onChange?: (v: string, set: (k: string, v: string) => void) => void }
export interface Col { h: string; n?: boolean; cell: (r: any) => ReactNode }

export function usePeriod() {
  const { month } = useApp();
  const { data } = useLoad<any[]>(() => api.get('/periodos'), []);
  return data?.find((p) => p.month === month) as undefined | { month: string; start: string; end: string; status: string; weekFrom: number; weekTo: number };
}
export function useDefaultDate() {
  const { meta } = useApp(); const p = usePeriod();
  if (!meta || !p) return meta?.today ?? '';
  return meta.today < p.start ? p.start : meta.today > p.end ? p.end : meta.today;
}

export function RecordForm({ fields, initial, onSubmit, submitLabel, busy }: { fields: FieldDef[]; initial: Record<string, any>; onSubmit: (v: Record<string, any>) => void; submitLabel: string; busy?: boolean }) {
  const [v, setV] = useState<Record<string, string>>(() => Object.fromEntries(fields.map((f) => [f.k, initial[f.k] == null ? '' : String(initial[f.k])])));
  useEffect(() => { setV(Object.fromEntries(fields.map((f) => [f.k, initial[f.k] == null ? '' : String(initial[f.k])]))); /* eslint-disable-next-line */ }, [JSON.stringify(initial), fields.map((f) => f.k).join()]);
  const set = (k: string, val: string) => setV((s) => ({ ...s, [k]: val }));
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const out: Record<string, any> = {};
    for (const f of fields) { const raw = v[f.k]; if (raw === '' || raw == null) { if (initial[f.k] != null) out[f.k] = ''; continue; } out[f.k] = f.type === 'num' || f.type === 'int' ? Number(raw) : raw; }
    onSubmit(out);
  };
  return (
    <form className="form" onSubmit={submit}>
      {fields.map((f) => {
        const id = 'f-' + f.k, common = { id, required: f.required, readOnly: f.readOnly, disabled: f.readOnly && f.type === 'select', value: v[f.k] ?? '', onChange: (e: any) => { set(f.k, e.target.value); f.onChange?.(e.target.value, set); } };
        return (
          <div key={f.k} className={'field' + (f.w ? ' w' + f.w : '')}>
            <label htmlFor={id}>{f.label}{f.required ? ' *' : ''}</label>
            {f.type === 'select' ? <select {...common}><option value="">—</option>{f.options!.map(([a, b]) => <option key={a} value={a}>{b}</option>)}</select>
              : f.type === 'textarea' ? <textarea {...common} rows={2} />
              : <input {...common} list={f.list} type={f.type === 'date' ? 'date' : f.type === 'text' ? 'text' : 'number'} min={f.type === 'num' || f.type === 'int' ? 0 : undefined} step={f.type === 'int' ? 1 : f.step ?? 'any'} />}
            {f.hint && <small>{f.hint}</small>}
          </div>);
      })}
      <div className="factions"><button className="btn btn-blue" disabled={busy}>{submitLabel}</button></div>
    </form>
  );
}

/** Alta + listado + edición + anulación + confirmación de un tipo de registro. */
export function RecordsPanel({ title, path, fixed, fields, columns, query, defaults, createPerm, hint, noteOnCreate }: {
  title: string; path: string; fixed?: Record<string, any>; fields: FieldDef[]; columns: Col[]; query?: string; defaults?: Record<string, any>; createPerm: string; hint?: string; noteOnCreate?: string;
}) {
  const { can, toast, refresh, confirmBox, meta } = useApp();
  const per = usePeriod(); const date0 = useDefaultDate();
  const closed = per?.status === 'cerrado';
  const [key, setKey] = useState(newKey), [busy, setBusy] = useState(false), [edit, setEdit] = useState<any>(null), [showVoid, setShowVoid] = useState(false), [asDraft, setAsDraft] = useState(false);
  const url = per ? `/${path}?from=${per.start}&to=${per.end}${query ? '&' + query : ''}&limit=500` : '';
  const { data, err, loading, reload } = useLoad<any>(() => (url ? api.get(url) : Promise.resolve(null)), [url]);
  const rows: any[] = (data?.rows ?? []).filter((r: any) => showVoid || r.status !== 'anulado');
  const initial = useMemo(() => ({ date: date0, ...defaults }), [date0, JSON.stringify(defaults)]);

  const create = async (vals: Record<string, any>) => {
    setBusy(true);
    const body = { ...fixed, ...vals, status: asDraft ? 'borrador' : 'confirmado' };
    try {
      await api.post(`/${path}`, body, key); toast('Registro guardado.'); setKey(newKey()); reload(); refresh();
    } catch (e: any) {
      if (e instanceof ApiError && e.code === 'DUPLICADO') {
        if (can('registro.confirmar')) {
          const c = await confirmBox({ title: 'Registro duplicado', text: 'Ya existe un registro idéntico. Si de verdad es otro, regístralo de todos modos.', okLabel: 'Registrar duplicado' });
          if (c.ok) { try { await api.post(`/${path}`, { ...body, allowDuplicate: true }, newKey()); toast('Registro guardado (duplicado intencional).'); setKey(newKey()); reload(); refresh(); } catch (e2: any) { toast(e2.message, true); } }
        } else toast('Ya existe un registro idéntico; no se guardó. Si es otro, pide a un supervisor que lo registre.', true);
      } else toast(e.message, true);
    } finally { setBusy(false); }
  };
  const saveEdit = async (vals: Record<string, any>) => {
    let reason: string | undefined;
    if (edit.status === 'confirmado') { const c = await confirmBox({ title: 'Motivo del cambio', text: 'Este registro ya está confirmado: el cambio queda en la bitácora.', reason: true, okLabel: 'Guardar cambio' }); if (!c.ok) return; reason = c.reason; }
    setBusy(true);
    try { await api.patch(`/${path}/${edit.id}`, { ...vals, version: edit.version, reason }); toast('Cambio guardado.'); setEdit(null); reload(); refresh(); } catch (e: any) { toast(e.message, true); } finally { setBusy(false); }
  };
  const voidIt = async (r: any) => {
    const c = await confirmBox({ title: 'Anular registro', text: 'No se borra: queda anulado con su justificación y deja de sumar en los cálculos.', reason: true, okLabel: 'Anular', danger: true });
    if (!c.ok) return;
    try { await api.post(`/${path}/${r.id}/anular`, { reason: c.reason }); toast('Registro anulado.'); reload(); refresh(); } catch (e: any) { toast(e.message, true); }
  };
  const confirmIt = async (r: any) => { try { await api.post(`/${path}/${r.id}/confirmar`); toast('Borrador confirmado.'); reload(); refresh(); } catch (e: any) { toast(e.message, true); } };
  const canVoid = can(path === 'requerimientos' ? 'requerimiento.gestionar' : path === 'merma' || path.startsWith('insumos') ? 'inventario.gestionar' : 'registro.anular');
  void meta;
  return (
    <>
      {can(createPerm) && (closed ? <div className="note">El periodo está cerrado: no se pueden agregar registros en estas fechas.</div> :
        <Card title={'Agregar · ' + title} sub={hint}>
          <RecordForm fields={fields} initial={initial} onSubmit={create} submitLabel="Guardar registro" busy={busy} />
          <label className="chk" style={{ display: 'inline-flex', gap: 6, marginTop: 8, fontSize: 13 }}><input type="checkbox" checked={asDraft} onChange={(e) => setAsDraft(e.target.checked)} /> Guardar como borrador (no suma hasta confirmarlo)</label>
          {noteOnCreate && <p className="muted" style={{ marginTop: 6 }}>{noteOnCreate}</p>}
        </Card>)}
      <Card title={`${title} · ${per?.month ?? ''}`} sub={`${rows.length} registros`} actions={<label className="chk" style={{ fontSize: 13 }}><input type="checkbox" checked={showVoid} onChange={(e) => setShowVoid(e.target.checked)} /> Ver anulados</label>}>
        <Loading err={err} loading={loading && !data} />
        {data && !rows.length && <p className="muted">Sin registros en este periodo.</p>}
        {rows.length > 0 && <div className="tbl-wrap"><table className="tbl"><thead><tr>{columns.map((c) => <th key={c.h} className={c.n ? 'n' : ''}>{c.h}</th>)}<th>Estado</th><th /></tr></thead><tbody>
          {rows.map((r) => (
            <tr key={r.id} className={r.status === 'anulado' ? 'void' : r.status === 'borrador' ? 'draft' : ''}>
              {columns.map((c) => <td key={c.h} className={c.n ? 'n' : ''}>{c.cell(r)}</td>)}
              <td><StatusPill s={r.status} />{r.isDemo && <> <span className="pill p-warn">demo</span></>}{r.status === 'anulado' && <div className="muted" style={{ textDecoration: 'none' }}>{r.voidReason}</div>}</td>
              <td style={{ whiteSpace: 'nowrap' }}>
                {r.poLineId && <span className="pill p-blue" title="Lo generó una orden de compra completada; para revertirlo anula la orden">de OC</span>}
                {r.status === 'borrador' && <button className="btn btn-sm" onClick={() => confirmIt(r)}>Confirmar</button>}{' '}
                {!r.poLineId && r.status !== 'anulado' && !closed && (can('registro.editar') || (r.status === 'borrador' && can('registro.editar_propio'))) && <button className="btn btn-sm" onClick={() => setEdit(r)}>Editar</button>}{' '}
                {!r.poLineId && r.status !== 'anulado' && !closed && canVoid && <button className="btn btn-sm btn-danger" onClick={() => voidIt(r)}>Anular</button>}
              </td>
            </tr>))}
        </tbody></table></div>}
      </Card>
      {edit && <Modal title="Editar registro" onClose={() => setEdit(null)} wide><RecordForm fields={fields} initial={{ ...edit, date: edit.recordDate ?? edit.requestDate ?? edit.scrapDate ?? edit.date }} onSubmit={saveEdit} submitLabel="Guardar cambio" busy={busy} /><div className="mact"><button className="btn" onClick={() => setEdit(null)}>Cancelar</button></div></Modal>}
    </>
  );
}
export const D = (r: any) => fmtDate(r.recordDate ?? r.requestDate ?? r.scrapDate);
export { Field };
