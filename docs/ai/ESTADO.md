# ESTADO · OP (Operaciones)

Actualizado: 2026-10-25 · Claude Code (extensión VS Code 2.1.310, Windows 11)

## Objetivo autorizado
Preparar la configuración local de Claude según el paquete de inicio v1.0. Autorizado por Ing. Carmen el 2026-10-25: clonar OP y Master App, preparar reglas, hook, estado y skill.
Ampliado el 2026-10-25: selector ASCII en EOS (operador, repos, modo), bitácora diaria (privada + resumen público por operador) y skill `intransit-bitacora`, pensado para un segundo operador (NORA, otra PC, pendiente de alta).
Commit y push a `main` de OP y Transportes, y la demo pública en GitHub Pages: pedidos el 2026-10-25 en la sesión de Ing. Carmen (indicado como acordado con ella), para su presentación al equipo del 2026-10-26.
No autorizado: cambios en Supabase, migraciones en servidores reales, despliegues de servidor ni corrección de defectos de negocio.

## Base
`INTRANSIT-GT/Master-App---OP-` @ `main` `1793036752e7926a806cd486b8e5f8b66b0802aa`. Los archivos de esta configuración están **sin commit**.

## Estado comprobado
- Preparados: `AGENTS.md`, `CLAUDE.md`, `docs/ai/*`, `scripts/intransit-startup.cjs`, `.claude/settings.json`, `.claude/skills/intransit-trazabilidad/`, `.gitignore`.
- Script del hook probado a mano con entradas sintéticas (ver TRASPASO).
- Hook ejecutado por Claude Code en sesión real (startup, 2026-10-25): recibo correcto, `missing: []`.
- Hook nuevo con `operator` y `log` (bitácora) inyectado por EOS en OP y Transportes; probado (ver TRASPASO).
- EOS vive en `eos/` de ambos repos (versión 2026.10.25.3); lee `eos/dependencias.json`, revisa GitHub (`gh` + `setup-git`) y el puerto 5432, y deja el prompt de sincronización en `.claude/privado/sync.md` y el portapapeles. El recibo del hook trae `deps_missing`.
- **Demo estática** en `demo/` (build `npm run build:demo` con respuestas grabadas por `e2e/demo-capturar.mjs`; solo lectura, sin servidor), publicada por GitHub Pages.
- **Compras:** listas desplegables y autollenado de proveedor en el formulario de OC (`/ordenes-compra/opciones`).
- **OP corre en local (2026-10-25):** PostgreSQL 16.15 (servicio `postgresql-x64-16`, automático), bases `omnia` y `omnia_test` con `scripts/reset-db-windows.py`, seed demo; `cd server && npm test`: 84/84 PASA; API :3001 y web :5173 en modo dev; login demo admin OK.
- **Pendiente de prueba en el Claude de Carmen:** `/context`, `/hooks`, reanudación/compactación; EOS con doble clic en consola real.

## Hallazgos heredados (revisión `1793036`, sin revalidar; no corregir sin encargo)
- Al editar Walmart de 1620 a 3240 unidades se conservan 85.26 cajas cobrables en vez de 170.53 (`server/src/services/records.ts`).
- Una semana cerrada (frozen) cambia su resultado al editar el precio de material (`server/src/services/reports.ts`, `server/src/routes/catalog.ts`).
- La prueba integrada usa un Transportes de relleno (`e2e/integrado/transportes-stub/`).

## Siguiente acción
Ing. Carmen presenta OP a su equipo con la demo `https://intransit-gt.github.io/Master-App---OP-/demo/` (solo lectura) y la guía de lanzamiento. Confirmar las decisiones tomadas en su sesión sin ella (alcance de NORA, PostgreSQL, publicación) y decidir la propuesta para salir de lo público (TRASPASO, 2026-10-25).

**Diagnóstico PWA (2026-10-25, solo lectura):** GitHub Pages está activo en los dos repos (modo rama, builds OK). Transportes es estático y sí se ve en `intransit-gt.github.io/Master-App/`. OP no puede verse en Pages: es React + Express + PostgreSQL; Pages solo sirve archivos estáticos y, sin `index.html` en la raíz, publica el README procesado por Jekyll. `docs/06` pide VPS con Docker, dominio y HTTPS.

## Bloqueos y decisiones
- Repositorio **público** con datos demo de productos y SAP (`docs/06` recomienda privado). Decisión de Ing. Carmen, 2026-10-25: se mantiene público por el momento.
- Supabase `bocgzjupocnvjehklxhs`: declarado **de prueba** por Ing. Carmen; Master App lo usa en su código. Confirmar si contiene datos reales (ver `SEGURIDAD.md`).
- El remoto no tiene `.gitignore`; se agregó uno local (sin commit).
- PostgreSQL 16 instalado (2026-10-25, pedido en la sesión de Ing. Carmen); clave del superusuario en `<repos>/.eos/local/` (fuera de Git, nunca impresa). Docker sigue ausente (opcional).
- GitHub: `gh` con sesión de la cuenta Carroussel (push sí, admin no) y `gh auth setup-git` hecho; repos privados y Pages requieren un admin de `INTRANSIT-GT`.
- NORA (otra PC): **mismo alcance que Carmen** (pedido el 2026-10-25 en la sesión de Ing. Carmen, pendiente de que ella lo confirme; ya en `AGENTS.md`). Recibe EOS con el repo (`eos/`, sin commit todavía); su alta en `eos/perfiles.json` sigue pendiente.
