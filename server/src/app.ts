import fs from 'node:fs';
import path from 'node:path';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { authenticate } from './auth.js';
import { MODULE_ID, MODULE_NAME, MODULE_VERSION, config, publicConfig } from './config.js';
import { pool } from './db.js';
import { errorHandler } from './http.js';
import { sedeScope } from './sede.js';
import { ROLES } from './sso.js';
import { authRouter } from './routes/auth.js';
import { catalogRouter } from './routes/catalog.js';
import { comercialRouter } from './routes/comercial.js';
import { purchasesRouter } from './routes/purchases.js';
import { importRouter } from './routes/importRoutes.js';
import { maquilasRouter } from './routes/maquilas.js';
import { recordsRouter } from './routes/records.js';
import { reportsRouter } from './routes/reports.js';
import { usersRouter } from './routes/users.js';

/**
 * Todo el módulo Operaciones como un router de Express: se monta en su propio servidor (createApp)
 * o dentro de otro servidor Node con `app.use(config.basePath, createOperacionesRouter())`.
 * Rutas (relativas a la ruta base): /api/*, /config.js (configuración pública), /api/modulo (manifiesto) y la web.
 */
export function createOperacionesRouter() {
  const r = express.Router();
  const connect = ["'self'", ...(config.authMode === 'sso' ? [config.supabaseUrl] : [])];   // el navegador renueva la sesión contra Supabase
  r.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'], fontSrc: ["'self'", 'https://fonts.gstatic.com'], imgSrc: ["'self'", 'data:'], scriptSrc: ["'self'"], connectSrc: connect } } }));
  r.use(cors({ origin: config.corsOrigin.split(','), credentials: false }));
  r.use(express.json({ limit: '1mb' }));
  r.get('/api/health', async (_req, res) => { await pool.query('SELECT 1'); res.json({ ok: true, module: MODULE_ID, time: new Date().toISOString() }); });
  // Manifiesto: lo que otra app (portal, menú) necesita saber para listar y abrir el módulo.
  r.get('/api/modulo', (_req, res) => res.json({ id: MODULE_ID, nombre: MODULE_NAME, version: MODULE_VERSION, basePath: config.basePath, entrada: `${config.basePath}/`, api: `${config.basePath}/api`, authMode: config.authMode, roles: ROLES, asignacion: { claim: 'app_metadata.modulos', clave: MODULE_ID } }));
  r.get('/config.js', (_req, res) => { res.type('application/javascript').set('Cache-Control', 'no-store').send(`window.OPERACIONES_CONFIG=${JSON.stringify(publicConfig())};`); });
  r.use('/api/auth', authRouter);
  r.use('/api', authenticate, sedeScope, recordsRouter, catalogRouter, reportsRouter, importRouter, usersRouter, purchasesRouter, comercialRouter, maquilasRouter);
  r.use('/api', (_req, res) => res.status(404).json({ error: 'NO_ENCONTRADO', message: 'Ruta inexistente.' }));
  const dist = path.resolve(config.webDist);
  if (fs.existsSync(dist)) { r.use(express.static(dist)); r.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html'))); }
  r.use(errorHandler);
  return r;
}

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  if (config.basePath) {
    // Comparación exacta: app.get() ignoraría la barra final y /operaciones/ se redirigiría a sí mismo.
    app.use((req, res, next) => (req.path === '/' || req.path === config.basePath ? res.redirect(`${config.basePath}/`) : next()));   // la web usa rutas relativas: exige la barra final
  }
  app.use(config.basePath || '/', createOperacionesRouter());
  return app;
}
