-- 004 · Maquilas: personas, programación, asignaciones, cierre, validación y cargos.
--
-- Base operativa PROPIA de Operaciones, separada de las tablas de viajes de Transportes.
-- No modifica production_records, el motor ni la facturación existente: la unión con
-- Transportes ocurre después, en la facturación, y se describe en docs/10-maquilas-e-integracion.md.
--
-- Flujo: PROGRAMADA → EN_PROCESO → CERRADA → VALIDADA_SOP → VALIDADA_JEFATURA → VALIDADA
--        → EN_CARGO → FACTURADA → COBRADA.  RECHAZADA y ANULADA conservan su motivo.
--
-- Nada se borra: se anula/desactiva y queda en audit_log. Los datos de un periodo cerrado
-- no se modifican (mismo candado que producción), pero el estado sí puede avanzar a facturado/cobrado.

-- ───────────────────────── Personas de maquila ─────────────────────────
-- Lista local mientras no exista la integración con GEOVICTORIA. La sincronización será por
-- external_ref y nunca borrará: solo dará de alta o desactivará.
CREATE TABLE maquila_people (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sede_id      text NOT NULL REFERENCES sedes(id),
  code         text NOT NULL,
  name         text NOT NULL,
  position     text NOT NULL DEFAULT '',
  active       boolean NOT NULL DEFAULT true,
  source       text NOT NULL DEFAULT 'LOCAL' CHECK (source IN ('LOCAL','GEOVICTORIA')),
  external_ref text,
  synced_at    timestamptz,
  raw          jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT maquila_people_code_uq UNIQUE (sede_id, code),
  CONSTRAINT maquila_people_name_ck CHECK (char_length(btrim(name)) BETWEEN 2 AND 120)
);
CREATE UNIQUE INDEX maquila_people_external_uq ON maquila_people (source, external_ref) WHERE external_ref IS NOT NULL;
CREATE INDEX maquila_people_sede ON maquila_people (sede_id, active, name);

-- ───────────────────────── Cargos (agrupación facturable) ─────────────────────────
-- Un cargo reúne maquilas validadas de UN cliente. Es la unidad que luego se convierte en
-- factura; el número de factura NO se genera aquí (vive en el módulo comercial).
CREATE TABLE maquila_statements (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sede_id      text NOT NULL REFERENCES sedes(id),
  client_id    uuid NOT NULL REFERENCES clients(id),
  period_kind  text NOT NULL CHECK (period_kind IN ('SEMANA','MES','DEMANDA')),
  period_key   text NOT NULL,
  status       text NOT NULL DEFAULT 'ABIERTO' CHECK (status IN ('ABIERTO','CERRADO','ENVIADO','FACTURADO','COBRADO','ANULADO')),
  total        numeric(14,2) NOT NULL DEFAULT 0 CHECK (total >= 0),
  invoice_id   text,
  closed_at    timestamptz,
  closed_by    uuid REFERENCES users(id),
  notes        text,
  created_by   uuid REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT maquila_statements_uq UNIQUE (sede_id, client_id, period_kind, period_key)
);
CREATE INDEX maquila_statements_cliente ON maquila_statements (client_id, status, period_key);

