# ESTADO · OP (Operaciones)

Actualizado: 2026-10-30 · Claude Code (extensión VS Code, Windows 11)

## Objetivo autorizado
Preparar la configuración local de Claude según el paquete de inicio v1.0. Autorizado por Ing. Carmen el 2026-10-25: clonar OP y Master App, preparar reglas, hook, estado y skill.
Ampliado el 2026-10-25: selector ASCII en EOS (operador, repos, modo), bitácora diaria (privada + resumen público por operador) y skill `intransit-bitacora`, pensado para un segundo operador (NORA, otra PC, pendiente de alta).
Commit y push a `main` de OP y Transportes, y la demo pública en GitHub Pages: pedidos el 2026-10-25 en la sesión de Ing. Carmen (indicado como acordado con ella), para su presentación al equipo del 2026-10-26.
**OP al estilo Transportes (GitHub Pages + Supabase)**, en el Supabase de prueba, corrigiendo antes los 2 hallazgos de cálculo: pedido el 2026-10-25 en la sesión de Ing. Carmen («el mismo, todo es una prueba; ejecuta de una vez, no hay producción»).
**App operativa (2026-10-27, Ing. Carmen):** quitar la barra «DATOS DE DEMOSTRACIÓN», retirar Dashboard y Resumen, agregar modo oscuro; quitar el aviso del PDF y Excel; commit.
**Entrada y sedes (2026-10-27, Ing. Carmen):** entrada «Herramienta de Operaciones» y textos fuera (commit); **sedes** con datos separados y sedes asignadas por usuario, con migración del esquema `operaciones` del Supabase de prueba y redespliegue de la función.
**Maquilas por sede (2026-10-30, Ing. Carmen):** adaptar la app a los clientes, proyectos y actividades de cada sede (lista entregada en la sesión). Commit autorizado y hecho; push, aplicar en Supabase y redesplegar esperan su autorización.
No autorizado: otros cambios en Supabase (nada de Transportes), servidores reales ni otras correcciones de negocio.

## Base
`INTRANSIT-GT/Master-App---OP-` @ `main`. Revisión publicada: ver `git log` (el commit de esta entrada sigue a `aa9043d`).

## Estado comprobado
- **OP en GitHub Pages + Supabase (2026-10-25):** `https://intransit-gt.github.io/Master-App---OP-/` → `app/` (build `npm run build:supabase`). El servidor de `server/` corre como Edge Function `operaciones` (`scripts/supabase-funcion.mjs`). Los datos están en el esquema `operaciones` (`scripts/supabase-base.mjs`): copia de los datos demo y de las 10 OC ficticias. La entrada usa cuentas de Supabase con `app_metadata.modulos.operaciones`. Detalle y cómo deshacerlo en `docs/09-supabase.md`.
- Verificado en vivo: 13/13 llamadas a la API (sesión real, reportes, PDF, Excel, captura, permisos) y recorrido en Chrome del build de Pages servido en local en la misma ruta (8 pestañas, entrar/salir, clave mala, rol operador), sin errores de página.
- **Hallazgos corregidos:** Walmart recalcula las cajas de cobro al editar cantidades; el cierre congela también cada semana. Pruebas en `server/test/hallazgos.test.ts`.
- `cd server && npm test`: **97/97**; `cd web && npm test`: 10/10; `tsc` de server y web sin errores.
- **Administrador de OP (2026-10-25):** la cuenta corporativa de proyectos tiene rol administrador en el módulo (ver TRASPASO).
- **Menú lateral al estilo Transportes (2026-10-26):** cabecera compacta y menú a la izquierda (cajón con ☰ en teléfono), en `app/` y `demo/`. Ver TRASPASO.
- **App operativa (2026-10-27):** sin barra de demostración; menú de 6 opciones (Producción, Horas y personal, Compras, Inventario, Comercial, Ajustes), abre en Producción; cierre y reapertura de periodo en Ajustes › Periodos; modo claro/oscuro; Excel y PDF sin aviso de demostración. Publicado (`e6972ab`) y Edge Function redesplegada; descargas verificadas en vivo. Verificado en local (server 97/97, web 10/10, smoke); `app/` y `demo/` regenerados. Ver TRASPASO.
- **Sedes (2026-10-27):** SEDE FRITOLAY OMNIA, SEDE FRITOLAY SAN JUAN, SEDE HILO, SEDE INTRANSIT Z11. Cada sede ve solo sus registros, periodos, inventario, órdenes, cobro, Excel/PDF y bitácora; catálogos comunes. Administrador en todas; los demás, en las asignadas (Ajustes › Usuarios). Migración `003_sedes.sql` aplicada en local y en Supabase (lo existente a Omnia); función redesplegada y verificada en vivo con lecturas. Server 110/110, web 10/10. Ver TRASPASO.
- **Entrada «Herramienta de Operaciones» (2026-10-27):** publicada (`74be7a0`, `6490f83`).
- **Maquilas por sede (2026-10-30, commit local sin push):** migración `008` (proyectos por sede, categorías Maquila/Outsourcing, actividades obligatorias, confirmación previa del cliente, desglose de salida; corrige el candado de periodo de maquilas que impedía crear órdenes), validación de maquilas corregida y cierre de mes con solo maquilas. Server 129/129, web 10/10, smoke y recorrido en Chrome (PC y teléfono) sin errores. **El Supabase de prueba sigue sin 008: allí no se pueden crear órdenes de maquila.** Ver `docs/10` §2.4 y TRASPASO.
- **Demo estática** en `demo/` (solo lectura, sin cuenta), sigue publicada.
- **OP corre en local:** PostgreSQL 16.15, bases `omnia` (recreada hoy: seed demo + mock de compras) y `omnia_test`; API :3001 y web :5173 en modo dev.
- Kit de Claude, hook, EOS (`eos/`, 2026.10.25.3) y bitácora: ver TRASPASO.
- **Pendiente de prueba en el Claude de Carmen:** `/context`, `/hooks`, reanudación/compactación; EOS con doble clic en consola real.

