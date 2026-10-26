// Modo demostración (npm run build:demo → ../demo, para GitHub Pages): no hay servidor.
// Las lecturas salen de respuestas grabadas del servidor local con datos demo y mock (e2e/demo-capturar.mjs);
// los cambios no se guardan. Solo se carga en el build «demo»: main.tsx lo importa con import.meta.env.MODE.
import grabado from './demo-data.json';

const datos = grabado as { login: unknown; respuestas: Record<string, unknown> };
const real = window.fetch.bind(window);
const json = (cuerpo: unknown, status = 200) => new Response(JSON.stringify(cuerpo), { status, headers: { 'Content-Type': 'application/json' } });
const aviso = (message: string, status = 403) => json({ error: 'DEMO', message }, status);

window.fetch = async (entrada: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(entrada instanceof Request ? entrada.url : String(entrada), location.href);
  const i = url.pathname.indexOf('/api/');
  if (i < 0) return real(entrada, init);
  const ruta = url.pathname.slice(i + 4), metodo = (init?.method ?? 'GET').toUpperCase();
  if (ruta === '/auth/login') return json(datos.login);
  if (ruta.startsWith('/auth/')) return json({ ok: true });
  if (metodo !== 'GET') return aviso('Modo demostración: los cambios no se guardan.');
  if (/\/(excel|pdf)$|\/export/.test(ruta)) return aviso('Las descargas no están disponibles en la demostración.');
  const clave = ruta + url.search;
  if (clave in datos.respuestas) return json(datos.respuestas[clave]);
  // la misma vista con otros filtros (otro mes, otra búsqueda): se muestra la grabada
  const parecida = Object.keys(datos.respuestas).find((k) => k.split('?')[0] === ruta);
  return parecida ? json(datos.respuestas[parecida]) : aviso('Esta vista no tiene datos en la demostración.', 404);
};
