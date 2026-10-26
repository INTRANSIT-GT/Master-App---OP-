import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// Build «demo» (GitHub Pages, sin servidor): config.js propio con la ruta base tomada de la URL,
// y nombres de archivo sin «_» inicial (Jekyll de Pages los ignora).
const demoConfig: Plugin = {
  name: 'demo-config',
  generateBundle() {
    this.emitFile({ type: 'asset', fileName: 'config.js', source:
      'window.OPERACIONES_CONFIG={moduleId:"operaciones",authMode:"local",portalUrl:"./",basePath:location.pathname.replace(/\\/[^/]*$/,"")};\n' });
  },
};

export default defineConfig(({ mode }) => ({
  plugins: [react(), ...(mode === 'demo' ? [demoConfig] : [])],
  base: './',   // rutas relativas: el módulo se sirve igual en / que en /operaciones/
  server: { port: 5173, proxy: { '/api': 'http://localhost:3001', '/config.js': 'http://localhost:3001' } },
  build: mode === 'demo'
    ? { rollupOptions: { output: { entryFileNames: 'assets/app-[hash].js', chunkFileNames: 'assets/c-[hash].js', assetFileNames: 'assets/a-[hash][extname]' } } }
    : {},
  test: { environment: 'node' },
}));
