// Base de Operaciones en Supabase: esquema propio «operaciones» (no toca los de Transportes) + datos.
//   node scripts/supabase-base.mjs esquema          → crea el esquema y aplica db/migrations (falla si ya existe)
//   node scripts/supabase-base.mjs datos            → copia los datos de la base local omnia (pg_dump) al esquema
//   node scripts/supabase-base.mjs migrar           → aplica las migraciones de db/migrations que el esquema aún no tiene
//   node scripts/supabase-base.mjs rehacer          → borra el esquema operaciones y repite esquema + datos
// Usa la CLI de Supabase con sesión (supabase login) y el proyecto de supabase/proyecto.json. Ver docs/09-supabase.md.
// La base local se prepara con: python scripts/reset-db-windows.py omnia && cd server && npm run seed
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ref = process.env.SUPABASE_PROJECT_REF ?? JSON.parse(fs.readFileSync(path.join(root, 'supabase', 'proyecto.json'), 'utf8')).ref;
const SCHEMA = 'operaciones';
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'op-supabase-'));
const win = process.platform === 'win32';
const pgBin = (exe) => (win && fs.existsSync(`C:/Program Files/PostgreSQL/16/bin/${exe}.exe`) ? `C:/Program Files/PostgreSQL/16/bin/${exe}.exe` : exe);

function query(sql, label) {
  const f = path.join(work, label + '.sql');
  fs.writeFileSync(f, sql);
  const out = execFileSync('supabase', ['db', 'query', '--linked', '--project-ref', ref, '--workdir', work, '-o', 'json', '-f', f], { encoding: 'utf8', shell: win, maxBuffer: 64 << 20 });
  if (/"_tag"\s*:\s*"Error"|ERROR:/.test(out)) throw new Error(`${label}: ${out.slice(0, 2000)}`);
  return out;
}

function esquema() {
  const migs = fs.readdirSync(path.join(root, 'db', 'migrations')).filter((f) => f.endsWith('.sql')).sort();
  const sql = [
    `CREATE SCHEMA ${SCHEMA};`,
    'CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA extensions;',
    // solo el servidor del módulo (Edge Function, rol postgres) entra; la API pública de Supabase no ve este esquema
    `REVOKE ALL ON SCHEMA ${SCHEMA} FROM PUBLIC, anon, authenticated;`,
    `SET search_path TO ${SCHEMA}, extensions;`,
    ...migs.map((f) => `-- ${f}\n` + fs.readFileSync(path.join(root, 'db', 'migrations', f), 'utf8')),
    'CREATE TABLE schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());',
    `INSERT INTO schema_migrations (name) VALUES ${migs.map((f) => `('${f}')`).join(', ')};`,
  ].join('\n\n');
  query(`BEGIN;\n${sql}\nCOMMIT;`, 'esquema');
  console.log(`Esquema ${SCHEMA} creado con ${migs.length} migraciones.`);
}

// cada migración pendiente en su propia transacción, igual que server/src/migrate.ts
function migrar() {
  const out = query(`SELECT name FROM ${SCHEMA}.schema_migrations;`, 'aplicadas');
  const done = new Set(JSON.parse(out.slice(out.indexOf('{'))).rows.map((r) => r.name));
  const pend = fs.readdirSync(path.join(root, 'db', 'migrations')).filter((f) => f.endsWith('.sql') && !done.has(f)).sort();
  if (!pend.length) return console.log('Sin migraciones pendientes.');
  for (const f of pend) {
    const sql = fs.readFileSync(path.join(root, 'db', 'migrations', f), 'utf8');
    query(`BEGIN;\nSET LOCAL search_path TO ${SCHEMA}, extensions;\n-- ${f}\n${sql}\nINSERT INTO ${SCHEMA}.schema_migrations (name) VALUES ('${f}');\nCOMMIT;`, 'migrar');
    console.log(`Aplicada: ${f}`);
  }
}

function datos() {
  const dump = execFileSync(pgBin('pg_dump'), ['-h', 'localhost', '-U', 'omnia', '-d', process.env.OP_BASE_LOCAL ?? 'omnia', '--data-only', '--column-inserts', '--no-owner', '--schema=public', '--exclude-table=public.schema_migrations'],
    { encoding: 'utf8', env: { ...process.env, PGPASSWORD: process.env.PGPASSWORD ?? 'omnia_dev' }, maxBuffer: 256 << 20 });
  const lines = dump.split(/\r?\n/).filter((l) => l.startsWith('INSERT INTO public.') || l.startsWith("SELECT pg_catalog.setval('public."))
    .map((l) => l.replace(/^INSERT INTO public\./, `INSERT INTO ${SCHEMA}.`).replace("setval('public.", `setval('${SCHEMA}.`));
  // las migraciones ya sembraron clientes y proyectos: se reemplazan por los de la base local (mismos ids que sus registros)
  const head = `SET search_path TO ${SCHEMA}, extensions;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM ${SCHEMA}.production_records) OR EXISTS (SELECT 1 FROM ${SCHEMA}.purchase_orders) THEN
  RAISE EXCEPTION 'El esquema ${SCHEMA} ya tiene registros: no se copian datos encima (usa rehacer para empezar de cero)'; END IF; END $$;
TRUNCATE ${SCHEMA}.projects, ${SCHEMA}.clients CASCADE;`;
  // por partes: la API de consultas tiene un límite de tamaño por petición
  const parts = [], max = 400_000;
  let cur = [];
  for (const l of lines) { cur.push(l); if (cur.join('\n').length > max) { parts.push(cur); cur = []; } }
  if (cur.length) parts.push(cur);
  query(`BEGIN;\n${head}\n${parts.shift()?.join('\n') ?? ''}\nCOMMIT;`, 'datos-1');
  parts.forEach((p, i) => query(`BEGIN;\nSET search_path TO ${SCHEMA}, extensions;\n${p.join('\n')}\nCOMMIT;`, `datos-${i + 2}`));
  console.log(`Datos copiados: ${lines.length} filas en ${parts.length + 1} partes.`);
}

const cmd = process.argv[2];
try {
  if (cmd === 'esquema') esquema();
  else if (cmd === 'datos') datos();
  else if (cmd === 'migrar') migrar();
  else if (cmd === 'rehacer') { query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`, 'borrar'); esquema(); datos(); }
  else { console.log('Uso: node scripts/supabase-base.mjs esquema | datos | migrar | rehacer'); process.exitCode = 1; }
} finally { fs.rmSync(work, { recursive: true, force: true }); }
