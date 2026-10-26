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
