import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  base: './',   // rutas relativas: el módulo se sirve igual en / que en /operaciones/
  server: { port: 5173, proxy: { '/api': 'http://localhost:3001', '/config.js': 'http://localhost:3001' } },
  test: { environment: 'node' },
});
