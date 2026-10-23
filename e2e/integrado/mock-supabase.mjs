// Supabase simulado SOLO para pruebas: emite tokens HS256 con app_metadata.modulos y cuenta renovaciones. No es seguro ni real.
import http from 'node:http';
import crypto from 'node:crypto';
const PORT = Number(process.env.MOCK_PORT ?? 9999), SECRET = process.env.SUPABASE_JWT_SECRET, ISS = process.env.MOCK_ISS, TTL = Number(process.env.MOCK_TTL ?? 3600);
const USERS = {
  'ana@intransit.test': { id: 'a0000000-0000-4000-8000-000000000001', pw: 'Clave-Ana-1', name: 'Ana Pérez', modulos: { operaciones: 'supervisor', transportes: 'ADMIN' } },
  'luis@intransit.test': { id: 'a0000000-0000-4000-8000-000000000002', pw: 'Clave-Luis-1', name: 'Luis Gómez', modulos: { transportes: 'ENCARGADO' } },
  'marta@intransit.test': { id: 'a0000000-0000-4000-8000-000000000003', pw: 'Clave-Marta-1', name: 'Marta Ruiz', modulos: { operaciones: 'operador' } },
  'jefe@intransit.test': { id: 'a0000000-0000-4000-8000-000000000004', pw: 'Clave-Jefe-1', name: 'Jefe Ops', modulos: { operaciones: 'administrador' } },
  'sin@intransit.test': { id: 'a0000000-0000-4000-8000-000000000005', pw: 'Clave-Sin-1', name: 'Sin Modulos', modulos: {} },
};
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const sign = (u, email) => { const now = Math.floor(Date.now() / 1000), h = b64({ alg: 'HS256', typ: 'JWT' }), p = b64({ iss: ISS, aud: 'authenticated', sub: u.id, email, iat: now, exp: now + TTL, role: 'authenticated', app_metadata: { provider: 'email', modulos: u.modulos }, user_metadata: { full_name: u.name } });
  return `${h}.${p}.${crypto.createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url')}`; };
const byRefresh = new Map(); let refreshes = 0;
const session = (email) => { const u = USERS[email], now = Math.floor(Date.now() / 1000), rt = crypto.randomUUID(); byRefresh.set(rt, email);
  return { access_token: sign(u, email), token_type: 'bearer', expires_in: TTL, expires_at: now + TTL, refresh_token: rt, user: { id: u.id, email, app_metadata: { modulos: u.modulos } } }; };
http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x'); let body = '';
  req.on('data', (c) => (body += c)); req.on('end', () => {
    const send = (code, o) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (url.pathname === '/__stats') return send(200, { refreshes });
    if (url.pathname === '/auth/v1/logout') return send(204, {});
    if (url.pathname !== '/auth/v1/token' || req.method !== 'POST') return send(404, { error: 'no' });
    const j = body ? JSON.parse(body) : {}, grant = url.searchParams.get('grant_type');
    if (grant === 'password') { const u = USERS[String(j.email).toLowerCase()]; return u && u.pw === j.password ? send(200, session(String(j.email).toLowerCase())) : send(400, { error: 'invalid_grant', error_code: 'invalid_credentials' }); }
    if (grant === 'refresh_token') { const e = byRefresh.get(j.refresh_token); if (!e) return send(400, { error: 'invalid_grant' }); byRefresh.delete(j.refresh_token); refreshes++; return send(200, session(e)); }
    send(400, { error: 'unsupported_grant_type' });
  });
}).listen(PORT, () => console.log('mock supabase en', PORT));
