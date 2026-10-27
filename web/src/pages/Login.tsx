import { useState } from 'react';
import { api, setToken } from '../api';
import { asset, ownLogin } from '../module';
import { signIn } from '../sso';
import { cambiarTema, temaActual } from '../theme';

// Etapas del dibujo del panel: el recorrido de un registro dentro de OP (en Transportes es la ruta de un viaje).
const ETAPAS = ['Producción', 'Horas', 'Compras', 'Inventario', 'Cobro'];

// Entrada con el formato de Transportes (panel de marca + formulario), con identidad propia de Operaciones.
export default function Login({ onLogin }: { onLogin: () => void }) {
  const [email, setEmail] = useState(''), [password, setPassword] = useState(''), [err, setErr] = useState(''), [busy, setBusy] = useState(false);
  const [tema, setTema] = useState(temaActual);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr('');
    try {
      if (ownLogin) await signIn(email, password);   // cuenta de Supabase (la misma de Transportes)
      else { const r = await api.post('/auth/login', { email, password }); setToken(r.token); }
      onLogin();
    }
    catch (x: any) { setErr(x.message); } finally { setBusy(false); }
  };
  return (
    <div className="auth">
      <section className="auth-hero">
        <button type="button" className="auth-theme" aria-pressed={tema === 'oscuro'} onClick={() => setTema(cambiarTema())}>{tema === 'oscuro' ? 'Modo claro' : 'Modo oscuro'}</button>
        <img className="auth-logo" src={asset('logo-blanco.png')} alt="In Transit · innovative outsourcing" width={300} height={122} />
        <div>
          <span className="auth-eyebrow">Operaciones</span>
          <h1>Herramienta de Operaciones</h1>
          <p>Seguimiento de procesos operativos: producción, horas, compras, inventario y cobro, con el historial de cada registro.</p>
        </div>
        <svg className="auth-flow" viewBox="0 0 440 96" fill="none" aria-hidden="true">
          <path d="M40 34H400" stroke="rgba(255,255,255,.22)" strokeWidth="3" strokeLinecap="round" />
          <path className="draw" d="M40 34H400" stroke="#14A1FF" strokeWidth="3" strokeLinecap="round" />
          {ETAPAS.map((n, i) => { const x = 40 + i * 90, fin = i === ETAPAS.length - 1; return (
            <g key={n} className="step" style={{ animationDelay: `${0.3 + i * 0.45}s` }}>
              <rect x={x - 13} y={21} width={26} height={26} rx={7} fill={fin ? '#00AD62' : '#003CA6'} stroke={fin ? '#00AD62' : '#14A1FF'} strokeWidth="3" />
              {fin ? <path d={`M${x - 6} 34l4 4 8-8`} stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" /> : <circle cx={x} cy={34} r={4} fill="#fff" />}
              <text x={x} y={74} textAnchor="middle" fill="#CFE0F5" fontSize="12" fontFamily="Arial, sans-serif">{n}</text>
            </g>); })}
        </svg>
      </section>
      <section className="auth-form"><form className="auth-box" onSubmit={submit}>
        <img className="auth-brand" src={asset('logo-color.png')} alt="In Transit · innovative outsourcing" width={280} height={95} />
        <h2>Ingresar</h2>
        <div className="field"><label htmlFor="em">Correo electrónico</label><input id="em" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} /></div>
        <div className="field"><label htmlFor="pw">Contraseña</label><input id="pw" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></div>
        {err && <div className="errline" role="alert">{err}</div>}
        <button className="btn btn-primary auth-submit" disabled={busy}>{busy ? 'Entrando…' : 'Entrar'}</button>
      </form></section>
    </div>
  );
}
