# 02 · Descripción funcional

Interfaz en español con la identidad minimalista de In Transit (sistema de diseño: azul institucional `#003CA6`, fondo blanco, tablas con encabezado azul, una sola sombra suave, estados con punto + palabra, sin emojis; Avenir Next → Nunito Sans → Arial). Datos de demostración marcados con banner y etiqueta `demo`.

## Módulos
| Módulo | Función |
|---|---|
| Producción | Botón **＋ Añadir nuevo registro**: se elige **cliente → proyecto** en menús desplegables y la fecha es la de hoy (automática; opción «otra fecha»). Fritolay: Maquila, Walmart, Embolsado Cobán, Descargas, Unisuper, Dollar City, Revisión, Etiquetado, Sunchips, Crackets. Coca Cola: Habilitación de envase‑trasiego, Habilitación de tarimas‑trasiego, Packs, Desarme. Alnost y XPORTA: Validación de fechas. Licorera: Etiquetado, Packs. **Los registros no se borran**: se editan (con motivo y control de versión) o se anulan con motivo; todo queda en la bitácora. En Maquila, al elegir el producto SAP ya no se pide descripción. |
| Horas y personal | **Personal de maquila** (horas por proyecto; trabaja por metas, informativo y fuera de HH hasta que se suba el catálogo de equivalencia de productividad) y **Impresión y asistencia**. Se retiraron horas de coordinador/administración, Outsourcing y Entregas Villanueva. |
| Compras (órdenes de compra) | **Generar orden de compra** con el formato interno «Orden de compra y/o requerimiento de pago» (proveedor, condición de pago, líneas con código/descripción/cantidad/precio, firmas). Estados: borrador → emitida → **completada** | anulada. Al completar se actualiza el inventario (insumos, etiqueta, ribbon, bolsa) y los costos directos restan al área. Exporta a Excel y PDF; historial de materiales (qué, cantidad, monto, proveedor); incluye Requerimientos. |
| Inventario | Stock y cobertura, movimiento del mes, **Insumos** (catálogo y movimientos, ligados a OC y a producción), merma, conteos físicos, etiqueta por material. |
| Comercial | Solo rol Comercial y Administrador. **Reporte de cobro** semanal o mensual por cliente (Fritolay desde el motor de costo; los demás clientes = cantidad × tarifa vigente), Excel y **tarifas por cliente** con vigencia. Sin tarifa → «sin tarifa» y no suma. |
| Ajustes | Clientes y proyectos, catálogos (productos, estándares con vigencia, bolsa, etiqueta por material), parámetros (incl. nombre de sede), **periodos** (semanas del mes, cierre y reapertura), importar Excel, usuarios, bitácora. |

Dashboard y Resumen se retiraron de la app el 2026-10-27 (pedido de Ing. Carmen: la app es operativa). El margen por proceso (Costo Q − requerimientos − material consumido; margen = neto ÷ HH; **N/D** si faltan HH o costo) sigue en la hoja RESUMEN del Excel y en el PDF del mes; el servidor conserva `/api/dashboard` y `/api/resumen`.

## Roles (se validan en el backend)
| Permiso | Consulta | Operador | Supervisor | Comercial | Administrador |
|---|:-:|:-:|:-:|:-:|:-:|
| Ver / exportar | ✔ | ✔ | ✔ | ✔ | ✔ |
| Crear registros, editar los propios | | ✔ | ✔ | | ✔ |
| Editar cualquiera, confirmar, anular | | | ✔ | | ✔ |
| Requerimientos, inventario, importar, cerrar periodo, auditoría | | | ✔ | | ✔ |
| Órdenes de compra: crear borrador | | ✔ | ✔ | | ✔ |
| Órdenes de compra: emitir, completar, anular | | | ✔ | | ✔ |
| Módulo Comercial (cobro, tarifas) | | | | ✔ | ✔ |
| Reabrir periodo, catálogos, estándares, ajustes, usuarios | | | | | ✔ |

## Integridad
- Anti‑duplicado: llave natural (hash) con índice único parcial; si es un caso legítimo se registra con sufijo `#n` tras confirmar.
- `Idempotency-Key` en altas; versión optimista; anular nunca borra.
- Periodo cerrado: trigger en BD bloquea escrituras (HTTP 423) y se sirve una foto congelada. Reabrir exige administrador y queda en auditoría.
- Toda mutación se registra en `audit_log` (quién, cuándo, antes/después).
- Importación Excel secundaria: vista previa, detección de duplicados, reporte de errores; no es el flujo principal.
- Exportes: Excel y PDF del periodo.

## Acceso por rol (v2)
- **Operador**: además crea órdenes de compra (borrador). **Supervisor**: emite, completa y anula órdenes. **Comercial**: ve producción/resumen y el módulo Comercial (reporte de cobro y tarifas). **Administrador**: todo lo anterior. Consulta y operador **no** ven Comercial; se valida en el backend.
- Usuarios demo (clave `Omnia2026!demo`): admin@, supervisor@, operador@, consulta@, comercial@omnia.local. Cámbialas antes de cualquier uso real.

## Como módulo de la app principal (acceso compartido)
- Con `AUTH_MODE=sso` no hay pantalla de login propia: se entra desde el portal con el usuario de Supabase y el módulo se abre solo si el usuario lo tiene asignado.
- El **rol** del usuario en Operaciones (administrador, supervisor, operador, consulta o comercial) viene de la asignación del módulo, no de Ajustes. En Ajustes → Usuarios solo se puede **suspender o reactivar** el acceso al módulo.
- El encabezado incluye el botón **Módulos** para volver al selector, y **Salir** cierra la sesión compartida.
- Mensajes: «Módulo no asignado» (sin el módulo), «Acceso no disponible» (rol inválido o usuario suspendido), «No se pudo validar tu sesión» (token rechazado).