## Hallazgos heredados (revisión `1793036`)
- ~~Walmart conserva 85.26 cajas cobrables al pasar de 1620 a 3240 unidades~~ corregido 2026-10-25 (170.53).
- ~~Una semana cerrada cambia con el precio de material~~ corregido 2026-10-25 (los cierres anteriores a la corrección no tienen semanas congeladas: hay que reabrirlos y cerrarlos de nuevo).
- La prueba integrada usa un Transportes de relleno (`e2e/integrado/transportes-stub/`).

## Siguiente acción
**Maquilas por sede:** Ing. Carmen autoriza (1) push, (2) aplicar `008` en el Supabase de prueba y redesplegar la función, (3) regenerar `app/` y `demo/`; y confirma la unidad de Cebollines (hoy PACK).
Ing. Carmen asigna las sedes de su equipo en Ajustes › Usuarios y confirma qué catálogos deben ser propios de cada sede (hoy comunes). Revisa la app en Pages con la cuenta `op-prueba-admin@intransit.test` (clave en `<repos>/.eos/local/op-supabase-prueba.json`) y da acceso a su equipo en Ajustes › Usuarios. Confirmar las decisiones tomadas en su sesión (alcance de NORA, PostgreSQL, publicación, OP en Supabase de prueba) y si el Supabase `bocgzjupocnvjehklxhs` tiene datos reales de Transportes (`master.viajes` tiene miles de filas).

## Bloqueos y decisiones
- Repositorio **público** con datos demo de productos y SAP (`docs/06` recomienda privado). Decisión de Ing. Carmen, 2026-10-25: se mantiene público por el momento.
- Supabase `bocgzjupocnvjehklxhs`: declarado **de prueba** por Ing. Carmen; lo comparten Transportes y, desde hoy, OP (esquema y función propios). Las cuentas de Auth son comunes.
- OP no cambia contraseñas de cuentas existentes ni tiene «olvidé mi contraseña» (`docs/09`).
- PostgreSQL 16 instalado (2026-10-25, pedido en la sesión de Ing. Carmen); clave del superusuario en `<repos>/.eos/local/` (fuera de Git, nunca impresa). Docker sigue ausente (opcional).
- GitHub: `gh` con sesión de la cuenta Carroussel (push sí, admin no) y `gh auth setup-git` hecho; repos privados y Pages requieren un admin de `INTRANSIT-GT`.
- NORA (otra PC): **mismo alcance que Carmen** (pedido el 2026-10-25 en la sesión de Ing. Carmen, pendiente de que ella lo confirme; ya en `AGENTS.md`). Su alta en `eos/perfiles.json` sigue pendiente.
