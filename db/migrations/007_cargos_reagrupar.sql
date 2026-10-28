-- 007 · Permite reagrupar un periodo después de anular su cargo.
-- La unicidad sigue evitando dos cargos activos para el mismo cliente y periodo,
-- pero un cargo ANULADO deja de bloquear la creación de uno nuevo.
ALTER TABLE maquila_statements DROP CONSTRAINT maquila_statements_uq;
CREATE UNIQUE INDEX maquila_statements_active_uq
  ON maquila_statements (sede_id, client_id, period_kind, period_key)
  WHERE status <> 'ANULADO';
