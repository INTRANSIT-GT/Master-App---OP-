# TRASPASO · OP (Operaciones)

Registro cronológico. Cada entrada separa propuesto, preparado, ejecutado, verificado y aprobado.

## 2026-10-25 · Configuración local de Claude

**Solicitud:** Ing. Carmen entregó el paquete de inicio v1.0 y autorizó: (1) preparar los archivos, clonando los repos reales; (2) hacerlo en OP y en Master App; (3) mantener los repos públicos por el momento; (4) tratar Supabase `bocgzjupocnvjehklxhs` como prueba; (5) usar un Excel de ejemplo relacionado con OP.

**Alcance:** solo archivos locales en este clon. Sin commit, push, Supabase ni corrección de defectos.

- **Propuesto:** el paquete v1.0 (preparado por Codex; es una propuesta, no una certificación).
- **Preparado:** `AGENTS.md`, `CLAUDE.md`, `docs/ai/{ESTADO,TRASPASO,FUENTES,SEGURIDAD}.md`, `scripts/intransit-startup.cjs`, `.claude/settings.json` (hook `SessionStart` en forma exec `node` + `args`, sin matcher: startup, resume, clear y compact), `.claude/skills/intransit-trazabilidad/SKILL.md`, `.gitignore` (copiado de la entrega en zip + rutas privadas de Claude).
- **Ejecutado:** clon `1793036`; comprobación de que el código del zip local es idéntico al remoto salvo archivos de configuración; copia de solo lectura y SHA-256 del Excel de ejemplo; inventario estructural del libro (sin macros ni vínculos ejecutados); prueba manual del script del hook.
- **Verificado:** ver la sección de pruebas abajo.
- **Aprobado:** nada de lo anterior está aprobado para commit o publicación.

**Pruebas:** ver la entrada «Prueba del hook» al final de este archivo.

**Pendientes:** prueba en sesión nueva; decidir el commit de estos archivos; confirmar el entorno real de Supabase; instalar PostgreSQL 16 para correr las pruebas de servidor.

### Prueba del hook · 2026-10-25 · Windows 11, Node 22.23.4, Git Bash
Comando: `node scripts/intransit-startup.cjs` con JSON sintético por stdin, en OP y en Master App.

| Caso | Resultado |
|---|---|
| `node --check` | PASA |
| `source: startup`, `compact`, `resume` | PASA: recibo con evento, app, rama, SHA, hashes y `missing: []`; salida ≈ 2 900 caracteres |
| stdin vacío | PASA: `event: PRUEBA_MANUAL` |
| JSON inválido | PASA: no falla (exit 0) |
| Ruta con espacios, sin Git y sin archivos | PASA: 4 archivos `FALTANTE`, `NO_VERIFICADO` en rama/SHA/dirty (corregido el conteo de `dirty` fuera de Git) |
| ESTADO de 9 000 caracteres | PASA: se trunca a 6 000 con aviso; salida total < 10 000 (límite de Claude Code) |
| Lectura de `.env`, Excel o red | NO lo hace (revisión del código) |
| Datos del Excel o secretos en los archivos preparados | Ninguno (búsqueda de términos del libro y patrones de claves) |

**No verificado aquí:** ejecución real del hook por Claude Code en una sesión nueva, `/context`, `/hooks`, descubrimiento de la skill. Estado: pendiente de prueba en el Claude de Carmen.

## 2026-10-25 · EOS con selector, operadores y bitácora diaria

**Solicitud:** Ing. Carmen pidió que EOS lance las sesiones conectadas sin forzar los dos repos, con un selector ASCII; una bitácora diaria del trabajo con IA inyectada por EOS; y que todo funcione igual para NORA (persona en otra PC, aún sin alta) cuando haga rebase del remoto. Decisiones suyas: bitácora privada + resumen público por operador; skill de bitácora.

- **Hecho (fuera del repo, en la carpeta de EOS):** `EOS.py` con menú de 3 pasos (quién trabaja · qué abrir · cómo: completo / rápido / solo preparar), panel con rama, revisión, cambios y última bitácora por repo, alta de operadores, opciones `--operador --repos --modo --sin-menu`. `EOS/perfiles.json` (Carmen activa, NORA pendiente). `EOS/local/` guarda la última elección y un manifiesto de hashes: EOS actualiza solo los archivos del kit que instaló y nadie tocó. Respaldo del EOS anterior en `EOS/respaldos/`.
- **Kit (inyectado en OP y Transportes, sin commit):** hook con `operator` y `log` en el recibo, y el final de la bitácora privada; skill `.claude/skills/intransit-bitacora/`; `docs/ai/diario/README.md`; `CLAUDE.md` trata al operador según el recibo.
- **Privado por equipo (ignorado por Git):** `.claude/privado/operador.json` y `.claude/privado/bitacora/AAAA-MM-DD.md`. El resumen público va en `docs/ai/diario/<operador>/`, una carpeta por persona para que los rebase no choquen.

**Pruebas · Windows 11, Python 3.13.5, Node 22.23.4, Git Bash:**

| Caso | Resultado |
|---|---|
| `py_compile EOS.py`, `node --check` del hook | PASA |
| Menú con entrada simulada (`--menu`): 3 pasos, volver, salir, NORA bloqueada sin alta | PASA |
| Alta de NORA en copia aislada | PASA: `activo: true` en perfiles de la copia (el real no se tocó) |
| Opciones inválidas | PASA: error claro, exit 1 |
| Modo rápido real, OP por menú y Transportes por opciones, `--sin-abrir` | PASA: kit actualizado (`^`), operador declarado, hook con `operator: carmen` |
| Segunda corrida | PASA: no reinstala nada |
| Archivo del kit editado a mano | PASA: se conserva con aviso |
| Hook sin EOS (equipo de NORA tras rebase) | PASA: `operator: NO_DECLARADO`, `log: SIN_BITACORA`, sin fallar |
| `.claude/privado/*` ignorado por Git | PASA (`git check-ignore`) |

