# In Transit · Módulo Operaciones

Aplicación web (módulo **Operaciones**) para registrar y controlar la operación de producción (maquila, etiquetado, descargas y otros proyectos por cliente), horas hombre, compras, inventario de insumos y cobro comercial, con cálculo automático de costos y márgenes.

Evolución de «Resultados Omnia (3).html» (HTML con cálculo en el navegador) a una aplicación cliente‑servidor con base de datos central. La primera sede se llama *Omnia*; la app está pensada para replicarse en otras sedes.

Puede usarse **solo** (con su propio login) o como **módulo dentro del servidor común** junto a Transportes ([Master App](https://github.com/INTRANSIT-GT/Master-App)), con los mismos usuarios de Supabase y abriendo el módulo asignado a cada usuario. Ver [`docs/08`](docs/08-modulo-operaciones-e-integracion.md).

> **Estado: prototipo funcional para validación.** Los datos precargados con `npm run seed` son de **demostración** (cada registro lleva la etiqueta `demo`). No usar esas cifras para decisiones.

**▶ [Abrir la app (prueba)](https://intransit-gt.github.io/Master-App---OP-/)**: GitHub Pages + Supabase, como Transportes; se entra con una cuenta de Supabase que tenga el módulo Operaciones y los cambios sí se guardan (datos de demostración). Cómo está armado y cómo actualizarlo: [`docs/09`](docs/09-supabase.md).

**▶ [Ver la demostración sin cuenta](https://intransit-gt.github.io/Master-App---OP-/demo/)**: la web completa con datos de demostración y órdenes de compra ficticias, en modo solo lectura (entra con cualquier correo y clave; los cambios no se guardan).

## Qué incluye

| Módulo | Estado |
|---|---|
| Producción por cliente/proyecto (alta, edición con motivo, anulación; sin borrado) | Operativo |
| Horas y personal, asistencia semanal | Operativo |
| Resumen de costos y margen (reglas R1–R20, validadas contra el HTML original): hoja RESUMEN del Excel y PDF del mes, sin pantalla propia desde el 2026-10-27 | Operativo |
| Compras: órdenes de compra (borrador → emitida → completada/anulada), Excel y PDF | Operativo |
| Inventario: stock, cobertura, insumos, merma, conteo físico | Operativo |
| Comercial: reporte de cobro y tarifas por cliente (solo rol Comercial/Admin) | Operativo |
| Ajustes: catálogos, estándares con vigencia, periodos (semanas, cierre y reapertura), usuarios, bitácora | Operativo |
| Modo claro u oscuro (sigue al sistema; el botón sol/luna de la cabecera lo fija en ese navegador) | Operativo |
| Importación de Excel (contingencia, con vista previa) | Operativo |
| Módulo integrable: ruta base `/operaciones`, acceso por sesión compartida de Supabase, portal selector de módulos, proxy para servidor común | Operativo; probado con Supabase **simulado** (no con uno real) |
| Integración con SAP | **No implementada** (solo campos y tabla `external_refs` preparados) |
| Multisede, recuperación de clave por correo | **No implementados** |

## Tecnologías

React 19 + Vite (web) · Express 5 + TypeScript + zod (API) · PostgreSQL 16 · JWT + bcrypt · exceljs / pdfkit · Vitest + Playwright. Arquitectura y decisiones en [`docs/03-tecnica.md`](docs/03-tecnica.md).

```
web/        interfaz (React)            server/     API y motor de cálculo (Node/TypeScript)
db/         migraciones SQL             docs/       auditoría, funcional, técnica, modelo de datos
e2e/        recorridos en navegador     scripts/    utilidades de desarrollo
deploy/     portal, Caddy/nginx y SQL de asignación de módulos (servidor común)
```

## Instalación y ejecución en desarrollo

Requisitos: **Node 22**, **PostgreSQL 16**.

```bash
# 1) Base de datos local (rol omnia / clave de desarrollo omnia_dev; solo para tu máquina)
scripts/reset-db.sh omnia            # Linux/macOS; en Windows: python scripts/reset-db-windows.py omnia
# 2) API
cd server && npm ci && npm run seed  # catálogos + 5 usuarios demo + datos demo
npm run dev                           # http://localhost:3001
# 3) Web (otra terminal)
cd web && npm ci && npm run dev       # http://localhost:5173
```

Usuarios demo (clave `Omnia2026!demo`): `admin@`, `supervisor@`, `operador@`, `consulta@`, `comercial@omnia.local`. **Solo para demostración.**

## Pruebas

```bash
scripts/reset-db.sh omnia_test
cd server && npm test                 # 97: motor vs. valores dorados del HTML, API, permisos, duplicados, cierres, módulo, sesión compartida y modo Supabase
cd web && npm test                    # 10
# Navegador (con el servidor sembrado sirviendo la web compilada: `cd web && npm run build`, WEB_DIST=../web/dist)
cd e2e && npm i && node smoke.mjs
# Flujo integrado (portal + módulo asignado + Supabase simulado detrás de nginx)
bash e2e/integrado/run.sh
```

## Operaciones como módulo (servidor común con Transportes)

```
https://tu-dominio/               portal: inicia sesión y abre el módulo asignado
https://tu-dominio/transportes/   Master App (estática)
https://tu-dominio/operaciones/   este módulo (BASE_PATH=/operaciones, AUTH_MODE=sso)
```

La asignación de módulos y roles viene de Supabase (`app_metadata.modulos`). Puesta en marcha: `docker-compose.integrado.yml`, `deploy/` y [`docs/08`](docs/08-modulo-operaciones-e-integracion.md). Pendiente: que la Master App también valide la asignación (sección 5 del documento).

## Publicar en GitHub y desplegar son cosas distintas

- **Subir el código a GitHub**: guarda el código fuente y su historial. No pone la app en línea. Pasos en [`docs/06-github-y-despliegue.md`](docs/06-github-y-despliegue.md).
- **Desplegar con servidor propio**: instalar y ejecutar la app en un servidor con PostgreSQL, HTTPS y respaldos (`docker compose up -d --build`, plantilla en `.env.example`).
- **Desplegar sin servidor propio (prueba actual)**: la web en GitHub Pages (`app/`, `npm run build:supabase`) y el mismo servidor como Edge Function de Supabase, con la base en el esquema `operaciones`. GitHub Pages solo sirve los archivos; la parte de servidor la pone Supabase. Ver [`docs/09`](docs/09-supabase.md).
- **Demostración estática** (`demo/`, publicada por GitHub Pages): la web compilada en modo `demo`, que responde la API con respuestas grabadas del servidor local y no guarda cambios. Para regenerarla, con el servidor sembrado y la web en desarrollo: `cd e2e && node demo-capturar.mjs` y luego `cd web && npm run build:demo`.

## Seguridad

Nunca subas `.env`. Antes de producción: definir `JWT_SECRET` (32+ caracteres), claves reales, `CORS_ORIGIN`, TLS en un proxy inverso y respaldos. En producción **no** se cargan usuarios ni datos demo.

## Documentación

[`01-auditoria`](docs/01-auditoria.md) reglas de negocio R1–R20 y pendientes P1–P13 · [`02-funcional`](docs/02-funcional.md) módulos y roles · [`03-tecnica`](docs/03-tecnica.md) arquitectura, API, variables · [`04-migracion-y-pendientes`](docs/04-migracion-y-pendientes.md) · [`05-modelo-de-datos`](docs/05-modelo-de-datos.md) · [`06-github-y-despliegue`](docs/06-github-y-despliegue.md) · [`07-informe-de-entrega`](docs/07-informe-de-entrega.md) · [`08-modulo-operaciones-e-integracion`](docs/08-modulo-operaciones-e-integracion.md)
