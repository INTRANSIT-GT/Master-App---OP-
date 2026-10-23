# 01 · Auditoría de «Resultados Omnia (3).html»

Fuente auditada: archivo único HTML (~800 KB; ~190 KB de lógica y estilos + un snapshot de datos embebido `BUNDLE` y logo/fotos).
Esta auditoría se hizo leyendo el código fuente completo. Cada regla indica su función de origen para poder compararla con la versión nueva (ver `tests/`).

## 1. Qué es hoy la aplicación

Aplicación 100 % cliente. No hay servidor. El flujo actual es:

1. Alguien sube dos Excel: **Estatus diario** y **Estatus outsourcing**.
2. El navegador los lee con un lector de xlsx propio (`parseED`, `parseOUT`).
3. Se completan a mano las tablas de **Captura** (etiquetado, noche, Quaker, Sunchips, crackets, horas de impresión y coordinador, asistencia).
4. Todo se calcula en memoria (`ledger → agg → resumenData / inventory`).
5. "Guardar" escribe un estado compartido en el almacenamiento del entorno que aloja la página; "Descargar copia" re‑escribe el propio HTML con el snapshot embebido.

Riesgos que la versión cliente‑servidor elimina: carga manual repetida de Excel, estado que vive en un archivo, nadie sabe quién cambió qué, sin cierres de periodo, sin roles, duplicados al volver a subir el mismo Excel (hoy se *reemplaza* todo el bloque del estatus: `S.ed`/`S.out`).

## 2. Pantallas (pestañas)

| Pestaña (HTML) | Qué hace | Módulo en la app nueva |
|---|---|---|
| RESULTADOS (`res`) | Matriz por línea × día × semana. Cajas/unidades, HH por semana y mes, fila *Reportado en estatus*, *Asistencia*, *Eficiencia*. TT editable en la celda. Panel lateral con los registros de origen de cada proceso. | Resultados |
| RESUMEN (`sum`) | Margen por proceso (Costo Q, Requerimientos, Etiqueta/bolsa, Costo neto, HH, Margen) + detalle por sección con costo unitario editable. | Resumen costos/eficiencia |
| REQUERIMIENTOS (`req`) | Alta/edición de requerimientos (fecha, área, OC, monto, proveedor, cantidad, material, obs.). | Requerimientos |
| INVENTARIO (`inv`) | Tarjetas de stock actual con días de cobertura, movimiento del mes (inicial + ingresos − consumo − merma), costo consumido por rubro, merma, inventario inicial (conteo físico), catálogo *Etiqueta por material*, fotos de insumos. | Inventario/consumo |
| CAPTURA (`cap`) | Subpestañas: Horas y asistencia (impresión, coordinador, asistencia semanal), Etiquetado día/noche/Quaker, Sunchips, Crackets. | Producción/maquilas + Horas y personal |
| AJUSTES (`adj`) | Catálogo de maquilas (SAP, cajas/tarima, TT, costo), etiquetas y ribbon, bolsa, "registros desde", divisor Walmart. | Ajustes/catálogos |
| (no existe) | Vista de resumen ejecutivo | **Dashboard** (nuevo, solo lectura de datos ya calculados) |

Elementos transversales: selector de mes con semanas editables (`cfg.mw`), botón Subir estatus, Guardar, Descargar Excel (`downloadReport`), Descargar copia, banner de solo lectura (`readOnly`), toasts, diálogo de confirmación (`ask`).

## 3. Fuentes de datos

### 3.1 Estatus diario (hojas)
`MAQUILA` (Fecha, SAP, Descripción, Total) · `WALMART` (Fecha, Egreso, Remisión/orden, Order type, Producto, U. por cj, Cajas, Total U) · `EMBOLSADO COBAN` (Fecha, Egreso, Actividad, Cajas, Observación) · `DESCARGAS` (Fecha ingreso, Ingreso, Factura, Tipo descarga, Cj descargadas; se agrupa por `#` o por factura) · `ETIQUETADO` (solo contenedores **FLUS** → descargas FLUS, por Fecha ingreso, sin duplicar facturas ya vistas en DESCARGAS) · `ADMINISTRACION` (horas).

