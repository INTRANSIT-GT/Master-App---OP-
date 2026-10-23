# 03 · Documentación técnica

## Arquitectura
`web/` (React 19 + Vite) → `server/` (Express 5, zod, JWT, exceljs, pdfkit) → PostgreSQL 16.
Motor de cálculo en `server/src/engine/` (puro, sin BD; réplica documentada de las reglas R1–R20). Servicios en `server/src/services/`, rutas en `server/src/routes/`. Migraciones SQL versionadas en `db/migrations/` (tabla `schema_migrations`).

## Base de datos (resumen)
users, process_lines, products, standards (EXCLUDE gist: sin vigencias solapadas), settings, inv_items, bag_usage, material_labels, inventory_counts, import_batches, production_records, hours_records, attendance, requirements, inventory_scrap, incidents, periods, audit_log, idempotency_keys, external_refs (puente SAP).

## API (prefijo `/api`)
auth/*, produccion, horas, requerimientos, merma (+ `/:id/anular`, `/:id/confirmar`), asistencia/:lunes, inventario/conteo(s), catalogo (+productos, estandares, items, bolsa, materiales), ajustes, meta, resultados, resumen, inventario, dashboard, periodos (+precierre, cerrar, reabrir, semanas), auditoria, exportar/excel|pdf, importar (+vista-previa, /:id/aplicar), usuarios.
Errores: 400 validación, 401/403 auth/permisos, 409 duplicado/versión, 423 periodo cerrado.

## Variables de entorno
| Variable | Uso | Defecto |
|---|---|---|
| DATABASE_URL | conexión PostgreSQL | local dev |
| JWT_SECRET | **obligatoria en producción, mínimo 32 caracteres** | — |
| JWT_TTL_HOURS | vigencia del token | 10 |
| PORT | puerto | 3001 |
| CORS_ORIGIN | origen permitido | http://localhost:5173 |
| WEB_DIST | carpeta del build web | ../web/dist |
| ADMIN_EMAIL / ADMIN_PASSWORD | administrador inicial (`seed --catalog`) | — |
| DEMO_PASSWORD | clave de usuarios demo | Omnia2026!demo |
| BASE_PATH | ruta del módulo (`/operaciones` integrado; vacío solo) | vacío |
| AUTH_MODE | `local` o `sso` (sesión compartida de Supabase) | local |
| SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY | solo `sso`; emisor esperado y clave pública | — |
| SUPABASE_JWT_SECRET | solo `sso` con firma HS256; si falta se usan las claves públicas (JWKS) | — |
| SUPABASE_STORAGE_KEY / PORTAL_URL | clave de la sesión compartida y destino del selector | `sb-<ref>-auth-token` / `/` |

## Seguridad
bcrypt, bloqueo tras 5 intentos (15 min), rate limit en login, `token_version` para invalidar sesiones, helmet/CSP, permisos en backend. Poner TLS en un proxy inverso (nginx/Caddy).

## Despliegue y respaldos
`docker compose up -d --build` (ver README). Respaldo diario:
```bash
docker compose exec db pg_dump -U omnia -Fc omnia > omnia_$(date +%F).dump
# restaurar: docker compose exec -T db pg_restore -U omnia -d omnia --clean < omnia_YYYY-MM-DD.dump
```
Conservar 30 días y probar restauración periódicamente. Actualizar: `git pull && docker compose up -d --build` (las migraciones corren al arrancar).

## Pruebas
Ver README. Cubren paridad con el HTML, permisos, duplicados, idempotencia, cierre/reapertura, importación y un smoke de navegador.

## Cambios de la v2 (Intransit Operaciones)
- **Migración** `db/migrations/002_clientes_compras_comercial.sql`: `clients`, `projects` (`kinds[]` mapea a los tipos del motor; los proyectos nuevos usan el tipo genérico `gen`), `project_id` en producción/horas, `supply_movements` (insumos), `counters`, `purchase_orders` + `purchase_order_lines`, `requirements.po_line_id`, `billing_rates` (vigencia diaria, sin traslapes) y triggers `trg_no_delete` (los registros no se pueden borrar → HTTP 409 `NO_BORRABLE`).
- **Órdenes de compra** (`services/purchases.ts`): borrador → emitida → completada | anulada. Completar genera `requirements` (etiqueta/ribbon/bolsa/directo/otro, importe × tipo de cambio a Q) y `supply_movements` de ingreso; anular una OC completada revierte ambos. Las filas ligadas a una OC no se editan directo (409 `BLOQUEADO`). Número = prefijo + consecutivo por prefijo. Exporta Excel (exceljs) y PDF (pdfkit).
- **Comercial** (`services/comercial.ts`): `/comercial/cobro?semana|mes&clientId` (+ `/excel`), `/comercial/tarifas`. Fritolay sale del motor por línea→proyecto; otros clientes = cantidad × tarifa vigente por día; sin tarifa → N/D y no suma.
- **Filtro por semana**: `weekPeriod()` construye un periodo de una semana; `?semana=AAAA-MM-DD` en `/dashboard`, `/resumen`, `/inventario`. Las semanas suman el mes (prueba incluida).
- **Retirados** del motor y la importación: horas de coordinador/administración, Outsourcing y Entregas Villanueva; módulo Resultados eliminado. Horas de maquila (`maqp`) son informativas.
- Permisos nuevos: `compras.crear|gestionar|completar`, `comercial.ver|tarifas`; rol `comercial`.
- Pruebas: 57 en servidor (golden contra la lógica del HTML con las líneas retiradas filtradas + `v2.test.ts`), recorrido Playwright en `e2e/smoke.mjs`.

## Cambios de la versión de entrega (apariencia, endurecimiento, repositorio)
- Interfaz rediseñada con los tokens del sistema de diseño In Transit (`web/src/styles.css`): sin cambios en la lógica ni en el motor de cálculo.
- `JWT_SECRET` < 32 caracteres impide arrancar en producción; `ADMIN_PASSWORD` débil (< 10 caracteres o sin letras y números) aborta el sembrado inicial.
- Añadidos `.gitignore` ampliado, `.dockerignore`, `.env.example` completo y CI de GitHub Actions (`.github/workflows/ci.yml`).
- Vulnerabilidades conocidas: `npm audit` reporta 2 avisos *moderados* de `uuid` (dependencia transitiva de `exceljs`, solo explotable al pasar un buffer propio a uuid v3/v5/v6, que la app no hace). El arreglo automático implica degradar `exceljs`; se deja anotado para revisar al actualizar.

## Versión módulo (ruta base, sesión compartida, portal)
- `createOperacionesRouter()` (`server/src/app.ts`) agrupa API, `config.js`, manifiesto y web; `createApp()` lo monta en `BASE_PATH`. También puede montarse dentro de otro servidor Express.
- Rutas públicas bajo la ruta base: `/api/health`, `/api/modulo` (manifiesto), `/config.js` (configuración sin secretos). El resto de `/api` exige token.
- `server/src/sso.ts` valida con `jose` firma, vigencia, emisor (`<SUPABASE_URL>/auth/v1`) y audiencia `authenticated`, y lee `app_metadata.modulos`. `auth.ts` refleja al usuario en `users` (contraseña `!sso`, no inicia sesión local).
- Errores nuevos: 403 `MODULO_NO_ASIGNADO`, `ROL_INVALIDO`, `USUARIO_INACTIVO`; 400 `SESION_EXTERNA`; 409 `GESTION_EXTERNA`.
- Web: `module.ts` (configuración), `sso.ts` (lectura y renovación de la sesión de Supabase), build con `base: './'`. CSP: `connect-src` incluye la URL de Supabase solo en modo `sso`.
- Integración completa: `docs/08-modulo-operaciones-e-integracion.md`.
