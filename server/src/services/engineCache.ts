import { pool } from '../db.js';
import { Engine } from '../engine/compute.js';
import { loadEngineData } from './store.js';

const cache = new Map<string, { v: string; eng: Engine }>();
/** Un motor por sede. Se reconstruye solo cuando cambian los datos (toda escritura deja huella en audit_log o cambia los conteos). */
export async function getEngine(sede: string): Promise<Engine> {
  const r = await pool.query(`SELECT (SELECT coalesce(max(id),0) FROM audit_log) a, (SELECT count(*) FROM production_records) p, (SELECT count(*) FROM hours_records) h,
                                      (SELECT count(*) FROM attendance) t, (SELECT count(*) FROM standards) s, (SELECT count(*) FROM inventory_counts) c`);
  const v = JSON.stringify(r.rows[0]), hit = cache.get(sede);
  if (hit?.v === v) return hit.eng;
  const eng = new Engine(await loadEngineData(pool, sede));
  cache.set(sede, { v, eng });
  return eng;
}
export const resetEngineCache = () => { cache.clear(); };
