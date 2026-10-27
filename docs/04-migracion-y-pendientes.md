# 04 · Plan de migración, SAP y pendientes

## Plan por fases
1. **Auditoría** ✔ (`01-auditoria.md`).
2. **Diseño** ✔ (esquema, API, roles).
3. **Prototipo** ✔ (este entregable, datos demo).
4. **Validación**: Operaciones/Finanzas revisan P1–P13, comparan 2–3 semanas reales contra el HTML (mismo método de valores dorados) y corrigen catálogos vacíos (P12).
5. **Producción**: instalar con `docker compose`, `seed --catalog` (sin demo), crear usuarios reales, cargar conteo físico vigente, importar histórico del periodo en curso con el importador (vista previa), operar en paralelo con el HTML un periodo y cerrar el mes en la app.

## Preparación SAP
Tabla `external_refs` (entidad, id interno, sistema, referencia externa) y SAP por producto ya existen. **No hay integración real**: cuando se defina (OData/IDoc/archivo), se añade un conector que escriba en `import_batches`/`external_refs` sin cambiar el motor.

## Pendientes de validación
Los de `01-auditoria.md` §10 (P1–P13). Prioritarios: P3 divisor Walmart 19, P4 valor 64 crackets, P6 rubro de merma, P12 tarifas/TT vacíos, P13 política de datos personales.

## Pendientes nuevos (v2)
- **Unidades de medida por proyecto** (Coca Cola envase/desarme = unidad, tarimas = tarima, Packs = pack, Validación de fechas = caja, Licorera etiquetado = unidad): son supuestos, confirmar con operaciones.
- **Tarifas de cobro** de Coca Cola, Alnost, XPORTA y Licorera: las de la demo son ficticias; Comercial debe cargarlas. Fritolay sigue en Estándares.
- **Catálogo de productividad del personal de maquila** (equivalencia metas → horas): se subirá después; hoy las horas de maquila son informativas y no entran a HH.
- **Consumo de insumos por caja o por tarima**: se calculará después; hoy el consumo se registra manualmente por proyecto/área.
- **Formato de OC**: tomado del ejemplo FLEE‑12 (OC_FLEETIO_JULIO.pdf). Confirmar numeración por prefijo y flujo de aprobación (quién emite/completa).
- **Multisede**: hecha el 2026-10-27 (migración `003_sedes.sql`): cada registro operativo pertenece a una sede y cada usuario entra a las sedes asignadas. **Pendiente de decidir:** si algún catálogo debe ser propio de cada sede (estándares, tarifas, artículos o clientes hoy son comunes) y si las órdenes de compra deben numerarse por sede (hoy la numeración por prefijo es común).

## Limitaciones del prototipo
- Sin conector SAP; el Excel solo como importador de contingencia.
- Datos demo anonimizados; cifras no válidas para decisiones.
- Sin correo/recuperación de clave (la restablece un administrador).
- Pruebas hechas en local (PostgreSQL 16); despliegue Docker no ejecutado en este entorno.
