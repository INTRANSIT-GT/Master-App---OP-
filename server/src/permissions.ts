export type Role = 'administrador' | 'supervisor' | 'operador' | 'consulta' | 'comercial';
export const PERMS = [
  'ver', 'exportar',
  'registro.crear', 'registro.editar_propio', 'registro.editar', 'registro.confirmar', 'registro.anular',
  'requerimiento.gestionar', 'inventario.gestionar', 'importar',
  'periodo.cerrar', 'periodo.reabrir', 'periodo.semanas',
  'catalogo.editar', 'estandar.editar', 'ajustes.editar', 'usuarios.gestionar', 'auditoria.ver',
  'compras.crear', 'compras.gestionar', 'compras.completar', 'comercial.ver', 'comercial.tarifas',
] as const;
export type Perm = (typeof PERMS)[number];

const OP: Perm[] = ['ver', 'exportar', 'registro.crear', 'registro.editar_propio', 'compras.crear'];
const SUP: Perm[] = [...OP, 'registro.editar', 'registro.confirmar', 'registro.anular', 'requerimiento.gestionar', 'inventario.gestionar', 'importar', 'periodo.cerrar', 'periodo.semanas', 'auditoria.ver', 'compras.gestionar', 'compras.completar'];
export const ROLE_PERMS: Record<Role, Perm[]> = {
  consulta: ['ver', 'exportar'],
  comercial: ['ver', 'exportar', 'comercial.ver', 'comercial.tarifas'],   // área comercial: reportes de cobro y tarifas
  operador: OP,
  supervisor: SUP,
  administrador: [...SUP, 'periodo.reabrir', 'catalogo.editar', 'estandar.editar', 'ajustes.editar', 'usuarios.gestionar', 'comercial.ver', 'comercial.tarifas'],
};
export const can = (role: Role, p: Perm) => ROLE_PERMS[role]?.includes(p) ?? false;
