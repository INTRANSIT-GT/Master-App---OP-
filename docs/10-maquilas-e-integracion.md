# 10 · Maquilas e integración con Transportes

Estado: **fases 1–5 desplegadas en el Supabase de prueba y en Pages**. Transportes no se ha
modificado. Autor: sesión de trabajo del 2026-10-28. Decisión de Ing. Carmen: Transportes debe
salir a producción en ~1 semana; esta integración va después y se construye en paralelo.

## 1. Regla de trabajo en paralelo

Mientras Transportes no esté en producción:

| Repositorio | Qué se puede hacer | Qué no se toca |
|---|---|---|
| **Master-App-OPS** (este) | todo lo nuevo: esquema `maquilas`, API, web, pruebas, documentación | nada de `master.*` ni de la app de Transportes |
| **Master-App** | nada, salvo una rama de preparación sin desplegar | motor, facturación, matriz de permisos, `service-worker`, Edge Function `api` |

La integración real empieza **después del lanzamiento** y se hace en migraciones aditivas,
detrás de una bandera y con la posibilidad de volver atrás sin tocar los datos de viajes.

## 2. Qué se construye en Operaciones

### 2.1 Base operativa propia

`db/migrations/004_maquilas.sql` crea:

| Tabla | Para qué |
|---|---|
| `maquila_people` | personas de la maquila por sede; nace local y se sincroniza con GEOVICTORIA |
| `maquila_orders` | la orden/programación: cliente, proyecto, producto, turno, meta, producido, tiempos y estado |
| `maquila_assignments` | qué persona hizo qué, cuánto y en qué horario |
| `maquila_validations` | historial de SOP, jefatura y validador (aprobado/rechazado con motivo) |
| `maquila_statements` | cargo que agrupa maquilas validadas de un cliente |
| `maquila_statement_lines` | detalle congelado del cargo (cantidad y tarifa) |

Vistas: `maquila_por_facturar` (validadas sin cargo) y `maquila_productividad`
(unidades por hora con tiempos reales).

Reglas de la base:

- Nada se borra: se anula o se desactiva (`active=false`), y todo queda en `audit_log`.
- Una orden de un periodo cerrado no cambia datos de producción; sí puede avanzar a
  `EN_CARGO`, `FACTURADA` o `COBRADA` después del cierre.
- Una orden no puede estar en dos cargos activos (`unique(order_id) where active`).
- Una persona no puede estar dos veces activa en la misma orden.
- `RECHAZADA` exige motivo (mínimo 5 caracteres).

### 2.2 Flujo

```
PROGRAMADA → EN_PROCESO → CERRADA → VALIDADA_SOP → VALIDADA_JEFATURA → VALIDADA
     │            │           │                                            │
     │            │           └────────── RECHAZADA ◀──────────────────────┘
     │            │                          │
     └────────────┴──────────────────────────┴──▶ vuelve al Coordinador
                                                                    │
                                                                    ▼
                                              EN_CARGO → FACTURADA → COBRADA
```

| Paso | Perfil | Registra |
|---|---|---|
| Programar y asignar | Coordinador | cliente, proyecto, producto SAP, fecha, turno, meta y personas |
| Iniciar | Coordinador | fecha y hora de inicio |
| Cerrar | Coordinador | cantidad producida, fecha y hora de fin, observaciones |
| Validar SOP | Supervisor OP / Jefatura OP | aprobado o rechazado con motivo |
| Validar jefatura | Jefatura OP | aprobado o rechazado con motivo |
| Validar | Validador (compartido) | validación final; queda facturable |
| Agrupar | Facturación | cargo del cliente con las maquilas validadas |
| Facturar y cobrar | Facturación / Cobros | igual que el flujo actual de Transportes |

Productividad: `producido ÷ horas` por orden y por persona. Las horas salen de
`started_at`/`finished_at` (zona `America/Guatemala`). Un turno que cruza medianoche se
guarda como `timestamptz`, no como hora suelta.

### 2.3 Perfiles

Compartidos (existen en ambos módulos):

| Perfil | Transportes | Operaciones |
|---|---|---|
| ADMIN | `ADMIN` | `administrador` |
| Gerente Comercial | `GERENTE_COMERCIAL` | `comercial` |
| Facturación | `FACTURACION` | `facturacion` |
| Cobros | `COBROS` | `cobros` |
| Validador | `VALIDADOR` | `validador` |

Solo de Operaciones: `coordinador`, `gerente_op`, `supervisor_op`, `jefatura_op`.

Los perfiles actuales de Transportes que no están en esta lista (Operativo, Torre,
Analista Comercial, Pago OPL, Proyectos) se quedan como están, sin acceso a Operaciones.

Secciones de Operaciones (visibilidad editable, por defecto todas y luego se quitan):
`Programación · Personas · Cierre del día · Validación · Facturación · Tarifas · Reportes · Ajustes`.

Las acciones (crear, cerrar, validar, facturar) son reglas de negocio y no se editan desde
la matriz; lo editable es qué secciones ve cada perfil.

## 3. Qué se cambiará en Transportes (después del lanzamiento)

