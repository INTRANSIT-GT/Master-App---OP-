import fs from 'node:fs';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// Builds para GitHub Pages (solo archivos estáticos): config.js propio con la ruta base tomada de la URL,
// y nombres de archivo sin «_» inicial (Jekyll de Pages los ignora).
//   demo     → ../demo: sin servidor, respuestas grabadas (src/demo.ts)
//   supabase → ../app: la app real; datos, sesión y servidor en Supabase (supabase/proyecto.json, docs/09-supabase.md)
const pagesConfig = (extra: Record<string, string>): Plugin => ({
  name: 'pages-config',
  generateBundle() {
    const vals = Object.entries(extra).map(([k, v]) => `${k}:${JSON.stringify(v)}`).join(',');
    this.emitFile({ type: 'asset', fileName: 'config.js', source:
      `window.OPERACIONES_CONFIG={moduleId:"operaciones",${vals},basePath:location.pathname.replace(/\\/[^/]*$/,"")};\n` });
  },
});
function supabaseConfig(): Record<string, string> {
  const p = JSON.parse(fs.readFileSync(new URL('../supabase/proyecto.json', import.meta.url), 'utf8'));
  return { authMode: 'sso', ssoUsers: 'modulo', portalUrl: './', supabaseUrl: p.url, supabaseKey: p.publishableKey, storageKey: `sb-${p.ref}-auth-token`, apiUrl: `${p.url}/functions/v1/operaciones/api` };
}
const pages = { rollupOptions: { output: { entryFileNames: 'assets/app-[hash].js', chunkFileNames: 'assets/c-[hash].js', assetFileNames: 'assets/a-[hash][extname]' } } };

export default defineConfig(({ mode }) => ({
  plugins: [react(), ...(mode === 'demo' ? [pagesConfig({ authMode: 'local', portalUrl: './' })] : mode === 'supabase' ? [pagesConfig(supabaseConfig())] : [])],
  base: './',   // rutas relativas: el módulo se sirve igual en / que en /operaciones/
  server: { port: 5173, proxy: { '/api': 'http://localhost:3001', '/config.js': 'http://localhost:3001' } },
  build: mode === 'demo' || mode === 'supabase' ? pages : {},
  test: { environment: 'node' },
}));
