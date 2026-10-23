import { pool } from '../db.js';
import { Engine } from '../engine/compute.js';
import { loadEngineData } from './store.js';

let cache: { v: string; eng: Engine } | null = null;
/** El motor se reconstruye solo cuando cambian los datos (toda escritura deja huella en audit_log o cambia los conteos). */
export async function getEngine(): Promise<Engine> {
  const r = await pool.query(`SELECT (SELECT coalesce(max(id),0) FROM audit_log) a, (SELECT count(*) FROM production_records) p, (SELECT count(*) FROM hours_records) h,
                                      (SELECT count(*) FROM attendance) t, (SELECT count(*) FROM standards) s, (SELECT count(*) FROM inventory_counts) c`);
  const v = JSON.stringify(r.rows[0]);
  if (cache?.v === v) return cache.eng;
  const eng = new Engine(await loadEngineData(pool));
  cache = { v, eng };
  return eng;
}
export const resetEngineCache = () => { cache = null; };
