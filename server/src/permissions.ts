export type Role =
  | 'administrador'
  | 'supervisor'
  | 'operador'
  | 'consulta'
  | 'comercial'
  | 'coordinador'
  | 'gerente_op'
  | 'supervisor_op'
  | 'jefatura_op'
  | 'validador'
  | 'facturacion'
  | 'cobros';

export const PERMS = [
  'ver', 'exportar',
  'registro.crear', 'registro.editar_propio', 'registro.editar', 'registro.confirmar', 'registro.anular',
  'requerimiento.gestionar', 'inventario.gestionar', 'importar',
  'periodo.cerrar', 'periodo.reabrir', 'periodo.semanas',
  'catalogo.editar', 'estandar.editar', 'ajustes.editar', 'usuarios.gestionar', 'auditoria.ver',
  'compras.crear', 'compras.gestionar', 'compras.completar', 'comercial.ver', 'comercial.tarifas',
  // Maquilas: la base operativa propia de Operaciones (separada de viajes).
  'maquila.ver', 'maquila.personas', 'maquila.programar', 'maquila.editar', 'maquila.asignar',
  'maquila.iniciar', 'maquila.cerrar', 'maquila.validar_sop', 'maquila.validar_jefatura',
  'maquila.validar', 'maquila.agrupar', 'maquila.facturar', 'maquila.cobrar', 'maquila.anular',
  'maquila.reabrir',
] as const;
export type Perm = (typeof PERMS)[number];

/** Secciones de Maquilas cuya visibilidad se puede editar por perfil. Las acciones no se editan: son permisos. */
export const SECCIONES_MAQUILA = [
  ['programacion', 'Programación'],
  ['personas', 'Personas'],
  ['cierre', 'Cierre del día'],
  ['validacion', 'Validación'],
  ['facturacion', 'Facturación'],
  ['tarifas', 'Tarifas'],
  ['reportes', 'Reportes'],
  ['ajustes', 'Ajustes'],
] as const;
export type SeccionMaquila = (typeof SECCIONES_MAQUILA)[number][0];
export const SECCION_KEYS = SECCIONES_MAQUILA.map(([k]) => k) as SeccionMaquila[];

const OP: Perm[] = ['ver', 'exportar', 'registro.crear', 'registro.editar_propio', 'compras.crear'];
const SUP: Perm[] = [...OP, 'registro.editar', 'registro.confirmar', 'registro.anular', 'requerimiento.gestionar', 'inventario.gestionar', 'importar', 'periodo.cerrar', 'periodo.semanas', 'auditoria.ver', 'compras.gestionar', 'compras.completar'];

/* Maquilas: Coordinador captura y cierra; supervisión y jefatura validan; el validador da el visto bueno final.
   Facturación y Cobros solo entran a la parte comercial; no operan ni validan. */
const COORD: Perm[] = ['ver', 'exportar', 'maquila.ver', 'maquila.personas', 'maquila.programar', 'maquila.editar', 'maquila.asignar', 'maquila.iniciar', 'maquila.cerrar'];
const SUPOP: Perm[] = [...COORD, 'maquila.validar_sop', 'maquila.anular'];
const JEFOP: Perm[] = [...SUPOP, 'maquila.validar_jefatura'];
const VALID: Perm[] = ['ver', 'exportar', 'maquila.ver', 'maquila.validar'];
const FACT: Perm[] = ['ver', 'exportar', 'maquila.ver', 'maquila.agrupar', 'maquila.facturar', 'comercial.ver'];
const COB: Perm[] = ['ver', 'exportar', 'maquila.ver', 'maquila.cobrar', 'comercial.ver'];
const GEROP: Perm[] = [...JEFOP, 'maquila.reabrir', 'periodo.cerrar', 'periodo.reabrir', 'periodo.semanas', 'catalogo.editar', 'estandar.editar', 'ajustes.editar', 'auditoria.ver', 'usuarios.gestionar'];

const ALL: Perm[] = [...new Set<Perm>([
  ...SUP, ...COORD, ...SUPOP, ...JEFOP, ...VALID, ...FACT, ...COB, ...GEROP,
  'periodo.reabrir', 'catalogo.editar', 'estandar.editar', 'ajustes.editar', 'usuarios.gestionar',
  'auditoria.ver', 'comercial.ver', 'comercial.tarifas', 'maquila.validar', 'maquila.agrupar',
  'maquila.facturar', 'maquila.cobrar', 'maquila.anular', 'maquila.reabrir',
])];

export const ROLE_PERMS: Record<Role, Perm[]> = {
  consulta: ['ver', 'exportar'],
  comercial: ['ver', 'exportar', 'comercial.ver', 'comercial.tarifas', 'maquila.ver', 'maquila.agrupar'],
  operador: OP,
  supervisor: SUP,
  administrador: ALL,
  coordinador: COORD,
  gerente_op: GEROP,
  supervisor_op: SUPOP,
  jefatura_op: JEFOP,
  validador: VALID,
  facturacion: FACT,
  cobros: COB,
};

export const can = (role: Role, p: Perm) => ROLE_PERMS[role]?.includes(p) ?? false;