-- ───────────────────────── Órdenes de maquila ─────────────────────────
CREATE TABLE maquila_orders (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sede_id        text NOT NULL REFERENCES sedes(id),
  client_id      uuid NOT NULL REFERENCES clients(id),
  project_id     uuid NOT NULL REFERENCES projects(id),
  statement_id   uuid REFERENCES maquila_statements(id),
  order_date     date NOT NULL,
  shift          text NOT NULL DEFAULT 'DIA' CHECK (shift IN ('DIA','TARDE','NOCHE')),
  sap            text,
  product_name   text,
  unit           text NOT NULL DEFAULT 'UNIDAD',
  target_qty     numeric(14,2) NOT NULL DEFAULT 0 CHECK (target_qty >= 0),
  produced_qty   numeric(14,2) NOT NULL DEFAULT 0 CHECK (produced_qty >= 0),
  status         text NOT NULL DEFAULT 'PROGRAMADA' CHECK (status IN
                   ('PROGRAMADA','EN_PROCESO','CERRADA','VALIDADA_SOP','VALIDADA_JEFATURA','VALIDADA','RECHAZADA','EN_CARGO','FACTURADA','COBRADA','ANULADA')),
  started_at     timestamptz,
  finished_at    timestamptz,
  closed_at      timestamptz,
  closed_by      uuid REFERENCES users(id),
  validated_at   timestamptz,
  validated_by   uuid REFERENCES users(id),
  invoice_id     text,
  notes          text,
  version        integer NOT NULL DEFAULT 1,
  created_by     uuid REFERENCES users(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT maquila_orders_times_ck CHECK (started_at IS NULL OR finished_at IS NULL OR finished_at > started_at),
  CONSTRAINT maquila_orders_closed_ck CHECK (status <> 'CERRADA' OR (started_at IS NOT NULL AND finished_at IS NOT NULL))
);
CREATE INDEX maquila_orders_sede_fecha ON maquila_orders (sede_id, order_date, status);
CREATE INDEX maquila_orders_cliente ON maquila_orders (client_id, status, order_date);
CREATE INDEX maquila_orders_proyecto ON maquila_orders (project_id, order_date);
CREATE INDEX maquila_orders_cargo ON maquila_orders (statement_id) WHERE statement_id IS NOT NULL;
CREATE INDEX maquila_orders_captura ON maquila_orders (sede_id, order_date) WHERE status IN ('PROGRAMADA','EN_PROCESO');

-- ───────────────────────── Asignaciones por persona ─────────────────────────
-- Se desasigna con active=false; no se borra. La unicidad solo aplica a las activas.
CREATE TABLE maquila_assignments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id     uuid NOT NULL REFERENCES maquila_orders(id),
  person_id    uuid NOT NULL REFERENCES maquila_people(id),
  qty_assigned numeric(14,2) NOT NULL DEFAULT 0 CHECK (qty_assigned >= 0),
  qty_done     numeric(14,2) NOT NULL DEFAULT 0 CHECK (qty_done >= 0),
  started_at   timestamptz,
  finished_at  timestamptz,
  active       boolean NOT NULL DEFAULT true,
  notes        text,
  created_by   uuid REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT maquila_assignments_times_ck CHECK (started_at IS NULL OR finished_at IS NULL OR finished_at > started_at)
);
CREATE UNIQUE INDEX maquila_assignments_uq ON maquila_assignments (order_id, person_id) WHERE active;
CREATE INDEX maquila_assignments_order ON maquila_assignments (order_id);
CREATE INDEX maquila_assignments_person ON maquila_assignments (person_id, started_at);

-- ───────────────────────── Validaciones ─────────────────────────
-- Historial inmutable: cada intento (aprobado o rechazado) deja su fila.
CREATE TABLE maquila_validations (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id   uuid NOT NULL REFERENCES maquila_orders(id),
  stage      text NOT NULL CHECK (stage IN ('SOP','JEFATURA','VALIDADOR')),
  decision   text NOT NULL CHECK (decision IN ('APROBADA','RECHAZADA')),
  reason     text,
  user_id    uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT maquila_validations_reason_ck CHECK (decision <> 'RECHAZADA' OR char_length(btrim(coalesce(reason,''))) >= 5)
);
CREATE INDEX maquila_validations_order ON maquila_validations (order_id, created_at);

-- ───────────────────────── Líneas del cargo ─────────────────────────
-- Snapshot de cantidad y tarifa al agrupar. active permite anular el cargo sin borrar.
CREATE TABLE maquila_statement_lines (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  statement_id uuid NOT NULL REFERENCES maquila_statements(id),
  order_id     uuid NOT NULL REFERENCES maquila_orders(id),
  qty          numeric(14,2) NOT NULL CHECK (qty >= 0),
  rate         numeric(14,4) CHECK (rate IS NULL OR rate >= 0),
  amount       numeric(14,2) CHECK (amount IS NULL OR amount >= 0),
  active       boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT maquila_statement_lines_uq UNIQUE (statement_id, order_id)
);
CREATE UNIQUE INDEX maquila_statement_lines_order_uq ON maquila_statement_lines (order_id) WHERE active;
CREATE INDEX maquila_statement_lines_stmt ON maquila_statement_lines (statement_id) WHERE active;

