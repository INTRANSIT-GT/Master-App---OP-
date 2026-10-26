// Empaqueta el servidor de Operaciones como Edge Function de Supabase (un solo archivo, sin máquina propia).
//   node scripts/supabase-funcion.mjs              → supabase/functions/operaciones/app.mjs
//   node scripts/supabase-funcion.mjs --desplegar  → además lo publica en el proyecto (supabase CLI con sesión)
// El proyecto se toma de SUPABASE_PROJECT_REF o de supabase/proyecto.json. Ver docs/09-supabase.md.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { builtinModules, createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(root, 'server', 'package.json'));
const { build } = require('esbuild');
const out = path.join(root, 'supabase', 'functions', 'operaciones', 'app.mjs');

// pdfkit carga sus fuentes estándar con un require() armado en tiempo de ejecución, que el empaquetador no sigue:
// se cambian por importaciones fijas para que viajen dentro del archivo.
const pdfkitFonts = {
  name: 'pdfkit-fuentes',
  setup(b) {
    b.onLoad({ filter: /pdfkit[\\/]js[\\/]pdfkit\.node\.mjs$/ }, (a) => {
      let src = fs.readFileSync(a.path, 'utf8');
      const fonts = new Set([...src.matchAll(/require\$1\('#standard-fonts\/(\w+)'\)/g)].map((m) => m[1]));
      if (!fonts.size) throw new Error('pdfkit cambió su forma de cargar fuentes: revisa scripts/supabase-funcion.mjs');
      for (const f of fonts) src = src.replaceAll(`require$1('#standard-fonts/${f}')`, `__fuente_${f}`);
      const imports = [...fonts].map((f) => `import __fuente_${f} from 'pdfkit/standard-fonts/${f}';`).join('\n');
      return { contents: imports + '\n' + src, loader: 'js', resolveDir: path.dirname(a.path) };
    });
  },
};

// Deno (Edge Functions) solo acepta los módulos internos de Node con el prefijo «node:»
const nodePrefix = {
  name: 'prefijo-node',
  setup(b) {
    const builtins = new Set(builtinModules.filter((m) => !m.startsWith('_')));
    b.onResolve({ filter: /^[a-z_/]+$/ }, (a) => (builtins.has(a.path) ? { path: 'node:' + a.path, external: true } : undefined));
  },
};

await build({
  plugins: [pdfkitFonts, nodePrefix],
  entryPoints: [path.join(root, 'server', 'src', 'edge.ts')],
  outfile: out, bundle: true, platform: 'node', format: 'esm', target: 'es2022', minify: true, legalComments: 'none', logLevel: 'warning',
  external: ['pg-native'],   // opcional en pg; no se usa
  // los paquetes CommonJS piden módulos de Node con require() y esperan sus globales (Buffer, process, setImmediate):
  // Deno no los define en un módulo ESM, así que se los da el inicio del archivo
  banner: { js: [
    "import{createRequire as __cr}from'node:module';import{Buffer as __B}from'node:buffer';import __P from'node:process';import{setImmediate as __si,clearImmediate as __ci}from'node:timers';",
    'const require=__cr(import.meta.url);globalThis.Buffer??=__B;globalThis.process??=__P;globalThis.global??=globalThis;globalThis.setImmediate??=__si;globalThis.clearImmediate??=__ci;',
  ].join('') },
});
console.log(`Función empaquetada: ${path.relative(root, out)} (${(fs.statSync(out).size / 1048576).toFixed(1)} MB)`);

if (process.argv.includes('--desplegar')) {
  const ref = process.env.SUPABASE_PROJECT_REF ?? JSON.parse(fs.readFileSync(path.join(root, 'supabase', 'proyecto.json'), 'utf8')).ref;
  // sin verificación del gateway: el servidor valida el token de Supabase y deja pasar las consultas previas de CORS
  // --workdir . con cwd en la raíz: en Windows (shell) una ruta con espacios se partiría
  execFileSync('supabase', ['functions', 'deploy', 'operaciones', '--project-ref', ref, '--use-api', '--no-verify-jwt', '--workdir', '.'], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
}
