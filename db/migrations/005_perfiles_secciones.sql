-- 005 · Perfiles de Operaciones y secciones de Maquilas.
--
-- Amplía el enum de roles con los perfiles nuevos. Los roles anteriores se conservan para no
-- romper usuarios ni pruebas existentes. Este archivo NO usa los valores nuevos: solo los agrega,
-- porque un valor de enum recién creado no puede usarse dentro de la misma transacción.
--
-- Las secciones son visibilidad (qué pantallas ve cada perfil). Las acciones (crear, cerrar,
-- validar, facturar) siguen siendo permisos de código en server/src/permissions.ts.

ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'coordinador';
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'gerente_op';
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'supervisor_op';
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'jefatura_op';
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'validador';
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'facturacion';
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'cobros';

-- Sin fila = sección visible. Se guarda solo lo que se apaga, para que un perfil nuevo
-- herede «todo visible» y luego se le vayan quitando secciones.
CREATE TABLE perfil_secciones (
  perfil     text NOT NULL,
  seccion    text NOT NULL,
  habilitado boolean NOT NULL DEFAULT true,
  updated_by uuid REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (perfil, seccion)
);

COMMENT ON TABLE perfil_secciones IS 'Visibilidad de secciones por perfil de Operaciones. Solo se guardan las secciones apagadas o cambiadas; la ausencia de fila significa visible.';
