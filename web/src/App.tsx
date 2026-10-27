import { useCallback, useEffect, useRef, useState } from 'react';
import { api, hasToken, setSede, setToken } from './api';
import { fmtDT } from './format';
import { asset, cfg, ownLogin } from './module';
import { clearSession, goPortal } from './sso';
import { AppProvider, useApp, useSync } from './store';
import { cambiarTema, temaActual } from './theme';
import Login from './pages/Login';
import Produccion from './pages/Produccion';
import Horas from './pages/Horas';
import Compras from './pages/Compras';
import Comercial from './pages/Comercial';
import Inventario from './pages/Inventario';
import Ajustes from './pages/Ajustes';

// Menú lateral con el mismo formato que Transportes (Master App): ícono + nombre, la opción activa resaltada.
// Solo módulos operativos: Dashboard y Resumen se retiraron (el cierre de periodo vive en Ajustes › Periodos).
const TABS = [['prod', 'Producción', 'factory'], ['horas', 'Horas y personal', 'users'], ['compras', 'Compras', 'cart'], ['inv', 'Inventario', 'box'], ['com', 'Comercial', 'dollar'], ['adj', 'Ajustes', 'gear']] as const;
type Tab = (typeof TABS)[number][0];

function Shell({ onLogout }: { onLogout: () => boolean | void }) {
  const { meta, month, logout, can, toast } = useApp();
  const sync = useSync();
  const [tab, setTab] = useState<Tab>(() => (TABS.some((t) => t[0] === location.hash.slice(1)) ? (location.hash.slice(1) as Tab) : 'prod'));
  const [navOpen, setNavOpen] = useState(false);
  const [tema, setTema] = useState(temaActual);
  // sin elección guardada se sigue el sistema: si este cambia, el ícono del botón se actualiza
  useEffect(() => { try { const m = window.matchMedia('(prefers-color-scheme: dark)'), f = () => setTema(temaActual()); m.addEventListener('change', f); return () => m.removeEventListener('change', f); } catch { return undefined; } }, []);
  const mainRef = useRef<HTMLElement>(null);
  useEffect(() => { const f = () => { const h = location.hash.slice(1) as Tab; if (TABS.some((t) => t[0] === h)) setTab(h); }; window.addEventListener('hashchange', f); return () => window.removeEventListener('hashchange', f); }, []);
  useEffect(() => { if (!navOpen) return; const f = (e: KeyboardEvent) => { if (e.key === 'Escape') setNavOpen(false); }; window.addEventListener('keydown', f); return () => window.removeEventListener('keydown', f); }, [navOpen]);
  // el contenido se desplaza dentro de <main>: al cambiar de pantalla se vuelve arriba
  const go = (t: Tab) => { setTab(t); location.hash = t; setNavOpen(false); mainRef.current?.scrollTo(0, 0); };
  const exp = (k: 'excel' | 'pdf') => api.download(`/exportar/${k}?mes=${month}`, `InTransit_Operaciones_${meta?.sede?.id}_${month}.${k === 'excel' ? 'xlsx' : 'pdf'}`).then(() => toast('Archivo descargado.')).catch((e) => toast(e.message, true));
  // otra sede = otros datos en todas las pantallas: se recarga la página entera (conserva la pantalla por el #)
  const cambiarSede = (id: string) => { setSede(id); location.reload(); };
  if (!meta?.sede) return <p className="muted" style={{ padding: 24 }}>Cargando…</p>;
  const st = sync.offline ? 'off' : sync.pending ? 'saving' : '';
  void onLogout;
  return (
    <div className={'app' + (navOpen ? ' nav-open' : '')}>
      <header className="top">
        <button className="navbtn" aria-label="Abrir menú" aria-expanded={navOpen} aria-controls="side-nav" onClick={() => setNavOpen(!navOpen)}><Icon name="menu" size={22} /></button>
        <div className="brand"><span className="isotile"><img src={asset('isologo.png')} alt="In Transit" /></span><span className="brand-t">In Transit Operaciones</span></div>
        {meta.sedes.length > 1
          ? <label className="sede" title="Sede con la que trabajas"><Icon name="pin" size={16} /><select aria-label="Sede" value={meta.sede.id} onChange={(e) => cambiarSede(e.target.value)}>{meta.sedes.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
          : <span className="sede" title="Sede con la que trabajas"><Icon name="pin" size={16} /><span>{meta.sede.name}</span></span>}
        <span className="spacer" />
        <span className={'sync ' + st} role="status" aria-live="polite"><i />{sync.offline ? 'Sin conexión: no se guardó' : sync.pending ? 'Guardando…' : sync.lastSaved ? 'Guardado ' + fmtDT(new Date(sync.lastSaved).toISOString()) : 'Conectado'}</span>
        <div className="actions">
          {cfg.authMode === 'sso' && !ownLogin && <a className="btn btn-dark btn-sm" href={cfg.portalUrl + (cfg.portalUrl.includes('?') ? '&' : '?') + 'elegir=1'}>Módulos</a>}
          {can('exportar') && <><button className="btn btn-dark btn-sm" onClick={() => exp('excel')}>Excel</button><button className="btn btn-dark btn-sm" onClick={() => exp('pdf')}>PDF</button></>}
        </div>
        <button className="themebtn" aria-pressed={tema === 'oscuro'} aria-label={tema === 'oscuro' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'} title={tema === 'oscuro' ? 'Modo claro' : 'Modo oscuro'} onClick={() => setTema(cambiarTema())}><Icon name={tema === 'oscuro' ? 'sun' : 'moon'} size={20} /></button>
        <div className="userchip"><span className="avatar" aria-hidden="true">{initials(meta.user.name)}</span><span className="t"><b>{meta.user.name}</b><span>{meta.user.role}</span></span></div>
        <button className="btn btn-dark btn-sm" onClick={logout}>Salir</button>
      </header>
      <div className="body">
        <nav className="side" id="side-nav" aria-label="Navegación principal">
          {TABS.filter((t) => t[0] !== 'com' || can('comercial.ver')).map(([k, n, ic]) => <button key={k} aria-current={k === tab ? 'page' : undefined} onClick={() => go(k)}><Icon name={ic} />{n}</button>)}
        </nav>
        {navOpen && <div className="mback" onClick={() => setNavOpen(false)} />}
        <main id="main" className="main" ref={mainRef}><div className="inner">
          {tab === 'prod' && <Produccion />}
          {tab === 'horas' && <Horas />}
          {tab === 'compras' && <Compras />}
          {tab === 'com' && <Comercial />}
          {tab === 'inv' && <Inventario />}
          {tab === 'adj' && <Ajustes />}
        </div></main>
      </div>
    </div>
  );
}

const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((x) => x[0]).join('').toUpperCase();

// Trazos de los íconos de Transportes (js/utils.js, sol y luna de js/ui.js), más fábrica, carrito, caja y ubicación (sede) para OP.
const ICON: Record<string, string> = {
  factory: 'M3 21V10l6 4v-4l6 4V5h6v16zM3 21h18',
  users: 'M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M16 5a3 3 0 010 6M18 14c2 .8 3 2.8 3 6M12 8a3 3 0 11-6 0 3 3 0 016 0',
  cart: 'M2 3h3l2.5 12h11l2-8H6.2M10 20a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0M19 20a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0',
  box: 'M3 7l9-4 9 4v10l-9 4-9-4zM3 7l9 4 9-4M12 11v10',
  dollar: 'M12 3v18M16 7.5c0-1.7-1.8-3-4-3s-4 1.3-4 3 1.8 2.8 4 3.2 4 1.5 4 3.3-1.8 3-4 3-4-1.3-4-3',
  gear: 'M15 12a3 3 0 11-6 0 3 3 0 016 0M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1',
  menu: 'M3 6h18M3 12h18M3 18h18',
  pin: 'M12 21s-7-6.2-7-11.5a7 7 0 0114 0C19 14.8 12 21 12 21zM14.5 9.5a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0',
  sun: 'M16 12a4 4 0 11-8 0 4 4 0 018 0M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4',
  moon: 'M20 14.5A8.5 8.5 0 019.5 4a8.5 8.5 0 1010.5 10.5z',
};
function Icon({ name, size = 18 }: { name: string; size?: number }) {
  return <svg className="ic" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={ICON[name]} /></svg>;
}

export default function App() {
  const [logged, setLogged] = useState(hasToken());
  // Con sesión compartida (sso) y portal, no hay login propio: se vuelve al portal; false = ya se intentó hace instantes y no sirvió.
  // Con entrada propia (ownLogin) se borra la sesión de Supabase y se muestra la pantalla de entrar.
  const out = useCallback(() => { if (cfg.authMode === 'sso' && !ownLogin) return goPortal({ module: true }); if (ownLogin) clearSession(); setToken(null); setLogged(false); }, []);
  if (!logged) return <Login onLogin={() => setLogged(true)} />;
  return <AppProvider onLogout={out}><Shell onLogout={out} /></AppProvider>;
}
