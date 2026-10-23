import { useCallback, useEffect, useState } from 'react';
import { api, hasToken, setToken } from './api';
import { Tabs } from './components';
import { fmtDT } from './format';
import { asset, cfg } from './module';
import { goPortal } from './sso';
import { AppProvider, useApp, useSync } from './store';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Produccion from './pages/Produccion';
import Horas from './pages/Horas';
import Resumen from './pages/Resumen';
import Compras from './pages/Compras';
import Comercial from './pages/Comercial';
import Inventario from './pages/Inventario';
import Ajustes from './pages/Ajustes';

const TABS = [['dash', 'Dashboard'], ['prod', 'Producción'], ['horas', 'Horas y personal'], ['sum', 'Resumen'], ['compras', 'Compras'], ['inv', 'Inventario'], ['com', 'Comercial'], ['adj', 'Ajustes']] as const;
type Tab = (typeof TABS)[number][0];

function Shell({ onLogout }: { onLogout: () => boolean | void }) {
  const { meta, month, logout, can, toast } = useApp();
  const sync = useSync();
  const [tab, setTab] = useState<Tab>(() => (TABS.some((t) => t[0] === location.hash.slice(1)) ? (location.hash.slice(1) as Tab) : 'dash'));
  useEffect(() => { const f = () => { const h = location.hash.slice(1) as Tab; if (TABS.some((t) => t[0] === h)) setTab(h); }; window.addEventListener('hashchange', f); return () => window.removeEventListener('hashchange', f); }, []);
  const go = (t: Tab) => { setTab(t); location.hash = t; };
  const exp = (k: 'excel' | 'pdf') => api.download(`/exportar/${k}?mes=${month}`, `InTransit_Operaciones_${month}.${k === 'excel' ? 'xlsx' : 'pdf'}`).then(() => toast('Archivo descargado.')).catch((e) => toast(e.message, true));
  if (!meta) return <p className="muted" style={{ padding: 24 }}>Cargando…</p>;
  const st = sync.offline ? 'off' : sync.pending ? 'saving' : '';
  void onLogout;
  return (
    <>
      <header className="appbar"><div className="appbar-in">
        <div className="brand"><img className="logo" src={asset('logo.png')} alt="Logotipo" /><div><h1>In Transit Operaciones</h1><p>Producción, compras, inventario y cobro · Sede {meta.sede}</p></div></div>
        <div className="actions">
          <span className={'sync ' + st} role="status" aria-live="polite"><i />{sync.offline ? 'Sin conexión: no se guardó' : sync.pending ? 'Guardando…' : sync.lastSaved ? 'Guardado ' + fmtDT(new Date(sync.lastSaved).toISOString()) : 'Conectado'}</span>
          {cfg.authMode === 'sso' && <a className="btn btn-dark btn-sm" href={cfg.portalUrl + (cfg.portalUrl.includes('?') ? '&' : '?') + 'elegir=1'}>Módulos</a>}
          {can('exportar') && <><button className="btn btn-dark btn-sm" onClick={() => exp('excel')}>Excel</button><button className="btn btn-dark btn-sm" onClick={() => exp('pdf')}>PDF</button></>}
          <div className="userbox"><b>{meta.user.name}</b><br />{meta.user.role}</div>
          <button className="btn btn-dark btn-sm" onClick={logout}>Salir</button>
        </div>
      </div></header>
      {meta.demo && <div className="demo-banner" role="note">DATOS DE DEMOSTRACIÓN: las cifras no son reales ni deben usarse para decisiones</div>}
      <div className="tabs-wrap"><Tabs items={TABS.filter((t) => t[0] !== 'com' || can('comercial.ver')).map((t) => [t[0], t[1]] as [Tab, string])} value={tab} onChange={go} /></div>
      <main id="main">
        {tab === 'dash' && <Dashboard go={go} />}
        {tab === 'prod' && <Produccion />}
        {tab === 'horas' && <Horas />}
        {tab === 'sum' && <Resumen />}
        {tab === 'compras' && <Compras />}
        {tab === 'com' && <Comercial />}
        {tab === 'inv' && <Inventario />}
        {tab === 'adj' && <Ajustes />}
      </main>
    </>
  );
}

export default function App() {
  const [logged, setLogged] = useState(hasToken());
  // Con sesión compartida (sso) no hay login propio: se vuelve al portal; false = ya se intentó hace instantes y no sirvió.
  const out = useCallback(() => { if (cfg.authMode === 'sso') return goPortal({ module: true }); setToken(null); setLogged(false); }, []);
  if (!logged) return <Login onLogin={() => setLogged(true)} />;
  return <AppProvider onLogout={out}><Shell onLogout={out} /></AppProvider>;
}
