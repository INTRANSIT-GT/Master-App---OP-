import { useState } from 'react';
import { api, setToken } from '../api';
import { asset } from '../module';

export default function Login({ onLogin }: { onLogin: () => void }) {
  const [email, setEmail] = useState(''), [password, setPassword] = useState(''), [err, setErr] = useState(''), [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr('');
    try { const r = await api.post('/auth/login', { email, password }); setToken(r.token); onLogin(); }
    catch (x: any) { setErr(x.message); } finally { setBusy(false); }
  };
  return (
    <div className="login-wrap"><form className="login" onSubmit={submit}>
      <img src={asset('logo.png')} alt="In Transit" style={{ height: 44, marginBottom: 16 }} />
      <h1>In Transit Operaciones</h1><p className="muted">Inicia sesión para continuar</p>
      <div className="field"><label htmlFor="em">Correo</label><input id="em" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} /></div>
      <div className="field"><label htmlFor="pw">Contraseña</label><input id="pw" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></div>
      {err && <div className="errline" role="alert">{err}</div>}
      <button className="btn btn-primary" style={{ width: '100%', marginTop: 16 }} disabled={busy}>{busy ? 'Entrando…' : 'Entrar'}</button>
    </form></div>
  );
}