### 3.2 Estatus outsourcing
`OUTSORCING` + `GTA` (horas) · `ENTREGAS VN` (horas) · `UNISUPER` (Remisión, Material, T caja, Denominación, Cajas, U/caja, Total/U, Etiquetas utilizadas) · `DOLLARCITY` · `REVISION`.

### 3.3 Captura manual
Etiquetado día/noche/Quaker/Sunchips (fecha fin, factura, presentación, etiqueta, producto, cajas a maquilar, unidades etiquetadas, unidades en mal estado revisadas, cajas en mal estado, status, obs.), Crackets (igual sin etiqueta), horas de impresión y coordinador por día (7 por semana) y **asistencia semanal** (horas pagadas).

### 3.4 Reglas de lectura (se conservan en el importador de contingencia)
- Fecha: serial Excel (20000–80000) o texto `AAAA-MM-DD` / `DD/MM/AA(AA)`.
- Se ignoran registros anteriores a `cfg.inicio` (2026‑10‑05) y fechas futuras a más de 7 días (`okD`).
- Encabezados detectados por nombre normalizado (sin acentos, mayúsculas) en las primeras 25 filas.
- Filas de horas sin horas diurnas ni nocturnas se descartan; maquila sin total se descarta.

## 4. Catálogos embebidos (semilla de la BD)

- 27 productos de maquila (SAP, nombre, costo unitario Q/caja, cajas por tarima, TT min/tarima), 24 líneas de proceso (`DEF_LINES`) con TT y tarifa, 6 etiquetas (unid./rollo, ribbon, rendimiento de ribbon, precio de rollo), 2 ribbon, 1 bolsa con 3 SAP (8/12/10 por caja), conteo físico inicial del 2026‑10‑13, 29 materiales → etiqueta (`DEF_MATLAB`, con alias y bandera "confirmada"), textos de uso por insumo, fotos de materiales.
- Semanas del mes: `cfg.mw` (oct‑2026 = semanas 41 a 44).

## 5. Fórmulas y reglas de negocio (inventario exhaustivo)

