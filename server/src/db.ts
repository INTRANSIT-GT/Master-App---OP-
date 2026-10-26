import pg from 'pg';
import { config } from './config.js';

// NUMERIC llega como número JS (las cantidades de este dominio caben en double); DATE llega como 'YYYY-MM-DD'.
pg.types.setTypeParser(1700, (v) => (v === null ? null : parseFloat(v)) as any);
pg.types.setTypeParser(1082, (v) => v);
pg.types.setTypeParser(20, (v) => parseInt(v, 10));

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: config.dbPoolMax });
// Esquema propio (Supabase): las tablas del módulo viven en «operaciones», junto a las de Transportes sin mezclarse.
// pg encola las consultas de cada conexión en orden, así que el SET va antes que cualquier otra.
if (config.dbSchema) pool.on('connect', (c) => { c.query(`SET search_path TO ${config.dbSchema}, extensions, public`).catch(() => {}); });
export type Q = Pick<pg.PoolClient, 'query'>;

export async function tx<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const r = await fn(c);
    await c.query('COMMIT');
    return r;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}