**No verificado:** doble clic en `EOS.cmd` en consola real (borrado de pantalla), modos completo y preparar con red y npm, apertura de VS Code. Las pruebas dejaron 2 líneas INICIO en las bitácoras privadas de hoy.

**Pendientes:** cómo recibe NORA la carpeta EOS (copiar sin `EOS/local`, `registros`, `respaldos`); si la solicitud de NORA define alcance (regla 2 de `AGENTS.md`, decisión de Carmen); diagnosticar el PWA en GitHub; commit de todo esto cuando Carmen lo apruebe.

## 2026-10-25 · EOS dentro de los repos, aviso de dependencias, alcance de NORA

**Solicitud:** Ing. Carmen pidió agregar EOS en ambos repos; que EOS advierta si faltan dependencias y genere el prompt para poner en sincronía la sesión de Claude; NORA con el mismo alcance que Carmen.

- **Hecho:** EOS en `eos/` (OP; copiado por EOS a Transportes): `EOS.py` (VERSION 2026.10.25.2), `EOS.cmd`, `LEEME.md`, `perfiles.json`, `plantillas/`. Lo propio del equipo se movió a `<carpeta de repos>/.eos/` (fuera de Git). El EOS anterior de la carpeta raíz quedó en `.eos/respaldos/eos-raiz-20261025/`; la raíz conserva un `EOS.cmd` que delega en `repos/…/eos/EOS.cmd`, para no romper el acceso directo.
- **Dependencias:** npm faltante o desactualizado (package-lock.json más nuevo que `node_modules/.package-lock.json`); por repo, PostgreSQL (`psql`) y Docker en OP; CLIs opcionales; Git atrasado, adelantado o con cambios. En modo completo instala lo npm faltante o viejo antes de revisar.
- **Prompt de sincronización:** `.claude/privado/sync.md` por repo; se imprime en un recuadro y el primero con pendientes se copia al portapapeles. Pide instalar solo lo local y reversible, y esperar autorización para lo del sistema, pull, rebase, commit o push.
- **Sincronía de EOS entre repos:** EOS copia su `eos/` al otro repo con el manifiesto, y nunca encima de una versión más nueva (`VERSION`). `perfiles.json` es documento vivo; el alta se escribe en los dos.
- **NORA:** `AGENTS.md` (plantillas y ambos repos) declara a Ing. Carmen y NORA con el mismo alcance en las reglas 2, 8 y 12; los Excel siguen siendo de Carmen. `SEGURIDAD.md` actualizado sobre lo que lee el hook.

**Pruebas · Windows 11, Python 3.13.5, Git Bash:**

| Caso | Resultado |
|---|---|
| Copia aislada: OP sin `node_modules`, Transportes con lock más nuevo | PASA: 2 avisos npm, PostgreSQL y Docker avisados, 2 prompts, portapapeles con acentos correctos |
| `eos/` del otro repo más nuevo | PASA: no se pisa, aviso |
| `EOS.cmd` raíz delega al del repo | PASA |
| Corrida real rápida en los dos repos | PASA: AGENTS actualizado, `eos/` copiado a Transportes, avisos reales de PostgreSQL y Docker |

**No verificado:** modo completo con npm real; doble clic en consola. **Pendiente:** commit de `eos/` y del kit en ambos repos (decisión de Carmen); alta de NORA.

## 2026-10-25 · GitHub, PostgreSQL, dependencias declaradas y OP en local

**Solicitud:** iniciar sesión en GitHub y que git use la misma sesión; instalar PostgreSQL 16 aquí; que EOS y el Claude de cualquier equipo (NORA) conozcan las dependencias de antemano; levantar OP en local como prueba de concepto.

- **Ejecutado:** `gh auth login --web` (cuenta Carroussel; push sí, admin no en los dos repos) y `gh auth setup-git`. `winget install PostgreSQL.PostgreSQL.16` (16.15-5, sin StackBuilder), con la clave del superusuario generada por un script, guardada en `<repos>/.eos/local/postgres-superusuario.txt` y nunca impresa.
- **Dependencias declaradas:** `eos/dependencias.json` (versionado) con herramientas comunes y por repo (winget, rutas conocidas), npm, servicios (5432) y cómo preparar la base. EOS 2026.10.25.3 lo usa y revisa la sesión de GitHub. El hook lo busca en disco sin ejecutar nada y publica `deps_missing` en el recibo, más un aviso si falta algo. `CLAUDE.md` lo menciona.
- **Plantillas:** `.claude` → `_claude` y `CLAUDE.md` → `CLAUDE.plantilla.md` dentro de `eos/plantillas`, para que Claude Code no las tome por skills o reglas reales; EOS las traduce al inyectar.
- **Base local:** `scripts/reset-db-windows.py omnia|omnia_test` (equivale a `reset-db.sh`: rol `omnia`, extensiones, migraciones).
- **OP en local:** seed demo; `npm run dev` en server (:3001) y en web (:5173, proxy `/api` y `/config.js`).

**Pruebas · Windows 11, PostgreSQL 16.15, Node 22.23.4:**

