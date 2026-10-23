import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool, tx } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { resetEngineCache } from '../src/services/engineCache.js';
import { DEMO_PASSWORD, DEMO_USERS, seedCatalog, seedDemo, seedUsers } from '../src/seed/seed.js';

export const app = createApp();
export async function resetDb(withDemo = true) {
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate();
  await tx(async (c) => { await seedCatalog(c); await seedUsers(c, DEMO_USERS, DEMO_PASSWORD); if (withDemo) await seedDemo(c); });
  resetEngineCache();
}
const tokens: Record<string, string> = {};
export async function login(role: 'admin' | 'supervisor' | 'operador' | 'consulta' | 'comercial') {
  if (tokens[role]) return tokens[role];
  const r = await request(app).post('/api/auth/login').send({ email: `${role}@omnia.local`, password: DEMO_PASSWORD });
  if (r.status !== 200) throw new Error('login falló ' + JSON.stringify(r.body));
  return (tokens[role] = r.body.token);
}
export const as = async (role: Parameters<typeof login>[0]) => {
  const t = await login(role);
  const w = (m: 'get' | 'post' | 'put' | 'patch' | 'delete') => (url: string) => request(app)[m](url).set('Authorization', 'Bearer ' + t);
  return { get: w('get'), post: w('post'), put: w('put'), patch: w('patch'), delete: w('delete') };
};
export { request, pool };