| # | Regla | Origen | Estado |
|---|---|---|---|
| R1 | **Mes por semanas**: una semana ISO pertenece al mes de su jueves; puede forzarse por mes (`mw`). | `monthWeeks`, `weeksFor` | Confirmada (comportamiento actual) |
| R2 | **Bitácora diaria** por clave de línea con [cantidad, cantidad cobrable]. | `ledger` | Confirmada |
| R3 | **HH maquila** = cajas ÷ cajas/tarima × TT(min/tarima) ÷ 60. Requiere TT > 0 y cxt > 0, si no HH = 0. | `hhOf` modo `mpt` | Confirmada; ver P2 |
| R4 | **HH por caja/contenedor** (`mpu`) = cant × TT ÷ 60. **HH por UPH** = cant ÷ TT. **Horas** (`hrs`/`man`) = lo capturado. `none` = 0. | `hhOf` | Confirmada |
| R5 | **Costo Q** = cantidad cobrable × tarifa unitaria; sin tarifa = 0 y se marca "Sin costo". | `agg` | Confirmada |
| R6 | **Walmart cobro de cajas**: si unidades/caja ≥ `wmDiv` (19) → total U ÷ 19; si no, total U ÷ u/caja; si no hay u/caja → cajas. Cantidad de la línea = unidades, cobrable = cajas de cobro. | `parseED` | Confirmada; ver P3 |
| R7 | **Crackets**: cantidad (horas) = buenas + malas; cobrable = buenas; unidades de revisión = revisadas (si > 0) o malas × u/caja (regex `X(\d+)X1`, por defecto 64). | `ledger` | Confirmada; ver P4 |
| R8 | **Descargas**: cada contenedor cuenta 1 en su tipo (GALLETA/SALADO/FLUS/QUAKER). FLUS entra por el estatus de etiquetado. | `ledger`, `parseED` | Confirmada |
| R9 | **Etiquetado**: unidades etiquetadas a la línea y unidades revisadas a `revE` (o `revS` en Sunchips). Sunchips consume 3 etiquetas (1X1, 4X2, 1.25X0.5), el resto, la etiqueta capturada. | `ledger` | Confirmada |
| R10 | **Eficiencia** = HH reportadas ÷ asistencia, solo en semanas con asistencia capturada. | `renderRes` | Confirmada |
| R11 | **Resumen por sección**: costo neto = costo − requerimientos (tipos Otro/Directo del área) − material consumido de la sección. **Margen** = neto ÷ HH; nulo si HH = 0 o costo = 0. Total: neto − requerimientos generales; margen total = neto ÷ HH. | `resumenData` | Confirmada |
| R12 | **Secciones** y su orden: maq, desc, etq, rev, os, wm, cob, uni, crk, dc, revm, adm, coord; `imp`→etq, `revE`/`revS`→rev, `evn`→os. | `resGroup`, `RES_ORDER` | Confirmada |
| R13 | **Inventario**: conteo físico en fecha base, se desplaza día a día hacia adelante o atrás con ingresos, consumos y merma. Final = inicial + ingresos − consumo − merma. | `inventory` | Confirmada |
| R14 | **Ingresos** desde requerimientos: Etiqueta = cant × unidades/rollo; Ribbon = cant rollos; Bolsa = cant. Otros tipos no entran al inventario. | `reqIngreso` | Confirmada |
| R15 | **Consumos**: Walmart 1 etiqueta 3X2 por caja; Unisuper = etiquetas utilizadas (3X2); etiquetado = unidades etiquetadas con su etiqueta; Sunchips ×3; bolsa por caja de maquila (8/12/10). | `ledger`, `addUse` | Confirmada; ver P5 |
| R16 | **Ribbon** = unidades de etiqueta ÷ rendimiento (etiquetas por rollo de ribbon). | `ribUse` | Confirmada |
| R17 | **Costo unitario**: etiqueta = precio rollo ÷ unidades/rollo; ribbon = precio rollo; bolsa = precio unidad. | `unitCost` | Confirmada |
| R18 | **Costo de material por sección**: consumo por rubro × costo unitario; la merma se asigna: BOLSA→maq, 3X2→wm, resto→etq. | `materialCost` | Confirmada; ver P6 |
| R19 | **Cobertura**: stock ÷ consumo promedio diario de últimos 28 días; verde ≥ 14 d, ámbar < 14, rojo negativo. | `stockNow`, `heroInv` | Confirmada |
| R20 | Cobertura por material → etiqueta (`matFind`: por SAP, nombre o alias). | `matFind` | Confirmada |

## 6. Validaciones existentes

TT > 0 para calcular HH; monto/cantidad ≥ 0 en formularios; fecha obligatoria; SAP duplicado en catálogo de materiales rechazado; SAP en el estatus que no está en catálogo se avisa (no suma HH); fechas fuera de rango ignoradas con contador (`FUTN`); confirmación al borrar material. **No hay**: validación de duplicados de registros, motivos de anulación, bitácora de cambios, bloqueo de periodos, roles ni permisos.

## 7. Exportaciones

Excel de 5 hojas (RESULTADOS, RESUMEN, REQUERIMIENTOS, INVENTARIO, CAPTURA ETIQUETADO) para el mes visible, y copia del propio HTML con snapshot. No hay PDF.

## 8. Persistencia actual