-- ───────────────────────── Candados ─────────────────────────
-- No borrar: se anula/desactiva.
CREATE TRIGGER no_delete BEFORE DELETE ON maquila_people          FOR EACH ROW EXECUTE FUNCTION trg_no_delete();
CREATE TRIGGER no_delete BEFORE DELETE ON maquila_orders          FOR EACH ROW EXECUTE FUNCTION trg_no_delete();
CREATE TRIGGER no_delete BEFORE DELETE ON maquila_assignments     FOR EACH ROW EXECUTE FUNCTION trg_no_delete();
CREATE TRIGGER no_delete BEFORE DELETE ON maquila_validations     FOR EACH ROW EXECUTE FUNCTION trg_no_delete();
CREATE TRIGGER no_delete BEFORE DELETE ON maquila_statements      FOR EACH ROW EXECUTE FUNCTION trg_no_delete();
CREATE TRIGGER no_delete BEFORE DELETE ON maquila_statement_lines FOR EACH ROW EXECUTE FUNCTION trg_no_delete();

-- Periodo cerrado: impide crear la orden o cambiar datos de producción, pero deja avanzar
-- el estado a EN_CARGO/FACTURADA/COBRADA después del cierre (la factura se hace más tarde).
CREATE FUNCTION trg_maquila_lock_period() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM assert_period_open(NEW.order_date);
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    PERFORM assert_period_open(OLD.order_date);
    RETURN OLD;
  END IF;
  IF NEW.order_date IS DISTINCT FROM OLD.order_date
     OR NEW.produced_qty IS DISTINCT FROM OLD.produced_qty
     OR NEW.started_at IS DISTINCT FROM OLD.started_at
     OR NEW.finished_at IS DISTINCT FROM OLD.finished_at THEN
    PERFORM assert_period_open(NEW.order_date);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER lock_period BEFORE INSERT OR UPDATE OR DELETE ON maquila_orders FOR EACH ROW EXECUTE FUNCTION trg_maquila_lock_period();

-- Las asignaciones heredan la fecha de su orden.
CREATE FUNCTION trg_maquila_assignment_period() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE d date;
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT order_date INTO d FROM maquila_orders WHERE id = OLD.order_id;
    PERFORM assert_period_open(d);
    RETURN OLD;
  END IF;
  SELECT order_date INTO d FROM maquila_orders WHERE id = NEW.order_id;
  PERFORM assert_period_open(d);
  RETURN NEW;
END $$;
CREATE TRIGGER lock_period BEFORE INSERT OR UPDATE OR DELETE ON maquila_assignments FOR EACH ROW EXECUTE FUNCTION trg_maquila_assignment_period();

-- ───────────────────────── Vistas de apoyo ─────────────────────────
-- Maquilas validadas y todavía sin cargo: lo que Facturación puede agrupar.
CREATE VIEW maquila_por_facturar AS
SELECT o.id, o.sede_id, o.client_id, c.name AS client_name, o.project_id, p.name AS project_name,
       o.order_date, o.shift, o.sap, o.product_name, o.unit, o.produced_qty, o.validated_at
FROM maquila_orders o
JOIN clients c ON c.id = o.client_id
JOIN projects p ON p.id = o.project_id
WHERE o.status = 'VALIDADA' AND o.statement_id IS NULL;

-- Productividad por orden: unidades por hora con los tiempos reales.
CREATE VIEW maquila_productividad AS
SELECT o.id, o.sede_id, o.client_id, o.project_id, o.order_date, o.shift, o.unit,
       o.produced_qty,
       round((EXTRACT(EPOCH FROM (o.finished_at - o.started_at)) / 3600)::numeric, 2) AS hours,
       round((o.produced_qty / nullif(EXTRACT(EPOCH FROM (o.finished_at - o.started_at)) / 3600, 0))::numeric, 2) AS units_per_hour
FROM maquila_orders o
WHERE o.started_at IS NOT NULL AND o.finished_at IS NOT NULL AND o.finished_at > o.started_at;

COMMENT ON TABLE maquila_people IS 'Personas de maquila por sede. Lista local; se sincroniza con GEOVICTORIA por external_ref.';
COMMENT ON TABLE maquila_orders IS 'Orden de maquila: unidad operativa y facturable. Separada de viajes.';
COMMENT ON TABLE maquila_statements IS 'Cargo que agrupa maquilas validadas de un cliente; se factura en el módulo comercial.';
COMMENT ON TABLE maquila_statement_lines IS 'Detalle congelado del cargo (cantidad y tarifa al agrupar).';