Nada de esto se aplica ahora.

### 3.1 Un usuario, dos roles

`auth.users.raw_app_meta_data.modulos` ya admite:

```json
{ "modulos": { "transportes": "FACTURACION", "operaciones": "facturacion" } }
```

Transportes será el dueño de la asignación: su pantalla de Usuarios elegirá el perfil de
cada módulo y escribirá esa clave **mezclando**, sin borrar la del otro módulo. Operaciones
conservará solo sedes y suspensión local.

### 3.2 Facturación compartida por número de factura

Se generaliza la tabla que ya existe, no se crea otra:

```sql
alter table master.agrupaciones
  add column origen text not null default 'TRANSPORTE'
      check (origen in ('TRANSPORTE','MAQUILA')),
  add column lineas jsonb not null default '[]',
  add column ref_externa text;   -- id del cargo de maquila
```

- `origen='TRANSPORTE'`: al menos un viaje (comportamiento actual).
- `origen='MAQUILA'`: cero viajes y al menos una línea.
- Una factura **solo** contiene viajes **o** maquilas, y **solo de un cliente**.
- El número de factura sigue siendo único y compartido: una sola secuencia para ambos tipos.
- El tablero consolidado suma ambas, pero no emite facturas mixtas.

### 3.3 Contrato entre módulos

Operaciones expone el cargo (`maquila_statements`) y sus líneas. Transportes:

1. Lee los cargos `CERRADO` del cliente.
2. Crea la agrupación con `origen='MAQUILA'`, `ref_externa` y `lineas`.
3. Envía, emite y cobra con el flujo actual.
4. Al enviar/emitir/cobrar/anular, marca el cargo (`ENVIADO/FACTURADO/COBRADO/ANULADO`)
   mediante una función SQL de Operaciones, en la misma transacción.

La frase «se integran por número de factura» se cumple con **una sola tabla de facturas y
una sola numeración**; el origen solo cambia el contenido y el flujo interno.

### 3.4 Clientes compartidos

Antes de facturar hay que unificar: `master.clientes` será la fuente y los proyectos de
Operaciones referenciarán ese cliente. Como hoy no hay datos reales, se hace de una vez y
sin convivencia. Las tarifas siguen separadas: `master.tarifas` para viajes y
`billing_rates`/`standards` para maquilas.

## 4. Fases

| Fase | Repo | Entrega | Estado |
|---|---|---|---|
| 1 | OP | esquema de maquilas y este contrato | **hecho** |
| 2 | OP | perfiles, secciones y API de personas/órdenes | **hecho** |
| 3 | OP | asignación, inicio/fin, cierre y productividad | **hecho** |
| 4 | OP | validaciones SOP/jefatura/validador | **hecho** |
| 5 | OP | cargos y pantalla de facturación de maquilas | **hecho** |
| 6 | Transportes | perfiles de dos módulos y pantalla de Usuarios | **después de producción** |
| 7 | Transportes | `origen/lineas`, factura de maquila y tablero consolidado | después de producción |
| 8 | Ambos | clientes compartidos, migración de datos y pruebas de volumen | después de producción |
| 9 | OP | sincronización con GEOVICTORIA | cuando la API esté disponible |

### Estado desplegado al 2026-10-28

- Migraciones **004–007** aplicadas en el Supabase de prueba (esquema `operaciones`).
- Función **`operaciones`** desplegada; las rutas `/api/maquila/*` responden 401 sin token.
- Web publicada en Pages: Maquilas con Programación, Personas, Validación y Facturación.
- Tipos del servidor y de la web en verde; pruebas de la web 10/10.
- Pruebas de integración del servidor pendientes: requieren PostgreSQL local.
- El cargo queda **ABIERTO → CERRADO** y puede anularse; la factura y su número viven en el
  módulo comercial compartido (fase 7, después de la salida a producción de Transportes).

## 5. Lista de «no tocar» hasta que Transportes esté en producción

- `Master-App/js/engine.js`, `js/ui.js`, `js/modulos/*.js`, `service-worker.js`.
- `Master-App/supabase/functions/api/*` y `core.mjs`.
- `Master-App/supabase/migrations/*` existentes y el esquema `master`.
- `master.agrupaciones`, `master.viajes`, `master.tarifas`, `master.permisos`.
- La Edge Function `api` y los secretos del proyecto.

Cualquier cambio en esa lista se hace en una rama de Transportes, se revisa y se aplica
en una ventana posterior al lanzamiento, con respaldo previo.

## 6. Verificación de la fase 1

- `node scripts/supabase-base.mjs migrar` aplica `004_maquilas.sql` sin tocar `master`.
- Las tablas nuevas quedan en el esquema `operaciones` y no son visibles para `anon` ni
  `authenticated` (el esquema ya está revocado).
- No se modifica ninguna tabla existente; el rollback es `DROP` de las tablas nuevas en un
  entorno de prueba.
- Pruebas pendientes de ejecutar en un equipo con PostgreSQL 16: migración sobre
  `omnia_test`, constraints de horario, candado de periodo y unicidad de cargo.