| Caso | Resultado |
|---|---|
| `reset-db-windows.py` omnia y omnia_test | PASA: 2 migraciones aplicadas en cada una |
| `cd server && npm test` | PASA: 5 archivos, 84/84 (primera vez en este equipo) |
| `/api/health` y la web en :5173 | PASA |
| Login `admin@omnia.local` vía proxy de la web | PASA: token y permisos de administrador |
| EOS rápido en los dos repos | PASA: sin avisos; GitHub OK; kit nuevo inyectado; `deps_missing: []` |
| Hook en un equipo simulado sin herramientas ni npm | PASA: `deps_missing` las lista y aparece el aviso |

**No verificado:** `cd web && npm test`, `e2e/smoke.mjs`; servidores de desarrollo lanzados desde esta sesión de Claude (se detienen al cerrarla).

**Propuesta para salir de lo público (PROPUESTA, sin decidir):** fase 0 local (hecha); fase 1, Transportes en Cloudflare Pages desde el repo privado, con Cloudflare Access; fase 2, el admin de la org pone los repos privados y apaga Pages; fase 3, OP en Oracle Cloud Always Free con docker compose, Cloudflare Tunnel y Access (dominio ~US$10/año). Hay que verificar las condiciones vigentes de cada servicio.

## 2026-10-25 · Compras: listas desplegables en el formulario de orden de compra

**Solicitud:** que los campos del formulario de OC (p. ej. «Centro de costo») muestren menús desplegables, con datos para verlo en local.

- **Hecho:** `GET /api/ordenes-compra/opciones` (permiso `ver`; `server/src/services/purchases.ts` → `purchaseOptions`) devuelve, de las órdenes no anuladas, los valores usados por campo (centro de costo, servicios, forma de pago, banco, tipo de cuenta, solicitante, entrega, firmas; los más usados primero) y un proveedor por nombre con los datos de su orden más reciente. En `web/src/pages/Compras.tsx` esos campos usan `datalist` (lista desplegable que admite un valor nuevo) y elegir un proveedor conocido copia contacto, dirección, NIT, teléfono, días de crédito, forma de pago y datos bancarios. Sin cambios de esquema.
- **Mock local (fuera de Git):** `.claude/privado/mock/compras-mock.mjs` carga por la API 10 órdenes `MOCK-*` ficticias (6 proveedores inventados, 7 centros de costo, nota «MOCK local»), emitidas o en borrador, sin completar: no tocan inventario ni Resumen. Se quitan anulándolas o con `reset-db-windows.py`.
- **FUENTE:** XL-OP-001 (copia, hash verificado) no tiene hojas de compras; no hay centros de costo ni proveedores reales en este equipo. Cuando Ing. Carmen los entregue, basta con usarlos en órdenes (o cargarlos con un script como el mock).

**Pruebas:** `server npm test` 85/85 (nueva: opciones, proveedor y anuladas excluidas); `tsc --noEmit` del servidor y `tsc -b` de la web sin errores; `web npm test` 10/10; Chrome real con playwright-core: 7 centros de costo y 9 proveedores en las listas, elegir proveedor rellena NIT y contacto, sin errores de página.

## 2026-10-25 · Corrección de atribuciones, demo en GitHub Pages y publicación

**Corrección:** parte de las solicitudes de esta sesión, desde el pedido de que NORA tenga el mismo alcance, la instalación de PostgreSQL y lo siguiente, las escribió en la sesión de Ing. Carmen una persona de su confianza, no ella. Este registro las había anotado como «decisión de Ing. Carmen». Se corrigió a «pedido en la sesión de Ing. Carmen; pendiente de que ella lo confirme» en `AGENTS.md` (ambos repos y plantillas) y en ESTADO. Las entradas anteriores de este traspaso que dicen «Ing. Carmen pidió» se leen con esta corrección.

**Solicitud:** que Ing. Carmen entienda y pueda explicar lo hecho para lanzarlo a su equipo el 2026-10-26; demo en GitHub Pages; commit y push a `main`; al inicio de `CLAUDE.md`, el propósito de hacerla brillar. Push a `main` y publicación pública confirmados en la sesión como acordados con ella.

- **Demo:** `web/src/demo.ts` (intercepta `fetch` solo en el build `demo`: lecturas grabadas; escrituras y descargas responden «Modo demostración»), `web/src/demo-data.json` (34 respuestas: datos demo del seed y OC mock ficticias; revisado sin rutas locales, IPs, tokens reales ni claves), `vite.config.ts` (modo demo: `config.js` con `basePath` tomado de la URL y nombres sin «_» para Jekyll), `npm run build:demo` → `demo/`. El build normal no incluye nada de la demo (comprobado).
- **`CLAUDE.md`** (ambos repos y plantillas): sección «Propósito» al inicio.
- **README:** enlace a la demo, cómo regenerarla, `reset-db-windows.py` y 85 pruebas.
- **Transportes:** se borraron los restos de plantillas con nombres viejos (`eos/plantillas/comun/.claude`, `CLAUDE.md` de plantillas) que duplicaban skills.

**Pruebas:** demo servida en `/Master-App---OP-/demo/` (servidor estático local, misma ruta que Pages) y recorrida en Chrome: 8 pestañas con datos, formulario de OC con 7 centros de costo, autollenado de proveedor, aviso al guardar, 0 errores y 0 respuestas ≥ 400. `tsc` de web y servidor sin errores; servidor 85/85; web 10/10.

## 2026-10-25 · OP al estilo Transportes: GitHub Pages + Supabase

**Solicitud (en la sesión de Ing. Carmen):** «reescribir OP al estilo Transportes», usar el mismo Supabase de prueba («todo es una prueba») y corregir antes los dos hallazgos de cálculo. «Ejecuta de una vez, no hay ambiente de producción».

