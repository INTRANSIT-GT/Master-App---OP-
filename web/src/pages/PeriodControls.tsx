import { useState } from 'react';
import { api } from '../api';
import { Modal, useLoad } from '../components';
import { useApp } from '../store';

/** Semanas del mes (editables) y cierre/reapertura del periodo. */
export default function PeriodControls() {
  const { month, can, toast, refresh, confirmBox } = useApp();
  const { data: list } = useLoad<any[]>(() => api.get('/periodos'), []);
  const p = list?.find((x) => x.month === month);
  const [pre, setPre] = useState<any>(null), [ack, setAck] = useState(false), [notes, setNotes] = useState(''), [busy, setBusy] = useState(false);
  const [from, setFrom] = useState<string>(''), [to, setTo] = useState<string>('');
  if (!p) return null;
  const open = p.status === 'abierto';
  const startClose = async () => { try { setPre(await api.get(`/periodos/${month}/precierre`)); setAck(false); setNotes(''); } catch (e: any) { toast(e.message, true); } };
  const doClose = async () => {
    setBusy(true);
    try { await api.post(`/periodos/${month}/cerrar`, { acknowledgeWarnings: ack, notes: notes || undefined }); toast('Periodo cerrado. Las cifras quedaron congeladas.'); setPre(null); refresh(); }
    catch (e: any) { toast(e.message, true); } finally { setBusy(false); }
  };
  const reopen = async () => {
    const r = await confirmBox({ title: 'Reabrir periodo', text: 'Se descongelan las cifras y vuelven a permitirse cambios. Queda registrado quién y por qué.', reason: true, okLabel: 'Reabrir', danger: true });
    if (!r.ok) return;
    try { await api.post(`/periodos/${month}/reabrir`, { reason: r.reason }); toast('Periodo reabierto.'); refresh(); } catch (e: any) { toast(e.message, true); }
  };
  const saveWeeks = async () => { try { await api.put(`/periodos/${month}/semanas`, { from: +from, to: +to }); toast('Semanas del mes actualizadas.'); refresh(); } catch (e: any) { toast(e.message, true); } };
  return (
    <>
      <span className="psub">Semanas {open && can('periodo.semanas') ? <><input aria-label="Primera semana" className="wkin" style={{ width: 54 }} type="number" min={1} max={53} defaultValue={p.weekFrom} onChange={(e) => setFrom(e.target.value)} /> a <input aria-label="Última semana" style={{ width: 54 }} type="number" min={1} max={53} defaultValue={p.weekTo} onChange={(e) => setTo(e.target.value)} />{(from || to) && <button className="btn btn-sm" style={{ marginLeft: 6 }} onClick={() => { setFrom((f) => f || String(p.weekFrom)); setTo((t) => t || String(p.weekTo)); void saveWeeks(); }}>Aplicar</button>}</> : `${p.weekFrom} a ${p.weekTo}`} · {p.start.slice(8)}/{p.start.slice(5, 7)} al {p.end.slice(8)}/{p.end.slice(5, 7)}</span>
      {open && can('periodo.cerrar') && <button className="btn btn-sm" onClick={startClose}>Cerrar periodo…</button>}
      {!open && can('periodo.reabrir') && <button className="btn btn-sm" onClick={reopen}>Reabrir periodo</button>}
      {pre && (
        <Modal title={`Cierre de ${month}`} onClose={() => setPre(null)}>
          <p className="muted">Al cerrar, las cifras se congelan y nadie puede crear, editar ni anular registros de estas fechas.</p>
          {pre.blockers.length > 0 && <div className="errline" role="alert"><b>No se puede cerrar todavía:</b><ul>{pre.blockers.map((b: string) => <li key={b}>{b}</li>)}</ul></div>}
          {pre.warnings.length > 0 && <div className="warnline"><b>Advertencias ({pre.warnings.length}):</b><ul style={{ maxHeight: 180, overflow: 'auto' }}>{pre.warnings.map((b: string) => <li key={b}>{b}</li>)}</ul>
            <label className="chk"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} /> Revisé las advertencias y quiero cerrar de todos modos</label></div>}
          <div className="field" style={{ marginTop: 10 }}><label htmlFor="cn">Notas del cierre (opcional)</label><input id="cn" value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
          <div className="mact"><button className="btn" onClick={() => setPre(null)}>Cancelar</button><button className="btn btn-primary" disabled={busy || pre.blockers.length > 0 || (pre.warnings.length > 0 && !ack)} onClick={doClose}>Cerrar periodo</button></div>
        </Modal>
      )}
    </>
  );
}
