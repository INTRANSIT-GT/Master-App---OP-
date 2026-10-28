-- 006 · Anulación de cargos de maquila.
-- El cargo no se borra: se anula con motivo y deja liberadas sus maquilas.
ALTER TABLE maquila_statements ADD COLUMN void_reason text;
ALTER TABLE maquila_statements ADD COLUMN voided_by uuid REFERENCES users(id);
ALTER TABLE maquila_statements ADD COLUMN voided_at timestamptz;

ALTER TABLE maquila_statements ADD CONSTRAINT maquila_statements_void_ck
  CHECK (status <> 'ANULADO' OR (void_reason IS NOT NULL AND voided_at IS NOT NULL));
