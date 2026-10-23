import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { api, ApiError, setToken, setUnauthorizedHandler, syncStore } from './api';
import { asset, cfg } from './module';
import { signOut } from './sso';

export interface Meta { user: { id: string; email: string; name: string; role: string; permissions: string[] }; demo: boolean; inicio: string; wmDiv: number; defaultMonth: string; today: string; areas: [string, string][]; summaryNames: Record<string, string>; lines: any[]; inventoryBaseDate: string | null; sede: string; authMode: 'local' | 'sso'; portalUrl: string; module: { id: string; name: string; basePath: string } }
interface Ctx {
  meta: Meta | null; can: (p: string) => boolean; month: string; setMonth: (m: string) => void; week: string; setWeek: (w: string) => void; refreshKey: number; refresh: () => void;
  toast: (msg: string, err?: boolean) => void; logout: () => void; reloadMeta: () => Promise<void>;
  confirmBox: (o: { title: string; text?: string; reason?: boolean; okLabel?: string; danger?: boolean }) => Promise<{ ok: boolean; reason?: string }>;
}
const C = createContext<Ctx>(null as any);
export const useApp = () => useContext(C);
export const useSync = () => useSyncExternalStore(syncStore.subscribe, syncStore.get);

const DENIED = ['MODULO_NO_ASIGNADO', 'ROL_INVALIDO', 'USUARIO_INACTIVO'];
function Denied({ title, message }: { title: string; message: string }) {
  return <div className="login-wrap"><div className="login"><img src={asset('logo.png')} alt="In Transit" style={{ height: 44, marginBottom: 16 }} /><h1>{title}</h1><p className="muted" style={{ margin: '8px 0 16px' }}>{message}</p><a className="btn btn-primary" href={cfg.portalUrl}>Volver al portal</a></div></div>;
}

export function AppProvider({ children, onLogout }: { children: ReactNode; onLogout: () => boolean | void }) {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [denied, setDenied] = useState<{ title: string; message: string } | null>(null);
  const [month, setMonthRaw] = useState(''), [week, setWeek] = useState('');
  const setMonth = useCallback((m: string | ((c: string) => string)) => { setMonthRaw(m as any); setWeek(''); }, []);
  const [refreshKey, setRefreshKey] = useState(0);
  const [toasts, setToasts] = useState<{ id: number; msg: string; err?: boolean }[]>([]);
  const [dlg, setDlg] = useState<null | { o: Parameters<Ctx['confirmBox']>[0]; res: (v: { ok: boolean; reason?: string }) => void }>(null);
  const [reason, setReason] = useState('');
  const id = useRef(0);
  const toast = useCallback((msg: string, err?: boolean) => { const n = ++id.current; setToasts((t) => [...t, { id: n, msg, err }]); setTimeout(() => setToasts((t) => t.filter((x) => x.id !== n)), err ? 8000 : 4000); }, []);
  const logout = useCallback(() => { if (cfg.authMode === 'sso') { void signOut(); return; } api.post('/auth/logout').catch(() => {}); setToken(null); onLogout(); }, [onLogout]);
  const leave = useCallback(() => { if (onLogout() === false) setDenied({ title: 'No se pudo validar tu sesión', message: 'Vuelve al portal e inicia sesión de nuevo. Si el problema continúa, avisa a un administrador.' }); }, [onLogout]);
  const reloadMeta = useCallback(async () => { const m = await api.get<Meta>('/meta'); setMeta(m); setMonthRaw((cur) => cur || m.defaultMonth); }, []);
  useEffect(() => {
    setUnauthorizedHandler(() => { setToken(null); leave(); });
    reloadMeta().catch((e) => { if (e instanceof ApiError && e.status === 403 && DENIED.includes(e.code)) setDenied({ title: e.code === 'MODULO_NO_ASIGNADO' ? 'Módulo no asignado' : 'Acceso no disponible', message: e.message }); else if (!(e instanceof ApiError && e.status === 401)) leave(); });
  }, [leave, reloadMeta]);
  const can = useCallback((p: string) => !!meta?.user.permissions.includes(p), [meta]);
  const confirmBox: Ctx['confirmBox'] = useCallback((o) => new Promise((res) => { setReason(''); setDlg({ o, res }); }), []);
  const v = useMemo(() => ({ meta, can, month, setMonth, week, setWeek, refreshKey, refresh: () => setRefreshKey((k) => k + 1), toast, logout, reloadMeta, confirmBox }), [meta, can, month, week, setMonth, refreshKey, toast, logout, reloadMeta, confirmBox]);
  const close = (ok: boolean) => { dlg?.res({ ok, reason: reason.trim() }); setDlg(null); };
  const needReason = dlg?.o.reason && reason.trim().length < 5;
  if (denied) return <Denied {...denied} />;
  return (
    <C.Provider value={v}>
      {children}
      <div className="toast-host" role="status" aria-live="polite">{toasts.map((t) => <div key={t.id} className={'toast' + (t.err ? ' err' : '')}>{t.msg}</div>)}</div>
      {dlg && (
        <div className="modal-bg" role="dialog" aria-modal="true" aria-label={dlg.o.title} onKeyDown={(e) => e.key === 'Escape' && close(false)}>
          <div className="modal">
            <h3>{dlg.o.title}</h3>
            {dlg.o.text && <p style={{ margin: '6px 0' }}>{dlg.o.text}</p>}
            {dlg.o.reason && <div className="field" style={{ marginTop: 10 }}><label htmlFor="rsn">Motivo (obligatorio, mínimo 5 caracteres)</label><textarea id="rsn" rows={3} autoFocus value={reason} onChange={(e) => setReason(e.target.value)} /></div>}
            <div className="mact"><button className="btn" onClick={() => close(false)}>Cancelar</button><button className={'btn ' + (dlg.o.danger ? 'btn-danger' : 'btn-primary')} disabled={!!needReason} onClick={() => close(true)}>{dlg.o.okLabel ?? 'Confirmar'}</button></div>
          </div>
        </div>
      )}
    </C.Provider>
  );
}