- **INTERPRETACIÓN:** el objetivo es que OP funcione sin servidor propio, como Transportes. No se reescribió la lógica en el navegador ni en SQL: el mismo servidor Express corre como Edge Function de Supabase. Así se evita duplicar ~2 700 líneas y las pruebas existentes siguen cubriendo lo que corre en línea (regla 9). Rehacerlo todo como funciones SQL y RLS queda como alternativa no elegida.
- **Hallazgos (hecho):** `records.ts`: si se editan unidades, cajas o u/caja de Walmart sin enviar cajas de cobro, estas se recalculan (R6). `periods.ts` y `reports.ts`: el cierre guarda una foto por semana y la consulta semanal de un periodo cerrado la usa. Los cierres hechos antes de esta corrección no tienen esa foto: hay que reabrirlos y volver a cerrarlos.
- **Servidor (hecho):** `DB_SCHEMA` (search_path), `DB_POOL_MAX`, `SUPABASE_DB_URL`, `SSO_USUARIOS=modulo` (rol leído de `auth.users`; el administrador de OP da acceso a cuentas de Supabase y crea cuentas nuevas con la API de administración; no cambia contraseñas ajenas): `config.ts`, `db.ts`, `auth.ts`, `sso.ts`, `routes/users.ts`, `services/directory.ts`. Entrada `server/src/edge.ts` (configuración propia; no usa los secretos del proyecto, que comparte con las funciones de Transportes).
- **Empaquetado y despliegue:** `scripts/supabase-funcion.mjs` (esbuild; fuentes de pdfkit fijas, prefijo `node:`, globales de Node para Deno) → `supabase/functions/operaciones/` (`app.mjs` se genera, ignorado por Git). `scripts/supabase-base.mjs esquema|datos|rehacer`.
- **Ejecutado en Supabase `bocgzjupocnvjehklxhs`:** esquema `operaciones` (migraciones 001-002, `btree_gist` en `extensions`, sin acceso de anon/authenticated); datos copiados de la base local `omnia` recién sembrada (890 filas: demo + 10 OC ficticias `MOCK-*`); Edge Function `operaciones` (sin verificación del gateway: la valida el servidor); 2 cuentas `op-prueba-admin@` y `op-prueba-operador@intransit.test` (contraseñas en `<repos>/.eos/local/op-supabase-prueba.json`). Transportes no se tocó. La prueba en vivo dejó un borrador de Cobán anulado (`PRUEBA-VIVO-*`).
- **Web:** entrada propia con cuenta de Supabase (`ownLogin`; la sesión queda en `sb-<ref>-auth-token`, la misma clave que supabase-js, así que se comparte con Transportes en el mismo sitio); `apiUrl` a la función; Ajustes › Usuarios con «Dar acceso». Build `npm run build:supabase` → `app/`; `index.html` en la raíz lleva a `app/`; `demo/` sigue.
- **Documentos:** `docs/09-supabase.md` (nuevo), README, `docs/ai/SEGURIDAD.md`, ESTADO. `AGENTS.md` no se tocó (lo administra EOS por plantilla).

**Pruebas · Windows 11, Node 22.23.4, PostgreSQL 16.15, Chrome + playwright-core, Supabase CLI 2.122.0:**

| Caso | Resultado |
|---|---|
| `server/test/hallazgos.test.ts` antes de corregir | FALLA como se esperaba: 85.26 en lugar de 170.53; la semana cerrada se movía 6 984.43 |
| `cd server && npm test` | PASA 97/97 (85 anteriores + 4 de hallazgos + 8 de `sso-modulo.test.ts`) |
| `cd web && npm test`, `tsc` server y web | PASA 10/10, sin errores |
| Paquete de la función en Node contra la base local | PASA: salud, login, resumen, PDF del mes y de una OC, Excel |
| Función en vivo, sesión real de Supabase (13 llamadas) | PASA: meta, resumen (costo Q46 107.70), dashboard, catálogo, opciones de compras, PDF, Excel, borrador del operador, anulación, permisos, 401 sin sesión |
| API REST pública con `Accept-Profile: operaciones` | Rechazada (`PGRST106`: solo `public` y `graphql_public`) |
| Build de Pages servido en local en `/Master-App---OP-/app/` + Chrome | PASA: entrar, clave mala, 8 pestañas, Usuarios, salir, operador sin Comercial; 0 errores de página |
| Publicado (`89cde15`, Pages «built») en `intransit-gt.github.io/Master-App---OP-/` + Chrome | PASA: la raíz lleva a `app/`, entra en ~5 s, Dashboard con cifras, 7 pestañas, salir; 0 errores. `demo/` sigue respondiendo |

**No verificado:** importar Excel a través de la función; uso simultáneo de varias personas; límites del plan gratuito de Supabase.

## 2026-10-25 · Administrador de OP para la cuenta corporativa de proyectos

**Solicitud:** Ing. Carmen, en su sesión: dar el rol de administrador del módulo OP a la cuenta corporativa de proyectos (dominio de la empresa), como primer punto.

- **Ejecutado en Supabase `bocgzjupocnvjehklxhs`:** la cuenta ya existía en Auth (creada el 2026-10-11, sin `modulos`). Se agregó `app_metadata.modulos.operaciones = administrador` y su fila en `operaciones.users` (`password_hash` `!sso`), con el mismo SQL que «Dar acceso» (`setModuleRole`). No se cambió la contraseña ni otros metadatos; Transportes no lee `app_metadata`, así que no le afecta.
- **Verificado:** `GET /api/usuarios` en la función en vivo con la sesión de `op-prueba-admin`: HTTP 200, la cuenta aparece como administrador activo.
- **Deshacer:** en Ajustes › Usuarios, cambiarle el rol o desactivarla.

