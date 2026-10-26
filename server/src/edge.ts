// Entrada en Supabase Edge Functions: el mismo servidor, sin máquina propia.
// scripts/supabase-funcion.mjs lo empaqueta en supabase/functions/operaciones/; Supabase entrega aquí las peticiones de
// https://<ref>.supabase.co/functions/v1/operaciones/* (por eso BASE_PATH=/operaciones). Ver docs/09-supabase.md.
//
// La configuración va aquí y no en los secretos del proyecto: esos los comparten todas las funciones (también las de
// Transportes). Supabase ya inyecta SUPABASE_URL, SUPABASE_DB_URL, SUPABASE_ANON_KEY y SUPABASE_SERVICE_ROLE_KEY.
(globalThis as { OPERACIONES_ENV?: Record<string, string> }).OPERACIONES_ENV = {
  AUTH_MODE: 'sso', SSO_USUARIOS: 'modulo', BASE_PATH: '/operaciones', DB_SCHEMA: 'operaciones', DB_POOL_MAX: '3',
  CORS_ORIGIN: 'https://intransit-gt.github.io,http://localhost:5173,http://localhost:4173',
  PORTAL_URL: 'https://intransit-gt.github.io/Master-App---OP-/',
};
// import dinámico: config.ts se evalúa después de fijar los valores de arriba
try {
  const { createApp } = await import('./app.js');
  createApp().listen(8000);
} catch (e) {
  // sin servidor no hay a quién preguntar: se responde el motivo (sin secretos: solo el mensaje)
  console.error(e);
  const msg = JSON.stringify({ error: 'ARRANQUE', message: 'Operaciones no pudo arrancar: ' + (e instanceof Error ? e.message : String(e)) });
  (globalThis as any).Deno.serve(() => new Response(msg, { status: 503, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }));
}
