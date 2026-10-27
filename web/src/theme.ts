// Tema claro u oscuro con el mismo criterio que Transportes (js/ui.js): sin elección guardada se sigue el modo del
// sistema (lo resuelve el CSS); la elección del usuario manda con data-theme en la raíz y se recuerda en este navegador.
export type Tema = 'claro' | 'oscuro';
const KEY = 'op_tema';

const guardado = (): Tema | null => { try { const t = localStorage.getItem(KEY); return t === 'claro' || t === 'oscuro' ? t : null; } catch { return null; } };
const sistema = (): Tema => { try { return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'oscuro' : 'claro'; } catch { return 'claro'; } };

export const temaActual = (): Tema => guardado() ?? sistema();

export function aplicarTema() {
  const t = guardado(), d = document.documentElement;
  if (t) d.dataset.theme = t === 'oscuro' ? 'dark' : 'light'; else delete d.dataset.theme;
}

export function cambiarTema(): Tema {
  const t: Tema = temaActual() === 'oscuro' ? 'claro' : 'oscuro';
  try { localStorage.setItem(KEY, t); } catch { /* sin almacenamiento: vale solo para esta visita */ }
  const d = document.documentElement; d.dataset.theme = t === 'oscuro' ? 'dark' : 'light';
  return t;
}