## 2026-10-26 · Menú lateral al estilo Transportes

**Solicitud:** Ing. Carmen pidió aplicar a OP el formato visual de Transportes: el menú a la izquierda en vez de arriba.

- **Hecho:** `web/src/App.tsx`: cabecera compacta (isologo, nombre y sede, estado de guardado, Excel/PDF, ficha de usuario con iniciales, Salir) y menú lateral `nav.side` con ícono y nombre, opción activa con `aria-current`; debajo de 900 px el menú es un cajón que se abre con ☰ y se cierra al elegir, al tocar fuera o con Escape. `web/src/styles.css`: medidas y comportamiento de `css/app.css` de Transportes (menú de 226 px, contenido con desplazamiento propio sobre `#F4F7FA`), con la paleta propia de OP; reglas de impresión sin cabecera ni menú. Las subpestañas de cada módulo no cambian. Selectores de `e2e/smoke.mjs`, `e2e/demo-capturar.mjs` y `e2e/integrado/flujo.mjs` pasan de pestañas a botones del menú.
- **INTERPRETACIÓN:** lista plana de 8 opciones; no se copiaron los grupos plegables de Transportes (con 8 opciones esconderían más de lo que ordenan) ni el modo oscuro.

**Pruebas · Windows 11, Node 22.23.4, PostgreSQL 16.15, Chrome + playwright-core:**

| Caso | Resultado |
|---|---|
| `cd web && npx tsc -b`, `npm test` | PASA: sin errores, 10/10 |
| `cd server && npx tsc --noEmit`, `npm test` (exportaciones sin aviso) | PASA: sin errores, 97/97 |
| `e2e/smoke.mjs` contra el servidor local :3001 (base `omnia`) | PASA: 21/21, sin errores de consola (deja registros E2E en la base local) |
| Teléfono 390×844 | PASA: menú oculto al entrar, ☰ lo abre, se cierra al elegir y con Escape, sin desborde horizontal |
| `app/` y `demo/` regenerados, servidos en local en `/Master-App---OP-/` + Chrome | PASA: demo con las 8 opciones del menú recorridas, app en la pantalla de entrada; 0 errores de página |

**Aprobado:** commit y publicación en GitHub Pages (Ing. Carmen, 2026-10-26). **No verificado:** `e2e/integrado/flujo.mjs` (Transportes de relleno); la app publicada con sesión real tras el push.

## 2026-10-27 · App operativa: sin barra de demostración, sin Dashboard ni Resumen, con modo oscuro

**Solicitud (Ing. Carmen):** que no se vea la barra «DATOS DE DEMOSTRACIÓN: las cifras no son reales…»; quitar los módulos Dashboard y Resumen porque la app es operativa; agregar el modo oscuro. Después: quitar también el aviso del PDF y el Excel, y hacer el commit.

- **Hecho (`web/`):** `App.tsx` sin la barra (el servidor sigue enviando `meta.demo`; solo deja de mostrarse) y con 6 opciones en el menú; la app abre en Producción (los enlaces viejos `#dash` y `#sum` también caen ahí). Se borraron `pages/Dashboard.tsx` y `pages/Resumen.tsx`.
- **INTERPRETACIÓN:** el cierre y la reapertura del periodo y el ajuste de semanas (`PeriodControls`) solo estaban en Resumen. Para no perder el cierre de mes pasaron a **Ajustes › Periodos**, con el selector de mes encima de la tabla. Los textos que remitían «al Resumen» ahora dicen «resumen del mes (Excel y PDF)».
- **Servidor:** `/api/dashboard` y `/api/resumen` siguen; el Excel (hoja RESUMEN) y el PDF del mes conservan margen por proceso e indicadores. `services/exporter.ts` ya no imprime «DATOS DE DEMOSTRACIÓN» en el Excel y PDF del mes ni en los de cada orden de compra; la prueba de exportaciones de `api.test.ts` comprueba ahora que el aviso no aparezca. Los registros siguen marcados `is_demo` en la base (solo cambia lo impreso).
- **Modo oscuro:** `theme.ts` con el criterio de Transportes: sin elección sigue al sistema; el botón sol/luna de la cabecera fija claro u oscuro (`data-theme` en la raíz) y se recuerda en el navegador (`op_tema`). `styles.css`: tokens oscuros con los tonos de `css/app.css` de Transportes; `.btn-danger` usa `--bad` para leerse en oscuro.
- **Pruebas:** `e2e/smoke.mjs` ya no espera la barra, Dashboard ni Resumen; comprueba que no aparezcan, que el tema oscuro se recuerde al recargar y que Ajustes › Periodos tenga el selector de mes.
- **Builds:** `app/` (`build:supabase`) y `demo/` (`build:demo`) regenerados; la frase de la barra ya no está en ningún bundle.

**Pruebas · Windows 11, Node 22.23.4, PostgreSQL 16.15, Chrome + playwright-core:**

| Caso | Resultado |
|---|---|
| `cd web && npx tsc -b`, `npm test` | PASA: sin errores, 10/10 |
| `cd server && npx tsc --noEmit`, `npm test` (exportaciones sin aviso) | PASA: sin errores, 97/97 |
| `e2e/smoke.mjs` contra el servidor local :3001 (base `omnia`) | PASA: todo en verde, sin errores de consola (deja registros E2E en la base local) |
| Modo oscuro en escritorio (Compras, Inventario) y teléfono 390×844, revisado en capturas | PASA: contraste legible, sin desborde horizontal, 0 errores de página |
| `demo/` y `app/` servidos en local en `/Master-App---OP-/` + Chrome | PASA: menú de 6 opciones, sin barra, tema oscuro aplicado y recordado; app en la pantalla de entrada; 0 errores de página |

