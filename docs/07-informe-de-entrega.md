# 07 · Informe de entrega

## 1. Qué se recibió (ZIP `intransit-operaciones (1).zip`)
89 archivos: API Node/TypeScript (Express 5, zod, JWT, exceljs, pdfkit), web React 19 + Vite, 2 migraciones PostgreSQL (28 tablas), semillas, 57 pruebas de servidor + 4 de web + recorrido Playwright, Dockerfile/compose y 4 documentos (auditoría R1–R20, funcional, técnica, migración). No era un HTML suelto: ya era un prototipo cliente‑servidor, por lo que **se conservó íntegro el motor de cálculo y las reglas de negocio** y no se reescribió nada.

## 2. Qué se hizo
| Área | Cambio |
|---|---|
| Apariencia | Reescrita `web/src/styles.css` con los tokens del sistema de diseño In Transit: encabezado blanco con logo oficial, azul `#003CA6`, tablas con encabezado azul, botones principal/secundario, estados punto + palabra, una sola sombra, sin emojis, responsivo (probado en 1440, 820 y 390 px). Favicon = isologo oficial. Nombre «In Transit Operaciones» en UI, Excel, PDF y nombres de archivo. |
| Seguridad | `JWT_SECRET` ≥ 32 caracteres en producción; validación de fortaleza del `ADMIN_PASSWORD` inicial. |
| Repositorio | `.gitignore`, `.dockerignore`, `.env.example` completo, CI de GitHub Actions, README nuevo, docs 05–07. |
| Pruebas | Se añadió al recorrido en navegador la verificación de persistencia tras recargar. |

Archivos modificados: `web/src/styles.css`, `web/index.html`, `web/src/App.tsx`, `web/src/pages/Login.tsx`, `web/src/components.tsx`, `web/src/records-ui.tsx`, `web/src/pages/{Ajustes,Compras,Horas,Inventario,Produccion}.tsx` (solo quitar emojis), `web/public/isologo*.png` (nuevos), `server/src/config.ts`, `server/src/seed/seed.ts`, `server/src/routes/reports.ts`, `server/src/services/{exporter,comercial}.ts` (nombre), `e2e/smoke.mjs`, y los archivos de repositorio/documentación listados arriba. El ZIP original se conserva sin tocar.

## 3. Pruebas ejecutadas (Node 22, PostgreSQL 16)
| Prueba | Resultado |
|---|---|
| Typecheck del servidor | Sin errores |
| 57 pruebas del servidor (motor vs. valores dorados del HTML, permisos, duplicados, idempotencia, cierres, importación, órdenes de compra, comercial) | 57/57 |
| 4 pruebas de la web | 4/4 |
| Compilación de producción de la web | OK |
| Recorrido en navegador real (login, Dashboard, Resumen + filtro semana, Inventario, Compras, Horas, Ajustes, alta y anulación de registro, **persistencia tras recargar**, orden de compra, Comercial con rol propio, restricción de acceso por rol) | Completo, **sin errores de consola** |
| Revisión visual de pantallas en escritorio, tablet y móvil | Correcta |
| Rechazo de `ADMIN_PASSWORD` débil | Verificado |
| Escaneo de secretos / correos reales | Sin hallazgos |

## 4. Funciones operativas vs. no operativas
**Operativas (probadas):** todos los módulos de la tabla del README salvo los listados abajo.
**No implementadas / simuladas:** conector SAP (solo campos preparados), multisede, recuperación de clave por correo, productividad del personal de maquila (horas informativas), consumo automático de insumos por caja/tarima. Los datos cargados con `seed` y las tarifas de Coca Cola, Alnost, XPORTA y Licorera son ficticios.

## 5. Pendientes y riesgos
1. **Docker no probado** (sin servicio Docker en el entorno): ejecutar `docker compose up --build` en un entorno de prueba antes de producción.
2. **Reglas pendientes de validación con Operaciones/Finanzas:** P3 (divisor Walmart 19), P4 (64 de crackets), P6 (rubro de merma), P12 (TT/tarifas vacías), P13 (datos personales). No se inventó ninguna.
3. Tipografía: Avenir Next es licenciada; sin ella cae en Nunito Sans (Google Fonts) y luego Arial.
4. 2 avisos moderados de `npm audit` (uuid vía exceljs), no explotables en este uso (ver `docs/03`).
5. Credenciales de desarrollo (`omnia_dev`, `Omnia2026!demo`) existen en el repositorio por diseño, solo para entorno local/demo.

## 6. Pasos para ti
1. Revisar la app: `docs/06` (sección C si usas Windows) o pedirme que prepare un entorno de demostración.
2. Validar P3–P13 con Operaciones/Finanzas y completar catálogos (P12).
3. Crear repositorio **privado** en GitHub y subir con los comandos de `docs/06` (los ejecutas tú).
4. Desplegar en un servidor con HTTPS y respaldos (`docs/06` B + `docs/03`).

---

## Adenda · Versión módulo (Operaciones + Transportes en un servidor)

**Pedido:** que la app sea el módulo «Operaciones», integrable con Transportes (Master App) en el mismo servidor, y que cada usuario abra el módulo que tiene asignado.

**Hallazgo:** la Master App es una PWA estática (HTML/JS) con Supabase Auth, una función Edge como API y perfiles ADMIN, ENCARGADO, TORRE, LIQUIDACIONES, COMERCIAL y GERENCIA; no es Next.js ni define «módulos». Se definió un contrato nuevo: `app_metadata.modulos` en el token de Supabase.

| Cambio | Detalle |
|---|---|
| Módulo | Ruta base `BASE_PATH`, manifiesto `/api/modulo`, `config.js` sin secretos, router montable (`createOperacionesRouter`). |
| Acceso | `AUTH_MODE=sso`: valida el token de Supabase, módulo y rol; alta automática del usuario local; renovación de sesión en el navegador; pantallas «Módulo no asignado» y similares; botón «Módulos». |
| Portal | `deploy/portal`: login con Supabase y apertura del módulo asignado (directo si es uno, selector si son varios). |
| Servidor común | `deploy/Caddyfile`, `deploy/nginx.conf`, `docker-compose.integrado.yml`. |
| Supabase | `deploy/supabase/asignar-modulos.sql` (asignar y quitar módulos, solo `service_role`). |
| Pruebas | Servidor 84 (antes 57), web 10 (antes 4), recorrido integrado con nginx real (20 comprobaciones) y recorrido original en modo independiente: todo pasa. |
| Error corregido en el camino | `/operaciones/` se redirigía a sí mismo (ciclo); detectado por el recorrido en navegador, corregido y con prueba. |
| Documentación | `docs/08` (nuevo), README, `.env.example`, docs 02, 03 y 06. |

**No hecho / pendiente:** modificar la Master App (que valide `transportes` en la interfaz y, sobre todo, en su función Edge; ver `docs/08` §5); probar contra un proyecto Supabase real; probar Caddy y Docker (no disponibles en el entorno de desarrollo); mover los datos de Operaciones a Supabase (fase 2).
