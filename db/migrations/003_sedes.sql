-- v3: sedes. Cada registro operativo pertenece a una sede y cada usuario trabaja en las sedes que tiene asignadas
--     (el administrador, en todas). Los catálogos (productos, estándares, artículos, clientes, proyectos, tarifas) son comunes.
--     Todo lo registrado antes de esta migración pasa a SEDE FRITOLAY OMNIA, la única sede que había.

CREATE TABLE sedes (
  id      text PRIMARY KEY CHECK (id ~ '^[A-Z0-9-]{2,20}$'),
  name    text NOT NULL,
  active  boolean NOT NULL DEFAULT true,
  sort    integer NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX sedes_name_uq ON sedes (upper(name));
INSERT INTO sedes (id, name, sort) VALUES
  ('OMNIA', 'SEDE FRITOLAY OMNIA', 1), ('SAN-JUAN', 'SEDE FRITOLAY SAN JUAN', 2), ('HILO', 'SEDE HILO', 3), ('Z11', 'SEDE INTRANSIT Z11', 4);

CREATE TABLE user_sedes (
  user_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sede_id  text NOT NULL REFERENCES sedes(id),
  PRIMARY KEY (user_id, sede_id)
);
INSERT INTO user_sedes (user_id, sede_id) SELECT id, 'OMNIA' FROM users;

-- La columna entra con valor por defecto (rellena las filas existentes sin disparar los bloqueos de periodo)
-- y después se quita el defecto: desde aquí cada escritura dice su sede.
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['production_records','hours_records','attendance','requirements','inventory_scrap','inventory_counts',
                           'supply_movements','periods','purchase_orders','import_batches','incidents'] LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN sede_id text NOT NULL DEFAULT %L REFERENCES sedes(id)', t, 'OMNIA');
    EXECUTE format('ALTER TABLE %I ALTER COLUMN sede_id DROP DEFAULT', t);
  END LOOP;
END $$;
-- bitácora: la sede en la que se hizo el cambio (vacía en acciones sin sede, p. ej. el inicio de sesión)
ALTER TABLE audit_log ADD COLUMN sede_id text DEFAULT 'OMNIA' REFERENCES sedes(id);
ALTER TABLE audit_log ALTER COLUMN sede_id DROP DEFAULT;
CREATE INDEX audit_sede ON audit_log (sede_id, id DESC);

-- ───────── unicidad e índices por sede ─────────
DROP INDEX production_records_source_key_uq;
CREATE UNIQUE INDEX production_records_source_key_uq ON production_records (sede_id, kind, source_key) WHERE source_key IS NOT NULL AND status <> 'anulado';
DROP INDEX production_records_date;
CREATE INDEX production_records_date ON production_records (sede_id, record_date, kind) WHERE status = 'confirmado';
DROP INDEX hours_records_source_key_uq;
CREATE UNIQUE INDEX hours_records_source_key_uq ON hours_records (sede_id, kind, source_key) WHERE source_key IS NOT NULL AND status <> 'anulado';
DROP INDEX hours_manual_day_uq;
CREATE UNIQUE INDEX hours_manual_day_uq ON hours_records (sede_id, kind, record_date) WHERE kind IN ('imp','coord') AND status <> 'anulado';
DROP INDEX hours_records_date;
CREATE INDEX hours_records_date ON hours_records (sede_id, record_date, kind) WHERE status = 'confirmado';
DROP INDEX requirements_oc_uq;
CREATE UNIQUE INDEX requirements_oc_uq ON requirements (sede_id, lower(oc), mat_type, coalesce(mat_ref,''), request_date)
  WHERE oc IS NOT NULL AND oc <> '' AND status <> 'anulado';
ALTER TABLE attendance DROP CONSTRAINT attendance_pkey, ADD PRIMARY KEY (sede_id, week_monday);
ALTER TABLE inventory_counts DROP CONSTRAINT inventory_counts_count_date_item_id_key, ADD UNIQUE (sede_id, count_date, item_id);
ALTER TABLE periods DROP CONSTRAINT periods_month_key_key, ADD UNIQUE (sede_id, month_key);
CREATE INDEX purchase_orders_sede ON purchase_orders (sede_id, po_date DESC);

-- ───────── el cierre de periodo bloquea solo los registros de su sede ─────────
CREATE FUNCTION assert_period_open(s text, d date) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF d IS NULL THEN RETURN; END IF;
  IF current_setting('omnia.override_lock', true) = 'on' THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM periods WHERE sede_id = s AND status = 'cerrado' AND d BETWEEN start_date AND end_date) THEN
    RAISE EXCEPTION 'PERIODO_CERRADO: la fecha % pertenece a un periodo cerrado', d USING ERRCODE = 'P0001';
  END IF;
END $$;
CREATE OR REPLACE FUNCTION trg_lock_period() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE col text := TG_ARGV[0]; dn date; dold date; sn text; sold text;
BEGIN
  IF TG_OP IN ('INSERT','UPDATE') THEN EXECUTE format('SELECT ($1).%I::date, ($1).sede_id', col) INTO dn, sn USING NEW; PERFORM assert_period_open(sn, dn); END IF;
  IF TG_OP IN ('UPDATE','DELETE') THEN EXECUTE format('SELECT ($1).%I::date, ($1).sede_id', col) INTO dold, sold USING OLD; PERFORM assert_period_open(sold, dold); END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
DROP FUNCTION assert_period_open(date);