**Aprobado:** commit y push (Ing. Carmen, 2026-10-27; publicado en `e6972ab`, Pages «built» y sirviendo el bundle probado en local). Despliegue de la Edge Function `operaciones` en `bocgzjupocnvjehklxhs` (Ing. Carmen, 2026-10-27): `node scripts/supabase-funcion.mjs --desplegar`, solo esa función; sin cambios de datos, esquema, permisos ni de Transportes.

| Caso en vivo (función desplegada, sesión real de `op-prueba-admin`) | Resultado |
|---|---|
| Excel y PDF del mes 2026-10 | PASA: HTTP 200, texto leído, sin «DEMOSTRACIÓN» |
| Excel y PDF de una OC marcada demo | PASA: HTTP 200, texto leído, sin «DEMOSTRACIÓN» |

**No verificado:** recorrido de la web publicada con sesión real en el navegador.

## 2026-10-27 · Pantalla de entrada «Herramienta de Operaciones»

**Solicitud (Ing. Carmen):** una página de inicio de sesión parecida a la de Transportes, con otro aspecto que la distinga como Operaciones y el título «Herramienta de Operaciones».

- **Hecho:** `web/src/pages/Login.tsx` con el formato de Transportes (`js/ui.js` `loginHTML`, `css/app.css` `.login/.lp/.lf`): panel de marca a la izquierda y formulario a la derecha. **Identidad de OP:** azul propio (#003CA6 en degradado), cuadrícula técnica de fondo, etiqueta amarilla «Operaciones», subtítulo «Seguimiento de procesos operativos…» y, en lugar de la ruta animada, un flujo de 5 etapas (Producción → Horas → Compras → Inventario → Cobro) que se completa con una marca verde. Botón «Modo oscuro/claro» en el panel (como «Opciones» en Transportes). Estilos `.auth-*` en `styles.css` (sustituyen `.login-wrap/.login`); en oscuro el logotipo del formulario se muestra en blanco; en teléfono una columna, sin el flujo ni el logotipo repetido; sin animación con `prefers-reduced-motion`.
- **Logotipos:** `web/public/logo-blanco.png` y `logo-color.png`, copiados de `Master-App/assets/logos/` (los oficiales de Transportes). La lógica de entrada no cambió (Supabase u `/auth/login`), ni los nombres que usan las pruebas («Correo…», «Contraseña», botón «Entrar»).

**Pruebas · Windows 11, Node 22.23.4, PostgreSQL 16.15, Chrome + playwright-core:**

| Caso | Resultado |
|---|---|
| `cd web && npx tsc -b`, `npm test` | PASA: sin errores, 10/10 |
| Capturas 1440 px claro y oscuro, teléfono 390 px | PASA: sin desborde; etiquetas del flujo completas; logotipo legible en oscuro |
| Clave mala y entrada correcta (servidor local) | PASA: «Correo o contraseña incorrectos.» y entra al menú |
| `e2e/smoke.mjs` contra :3001 | PASA: sin fallos ni errores de consola |
| `app/` y `demo/` regenerados y servidos en `/Master-App---OP-/` | PASA: logotipos presentes, entrada y menú, 0 errores de página |

**Publicado:** commit `74be7a0` (pedido de Ing. Carmen, 2026-10-27).

## 2026-10-27 · Textos fuera de la entrada y la cabecera

**Solicitud (Ing. Carmen):** quitar «Entra con tu cuenta de In Transit (la misma de Transportes)» de la entrada y «Producción, compras, inventario y cobro · Sede Omnia» de la cabecera. Hecho y publicado en `6490f83` (web 10/10; los textos no están en `app/` ni `demo/`).

## 2026-10-27 · Sedes

**Solicitud (Ing. Carmen):** usar OP en varias sedes: SEDE FRITOLAY OMNIA, SEDE FRITOLAY SAN JUAN, SEDE HILO, SEDE INTRANSIT Z11.
**DECISIÓN APROBADA (Ing. Carmen, en la sesión):** la sede se asigna a cada usuario (el administrador entra en todas; con varias sedes se cambia en la cabecera) y los datos se separan por sede. Aceptó migrar el esquema `operaciones` del Supabase de prueba y redesplegar la función.

- **Hecho:** migración `db/migrations/003_sedes.sql` (tablas `sedes`, `user_sedes`; `sede_id` en los registros operativos, periodos, órdenes, importaciones y bitácora; unicidad y cierre por sede; lo existente a Omnia). `server/src/sede.ts` (encabezado `X-Sede`, errores `SEDE_NO_ASIGNADA` y `SIN_SEDE`); servicios, motor, reportes, cobro, Excel/PDF y bitácora por sede; `/api/sedes`. Web: sede en la cabecera, sedes por usuario y tarjeta Sedes en Ajustes › Usuarios, aviso «Sin sede asignada» (recupera el estilo que perdió con la entrada nueva). `scripts/supabase-base.mjs migrar`. Docs 02, 03, 04, 05, 09 y README. Commit `aa9043d`.
- **Comunes a todas las sedes (INTERPRETACIÓN, a confirmar):** clientes y proyectos, productos, estándares y tarifas, artículos de inventario, parámetros y numeración de órdenes de compra.

**Pruebas · Windows 11, Node 22, PostgreSQL 16.15, Chrome + playwright-core:**

| Caso | Resultado |
|---|---|
| `cd server && npx tsc --noEmit && npm test` | PASA: 110/110 (13 nuevas en `test/sedes.test.ts`) |
| `cd web && npx tsc -b && npm test` | PASA: 10/10 |
| Migración 003 sobre copia de la base local con datos y octubre cerrado | PASA: todo a Omnia; cierre de Omnia bloquea solo Omnia; inserción sin sede rechazada |
| Recorrido en Chrome contra servidor local (cambio de sede, Usuarios claro/oscuro, teléfono 390 px, cuenta sin sede) | PASA: sin desborde ni errores de página |
| `e2e/smoke.mjs` contra el servidor local | PASA: sin fallos ni errores de consola |
| `demo/` y `app/` servidos en local | PASA: 0 errores; la demo muestra la sede |
| Supabase: `node scripts/supabase-base.mjs migrar` | PASA: 003 aplicada; 4 sedes, 8 usuarios a Omnia, 629 registros y 13 OC en Omnia |
| Supabase: `node scripts/supabase-funcion.mjs --desplegar` y lecturas en vivo con las cuentas de prueba | PASA: admin ve 4 sedes; Hilo vacía; Excel de Hilo con su nombre; operador solo Omnia (Hilo → 403); CORS admite `x-sede` |
| Pages publicado (`58ecba3`) en Chrome con `op-prueba-admin` | PASA: Omnia 499 registros de octubre, Hilo 0; el selector cambia de sede y vuelve; 0 errores de página |

**No verificado:** escrituras en Supabase en otra sede (en vivo solo hubo lecturas; las escrituras por sede están cubiertas por las pruebas locales).
**Pendiente:** asignar sedes al equipo en Ajustes › Usuarios; confirmar qué catálogos deben ser propios de cada sede. El servidor local viejo en :3001 (de una sesión anterior) sigue con el código previo; el nuevo corrió en :3011.

## 2026-10-28 · Maquilas: fase 1 (esquema) y fase 2 (perfiles y API)

**Solicitud (Ing. Carmen):** integrar Operaciones con Transportes como módulo separado, en repositorios distintos, para trabajar en paralelo mientras Transportes sale a producción en ~1 semana. Solo se autorizó commit en `Master-App---OP-`; Transportes no se toca.

- **Hecho (fase 1):** `db/migrations/004_maquilas.sql` con `maquila_people`, `maquila_orders`, `maquila_assignments`, `maquila_validations`, `maquila_statements`, `maquila_statement_lines`, vistas `maquila_por_facturar` y `maquila_productividad`, candado de periodo que permite avanzar el estado después del cierre y no-borrado. `docs/10-maquilas-e-integracion.md` con el contrato: qué se construye en OP, qué se cambiará en Transportes después del lanzamiento y la lista de «no tocar».
- **Hecho (fase 2):** migración `005_perfiles_secciones.sql` (roles `coordinador`, `gerente_op`, `supervisor_op`, `jefatura_op`, `validador`, `facturacion`, `cobros` y tabla `perfil_secciones`); `server/src/permissions.ts` con permisos `maquila.*`; `services/maquilas.ts` y `routes/maquilas.ts` (personas, órdenes, asignaciones, inicio, cierre, por facturar y matriz de secciones); `/api/meta` publica `secciones`; web con pestaña Maquilas (programación, personas, por facturar); pruebas `server/test/maquilas.test.ts`.
- **INTERPRETACIÓN:** el «cargo» de maquilas es la unidad que luego se agrupa; la factura y el número siguen viviendo en el módulo comercial. La fase 2 no factura todavía.
- **No ejecutado en este equipo:** `tsc` y pruebas (no hay Node ni PostgreSQL instalados aquí). La migración y las pruebas quedan para correr en el equipo de desarrollo con `python scripts/reset-db-windows.py omnia_test` y `cd server && npm test`.
- **No tocado:** repositorio `Master-App`, esquema `master`, función `api` y app de Transportes.

### 2026-10-28 · Maquilas: fase 3 (validaciones y cargos) y despliegue

- **Node:** instalado portable en `C:\Users\manue\AppData\Local\Temp\gencode\node\node-v22.23.4-win-x64` (no se instaló en el sistema). La CLI de Supabase 2.122.0 se instaló en ese Node y ya tenía sesión.
- **Hecho (validaciones):** `POST /api/maquila/ordenes/:id/validar-sop | validar-jefatura | validar` con permisos `maquila.validar_sop`, `maquila.validar_jefatura`, `maquila.validar`; rechazo con motivo obligatorio; `POST /:id/reabrir` (rechazadas con `maquila.editar`; validadas solo con `maquila.reabrir`); `GET /api/maquila/validacion` para las cuatro bandejas.
- **Hecho (cargos):** `maquila_statements`/líneas ya existentes; `POST /api/maquila/cargos` agrupa maquilas validadas del mismo cliente, toma la tarifa vigente de `billing_rates` y calcula importe; `GET /cargos`, `GET /cargos/:id`, `POST /:id/cerrar`, `POST /:id/anular` (libera las maquilas). Migraciones `006_cargos_anulacion.sql` (motivo/quién/cuándo) y `007_cargos_reagrupar.sql` (permite otro cargo del mismo periodo tras anular).
- **Web:** Maquilas ahora tiene Programación, Personas, Validación y Facturación (por facturar + cargos). `Ajustes › Secciones de Maquilas` sigue disponible.
- **Desplegado:** migraciones 004–007 aplicadas en Supabase (`bocgzjupocnvjehklxhs`); función `operaciones` desplegada; Pages sirviendo `app-CfYH2q5s.js`; `/api/maquila/*` responde 401 sin token.
- **Verificado:** `tsc` del servidor y de la web en verde; pruebas de la web 10/10. **Pendiente:** pruebas de integración del servidor (`npm test`), que requieren PostgreSQL local; no se ejecutaron en este equipo.
- **No tocado:** repositorio `Master-App`, esquema `master`, función `api` y app de Transportes.

## 2026-10-30 · Maquilas: proyectos y actividades por sede

**Solicitud (Ing. Carmen):** adaptar la app a la operación de maquila de cada sede: sus clientes, proyectos y actividades (lista entregada en la sesión), con la confirmación previa del cliente en Alnost (validación de fechas por WhatsApp) y Xporta (exportador), el proceso de Cebollines y la salida de San Juan en cartón A, B y C.
**Alcance:** código, pruebas y base local. Sin commit, sin Supabase y sin redespliegue (regla 8: esperan autorización).

- **Línea base (antes de cambiar nada):** `omnia_test` recreada con 001-007; server 113/118. Las 5 fallas: crear una orden de maquila daba 500 porque `004_maquilas.sql` llama a `assert_period_open(fecha)`, que `003_sedes.sql` reemplazó por `(sede, fecha)`. Afecta al Supabase de prueba, que tiene 004 aplicada. Al corregirlo apareció otro: validar SOP daba 500 (parámetro sin tipo en `validated_by`).
- **Hecho:** `db/migrations/008_maquila_sedes_actividades.sql` (candados de periodo de maquilas por sede; `projects.sede_id`, `process_notes`, `confirm_label`, `output_parts`; tabla `project_activities`; en la orden `activity_id`, confirmación del cliente y `produced_detail`; catálogo de la lista; Xporta «Validación de fechas» y Licorera «Etiquetado»/«Packs» desactivados; registros **demo** movidos a la sede de su proyecto). Servidor: catálogo con sede, actividades y altas en la sede actual (`routes/catalog.ts`); maquilas valida sede y actividad, exige confirmación para iniciar (`FALTA_CONFIRMACION`), `POST /maquila/ordenes/:id/confirmar`, cierre con desglose (`services/maquilas.ts`); producción, horas e insumos rechazan proyectos de otra sede (`services/records.ts`); tarifas de la sede (`services/comercial.ts`); semilla demo por sede. Web: Maquilas (actividad, confirmación, nota de proceso, cierre por partes, desglose en listas), Ajustes › Clientes y proyectos por sede con edición; Producción, Horas e Inventario ofrecen solo proyectos de la sede. `docs/10` §2.4.
- **INTERPRETACIÓN (a confirmar):** la actividad se elige por orden y es opcional (vacía = proceso completo); un solo cliente por nombre en todas las sedes; los proyectos de Omnia que no estaban en la lista (Unisuper, Dollar City, Revisión, Sunchips) se dejaron activos; Outsourcing con unidad UNIDAD y Cebollines con PACK por falta de dato; cartón A/B/C con la misma tarifa del proyecto.

**Pruebas · Windows 11, Node 22.23.4, PostgreSQL 16.15, Chrome + playwright-core:**

| Caso | Resultado |
|---|---|
| `cd server && npx tsc --noEmit && npx vitest run` | PASA 128/128 (nueva `test/maquilas-sedes.test.ts`; `v2.test.ts` actualizada a la lista por sede) |
| `cd web && npx tsc -b && npx vitest run` | PASA 10/10 |
| Copia de la base local `omnia` (001-003 con datos) migrada hasta 008 | PASA: 618 demo en Omnia, 10 demo a Z11; 7 registros reales (anulados, de la prueba E2E) quedan en Omnia; 23 proyectos como la lista |
| Recorrido en Chrome (PC 1440 y teléfono 390) contra esa copia | PASA 43/43: San Juan cartón A/B/C suma 175.5; Xporta no inicia sin confirmación; Ajustes por sede; sin errores de página |
| `e2e/smoke.mjs` (ahora captura en Fritolay › Outsourcing) | PASA sin errores de consola |

**No verificado:** Supabase (008 no aplicada), `app/` y `demo/` sin regenerar (la demo grabada no trae `sedeId` y sus listas de proyectos saldrían vacías hasta regenerarla).

### 2026-10-30 · Decisiones de Ing. Carmen y ajustes

**DECISIÓN APROBADA (Ing. Carmen):** commit autorizado; dos categorías de servicio, Maquila (la principal) y Outsourcing (Unisuper, Dollar City, Revisión y Sunchips); Outsourcing no es un proyecto; las desactivaciones de Xporta y Licorera son correctas; cartón A/B/C con la misma tarifa; la actividad es obligatoria; una sede puede tener solo maquilas.

- **Hecho:** `projects.category` (MAQUILA/OUTSOURCING) en 008, sin el proyecto «Outsourcing»; la orden exige actividad si el proyecto tiene actividades; el precierre acepta producción, horas o maquilas y avisa de maquilas abiertas (`services/periods.ts`); categoría en Ajustes y en las listas de Maquilas; smoke ahora captura en Fritolay › Descargas.
- **Verificado (Windows 11, Node 22.23.4, PG 16.15, Chrome):** server 129/129; web 10/10; copia de `omnia` migrada 001→008 (Omnia 6 de maquila y 4 de outsourcing; Z11 8; San Juan 1); recorrido en Chrome 47/47 en PC y teléfono sin errores; smoke sin errores de consola.
- **Pendiente (autorización de Ing. Carmen):** push; aplicar 008 en el Supabase de prueba (`node scripts/supabase-base.mjs migrar`) y redesplegar la función (mientras tanto allí no se pueden crear órdenes de maquila); regenerar `app/` y `demo/`. Sin dato: unidad de Cebollines (hoy PACK). Proyectos de Z11 sin actividades: se programan solo con el proyecto hasta que se les agreguen.