Estado en un único documento (`cfg`, `ed`, `out`, `cap`, `req`, `merma`, `img`) más una copia en IndexedDB y snapshot embebido. Sin transacciones, sin historial, sin control de concurrencia (el último en guardar gana).

## 9. Lo que NO existía y se agrega (marcado como nuevo)

Autenticación y 4 roles · Dashboard · captura directa en lugar de Excel · anulación con justificación (no borrado) · borradores/confirmación · prevención de duplicados e idempotencia · historial de cambios · tarifas y estándares con vigencia · cierres de periodo · exportación PDF · campos de referencia externa para SAP · importador Excel de contingencia con vista previa · indicador de sincronización.

## 10. Reglas pendientes de validación (no se inventan)

| ID | Tema | Comportamiento actual | Qué se hace en la app nueva |
|---|---|---|---|
| P1 | **Margen con datos insuficientes**: el HTML muestra "—"; HH = 0 o costo = 0 → sin margen. | Se muestra **N/D** (nunca 0). | Implementado |
| P2 | Maquila sin cajas/tarima (cxt) o sin TT: HH = 0 en silencio. | HH = 0 y el proceso queda marcado "incompleto". | Marcar y pedir el dato; no estimar |
| P3 | Walmart: el divisor 19 aplica a "unidades por caja ≥ 19" para todos los productos. ¿Es regla de negocio o aproximación? | Se conserva como parámetro (`wmDiv`) con vigencia. | **Validar con Operaciones** |
| P4 | Crackets: horas con buenas + malas × 3.3333 min; cobro solo buenas; revisión malas × 64 si faltan revisadas. | Se conserva. | **Validar** valor 64 por defecto |
| P5 | Etiquetas por caja en Walmart (1) y Unisuper (columna del estatus); Sunchips "1 por unidad" de cada una de las 3. | Se conservan en tabla de reglas de consumo. | Validar con Inventario |
| P6 | Merma: asignación BOLSA→maq, 3X2→wm, resto→etq, y el ribbon de la merma de etiquetas. | Se conserva. | **Validar** rubro contable |
| P7 | Inventario de base: conteo del 13‑oct‑2026 con consumo hacia atrás para periodos previos. | Se conserva. | Validar si se permite retroceder |
| P8 | Eficiencia: ¿incluye HH de coordinador e impresión (capturadas) en "reportadas"? Hoy sí (modo `man`). | Se conserva. | Validar |
| P9 | Costo unitario de maquila vacío ≠ costo 0. Hoy se suma 0 y se avisa "Sin costo". | Igual, pero visible como alerta bloqueante al cerrar el periodo. | Validar |
| P10 | Cierre de mes por jueves vs. calendario fiscal. | Se conserva R1 (+ override). | Validar |
| P11 | Requerimientos "Directo/Otro" restan al área; "general" resta al total. Las etiquetas/ribbon/bolsa del requerimiento **no** restan costo (entran a inventario y se costean al consumir). | Se conserva. | Validar contablemente |
| P12 | Tarifas de crackets revisión y TT de varias líneas están vacíos en el snapshot (p. ej. `dFLUS`, `dQUA`, `revm`, `dc`). | Se cargan vacíos (sin inventar). | Operaciones debe proporcionarlos |
| P13 | Datos de personas (nombre del auxiliar) en los estatus. | En la demo se **anonimizan**; en producción es dato personal. | Definir política de acceso |

## 11. Duplicados y riesgos de integridad detectados en el diseño actual

1. Re‑subir un estatus reemplaza el bloque completo; si falta un día, se pierde.
2. No existe identificador por registro en el estatus → la app nueva usa `source_key` (hash de hoja + campos naturales) con restricción única.
3. Fechas ambiguas `DD/MM` vs `MM/DD` en texto; se mantiene `DD/MM` y la vista previa del importador las muestra antes de confirmar.
4. Semana/mes calculados en el cliente (zona horaria): en el servidor todo se maneja como `DATE` sin zona.
