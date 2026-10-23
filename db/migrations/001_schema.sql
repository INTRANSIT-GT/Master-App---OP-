-- Omnia · esquema base (PostgreSQL 16)
-- Convenciones: fechas de negocio = DATE (sin zona horaria), dinero y cantidades = NUMERIC,
-- nada se borra: los registros se ANULAN con justificación y todo cambio queda en audit_log.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ───────────────────────── Usuarios y roles ─────────────────────────
CREATE TYPE user_role AS ENUM ('administrador', 'supervisor', 'operador', 'consulta');

CREATE TABLE users (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email          text NOT NULL,
  name           text NOT NULL,
  password_hash  text NOT NULL,
  role           user_role NOT NULL,
  active         boolean NOT NULL DEFAULT true,
  token_version  integer NOT NULL DEFAULT 0,       -- subirlo invalida sesiones
  failed_logins  integer NOT NULL DEFAULT 0,
  locked_until   timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_uq ON users (lower(email));

-- ───────────────────────── Catálogos ─────────────────────────
-- Líneas de proceso (filas de la hoja RESULTADOS). mode: mpt | mpu | uph | hrs | man | none
CREATE TABLE process_lines (
  key            text PRIMARY KEY,                  -- 'wm', 'cob', 'osD', ... ; las maquilas usan 'm:<SAP>' y no viven aquí
  results_group  text NOT NULL,                     -- grupo en la matriz de Resultados
  summary_group  text NOT NULL,                     -- sección del Resumen
  name           text NOT NULL,
  um             text NOT NULL,                     -- HH | UNIDADES | CAJA | CONTEN.
  mode           text NOT NULL CHECK (mode IN ('mpt','mpu','uph','hrs','man','none')),
  billable_label text,                              -- 'cajas de cobro' / 'cajas buenas' si cobra distinto a lo producido
  sort           integer NOT NULL
);

CREATE TABLE products (                              -- productos de maquila (SAP)
  sap            text PRIMARY KEY,
  name           text NOT NULL,
  active         boolean NOT NULL DEFAULT true,
  sort           integer NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- Estándares y tarifas con vigencia. scope='product' (key = SAP) o 'line' (key = process_lines.key).
-- tt: minutos por tarima (maquila), por caja/contenedor, o unidades por hora (según mode).
CREATE TABLE standards (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope              text NOT NULL CHECK (scope IN ('product','line')),
  key                text NOT NULL,
  tt                 numeric CHECK (tt IS NULL OR tt > 0),
  units_per_pallet   numeric CHECK (units_per_pallet IS NULL OR units_per_pallet > 0),   -- cajas por tarima (solo producto)
  unit_rate          numeric CHECK (unit_rate IS NULL OR unit_rate >= 0),                -- Q por caja/unidad cobrable
  valid_from         date NOT NULL,
  valid_to           date,
  note               text,
  created_by         uuid REFERENCES users(id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  CHECK (valid_to IS NULL OR valid_to >= valid_from),
  EXCLUDE USING gist (scope WITH =, key WITH =, daterange(valid_from, valid_to, '[]') WITH &&)
);
CREATE INDEX standards_lookup ON standards (scope, key, valid_from);

CREATE TABLE settings (
  key         text PRIMARY KEY,
  value       jsonb NOT NULL,
  updated_by  uuid REFERENCES users(id),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- ───────────────────────── Inventario: artículos y catálogos ─────────────────────────
CREATE TABLE inv_items (
  id              text PRIMARY KEY,                -- 'L:3X2', 'R:R76', 'BOLSA'
  kind            text NOT NULL CHECK (kind IN ('lab','rib','bag')),
  code            text NOT NULL,                   -- '3X2', 'R76', 'BOLSA'
  name            text NOT NULL,
  units_per_roll  numeric CHECK (units_per_roll IS NULL OR units_per_roll > 0),  -- etiquetas por rollo
  ribbon_id       text REFERENCES inv_items(id),   -- ribbon con el que se imprime la etiqueta
  ribbon_yield    numeric CHECK (ribbon_yield IS NULL OR ribbon_yield > 0),      -- etiquetas por rollo de ribbon
  price           numeric CHECK (price IS NULL OR price >= 0),                  -- precio de rollo (lab/rib) o por unidad (bag)
  use_text        text,
  notes           text,
  sort            integer NOT NULL DEFAULT 0
);

CREATE TABLE bag_usage (                            -- bolsas por caja según SAP
  sap             text PRIMARY KEY REFERENCES products(sap),
  bags_per_box    numeric NOT NULL CHECK (bags_per_box > 0)
);

CREATE TABLE material_labels (                      -- «Etiqueta por material»
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sap         text,
  name        text NOT NULL,
  label       text NOT NULL DEFAULT '',            -- id de etiqueta | 'SUN' | 'none' | ''
  confirmed   boolean NOT NULL DEFAULT false,
  aliases     text[] NOT NULL DEFAULT '{}'
);
CREATE UNIQUE INDEX material_labels_sap_uq ON material_labels (sap) WHERE sap IS NOT NULL AND sap <> '';

CREATE TABLE inventory_counts (                     -- conteos físicos (base del rodado de inventario)
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  count_date  date NOT NULL,
  item_id     text NOT NULL REFERENCES inv_items(id),
  qty         numeric NOT NULL,                    -- unidades (lab, bag) o rollos (rib)
  created_by  uuid REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (count_date, item_id)
);

-- ───────────────────────── Importaciones (migración / contingencia) ─────────────────────────
CREATE TABLE import_batches (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source       text NOT NULL,                      -- 'estatus_diario' | 'outsourcing' | 'demo' | 'snapshot_html'
  file_name    text,
  file_sha256  text,
  status       text NOT NULL CHECK (status IN ('vista_previa','aplicado','fallido')),
  stats        jsonb NOT NULL DEFAULT '{}',
  errors       jsonb NOT NULL DEFAULT '[]',
  payload      jsonb,                              -- filas ya interpretadas (vista previa), se aplican al confirmar
  created_by   uuid REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  applied_at   timestamptz
);

-- ───────────────────────── Registros operativos ─────────────────────────
CREATE TYPE record_status AS ENUM ('borrador','confirmado','anulado');

-- Producción: maquila, walmart, cobán, descargas, unisuper, dollar city, revisión, etiquetado, crackets
CREATE TABLE production_records (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind             text NOT NULL CHECK (kind IN ('maq','wm','cob','desc','uni','dc','revm','etq','noc','qua','sun','crk')),
  record_date      date NOT NULL,
  ref_doc          text,                            -- egreso / remisión / factura / ingreso
  sap              text,
  product_name     text,
  boxes            numeric NOT NULL DEFAULT 0 CHECK (boxes >= 0),            -- cajas (o total maquilado, o cajas buenas en crackets)
  units            numeric NOT NULL DEFAULT 0 CHECK (units >= 0),            -- unidades totales / etiquetadas
  units_per_box    numeric CHECK (units_per_box IS NULL OR units_per_box >= 0),
  billable_boxes   numeric CHECK (billable_boxes IS NULL OR billable_boxes >= 0),   -- Walmart: cajas de cobro
  labels_used      numeric CHECK (labels_used IS NULL OR labels_used >= 0),         -- Unisuper: etiquetas utilizadas
  label_id         text,                            -- etiqueta capturada (etq/noc/qua)
  review_units     numeric NOT NULL DEFAULT 0 CHECK (review_units >= 0),    -- unidades revisadas
  bad_boxes        numeric NOT NULL DEFAULT 0 CHECK (bad_boxes >= 0),       -- cajas en mal estado / cruce
  container_type   text,                            -- descargas: GALLETA | SALADO | FLUS | QUAKER
  presentation     text,
  process_status   text CHECK (process_status IS NULL OR process_status IN ('FINALIZADO','PARCIAL','PROCESO')),
  notes            text,
  data             jsonb NOT NULL DEFAULT '{}',     -- campos propios de cada fuente (order type, T caja, ...)
  source           text NOT NULL DEFAULT 'captura', -- captura | import_estatus_diario | import_outsourcing | demo
  import_batch_id  uuid REFERENCES import_batches(id),
  source_key       text,                            -- huella natural para impedir duplicados
  is_demo          boolean NOT NULL DEFAULT false,
  status           record_status NOT NULL DEFAULT 'confirmado',
  void_reason      text,
  voided_by        uuid REFERENCES users(id),
  voided_at        timestamptz,
  created_by       uuid REFERENCES users(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_by       uuid REFERENCES users(id),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  version          integer NOT NULL DEFAULT 1,
  CHECK ((status = 'anulado') = (voided_at IS NOT NULL)),
  CHECK (status <> 'anulado' OR coalesce(length(trim(void_reason)),0) >= 5)
);
CREATE INDEX production_records_date ON production_records (record_date, kind) WHERE status = 'confirmado';
CREATE UNIQUE INDEX production_records_source_key_uq ON production_records (kind, source_key)
  WHERE source_key IS NOT NULL AND status <> 'anulado';

-- Horas y personal: administración, outsourcing (día/noche), entregas Villa Nueva, impresión, coordinador
CREATE TABLE hours_records (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind             text NOT NULL CHECK (kind IN ('adm','os','evn','imp','coord')),
  record_date      date NOT NULL,
  egress_no        text,
  area             text,
  activity         text,
  worker_name      text,
  hours_day        numeric NOT NULL DEFAULT 0 CHECK (hours_day >= 0),
  hours_night      numeric NOT NULL DEFAULT 0 CHECK (hours_night >= 0),
  notes            text,
  source           text NOT NULL DEFAULT 'captura',
  import_batch_id  uuid REFERENCES import_batches(id),
  source_key       text,
  is_demo          boolean NOT NULL DEFAULT false,
  status           record_status NOT NULL DEFAULT 'confirmado',
  void_reason      text,
  voided_by        uuid REFERENCES users(id),
  voided_at        timestamptz,
  created_by       uuid REFERENCES users(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_by       uuid REFERENCES users(id),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  version          integer NOT NULL DEFAULT 1,
  CHECK ((status = 'anulado') = (voided_at IS NOT NULL)),
  CHECK (status <> 'anulado' OR coalesce(length(trim(void_reason)),0) >= 5)
);
CREATE INDEX hours_records_date ON hours_records (record_date, kind) WHERE status = 'confirmado';
CREATE UNIQUE INDEX hours_records_source_key_uq ON hours_records (kind, source_key)
  WHERE source_key IS NOT NULL AND status <> 'anulado';
-- impresión / coordinador: una sola captura por día
CREATE UNIQUE INDEX hours_manual_day_uq ON hours_records (kind, record_date)
  WHERE kind IN ('imp','coord') AND status <> 'anulado';

CREATE TABLE attendance (                           -- asistencia semanal (horas pagadas)
  week_monday  date PRIMARY KEY CHECK (extract(isodow FROM week_monday) = 1),
  paid_hours   numeric NOT NULL CHECK (paid_hours >= 0),
  is_demo      boolean NOT NULL DEFAULT false,
  updated_by   uuid REFERENCES users(id),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  version      integer NOT NULL DEFAULT 1
);

CREATE TABLE requirements (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_date     date NOT NULL,
  area             text NOT NULL,                  -- maq|desc|etq|rev|os|wm|cob|uni|crk|dc|gen
  oc               text,
  amount           numeric NOT NULL DEFAULT 0 CHECK (amount >= 0),
  supplier         text,
  qty              numeric NOT NULL DEFAULT 0 CHECK (qty >= 0),
  mat_type         text NOT NULL CHECK (mat_type IN ('Etiqueta','Ribbon','Bolsa','Directo','Otro')),
  mat_ref          text,                            -- id de etiqueta / ribbon, o texto libre
  notes            text,
  is_demo          boolean NOT NULL DEFAULT false,
  status           record_status NOT NULL DEFAULT 'confirmado',
  void_reason      text,
  voided_by        uuid REFERENCES users(id),
  voided_at        timestamptz,
  created_by       uuid REFERENCES users(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_by       uuid REFERENCES users(id),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  version          integer NOT NULL DEFAULT 1,
  CHECK ((status = 'anulado') = (voided_at IS NOT NULL)),
  CHECK (status <> 'anulado' OR coalesce(length(trim(void_reason)),0) >= 5)
);
CREATE INDEX requirements_date ON requirements (request_date) WHERE status = 'confirmado';
CREATE UNIQUE INDEX requirements_oc_uq ON requirements (lower(oc), mat_type, coalesce(mat_ref,''), request_date)
  WHERE oc IS NOT NULL AND oc <> '' AND status <> 'anulado';

CREATE TABLE inventory_scrap (                      -- merma
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scrap_date   date NOT NULL,
  item_id      text NOT NULL REFERENCES inv_items(id),
  units        numeric NOT NULL CHECK (units > 0),
  reason       text,
  is_demo      boolean NOT NULL DEFAULT false,
  status       record_status NOT NULL DEFAULT 'confirmado',
  void_reason  text,
  voided_by    uuid REFERENCES users(id),
  voided_at    timestamptz,
  created_by   uuid REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_by   uuid REFERENCES users(id),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  version      integer NOT NULL DEFAULT 1,
  CHECK ((status = 'anulado') = (voided_at IS NOT NULL)),
  CHECK (status <> 'anulado' OR coalesce(length(trim(void_reason)),0) >= 5)
);
CREATE INDEX inventory_scrap_date ON inventory_scrap (scrap_date) WHERE status = 'confirmado';

CREATE TABLE incidents (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_date date NOT NULL,
  area         text,
  description  text NOT NULL,
  status       text NOT NULL DEFAULT 'abierta' CHECK (status IN ('abierta','resuelta')),
  created_by   uuid REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  resolved_at  timestamptz
);

-- ───────────────────────── Periodos y cierres ─────────────────────────
CREATE TABLE periods (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  month_key    integer NOT NULL UNIQUE,            -- año*12 + (mes-1), igual que el HTML
  year         integer NOT NULL,
  month        integer NOT NULL CHECK (month BETWEEN 1 AND 12),
  week_from    integer,                            -- override de semanas ISO (opcional)
  week_to      integer,
  start_date   date NOT NULL,
  end_date     date NOT NULL,
  status       text NOT NULL DEFAULT 'abierto' CHECK (status IN ('abierto','cerrado')),
  closed_by    uuid REFERENCES users(id),
  closed_at    timestamptz,
  close_notes  text,
  snapshot     jsonb,                              -- resultados congelados al cerrar
  warnings     jsonb NOT NULL DEFAULT '[]',        -- pendientes detectados al cerrar
  CHECK (end_date >= start_date)
);

-- Bloqueo: nadie modifica registros de un periodo cerrado (salvo reapertura explícita)
CREATE FUNCTION assert_period_open(d date) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF d IS NULL THEN RETURN; END IF;
  IF current_setting('omnia.override_lock', true) = 'on' THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM periods WHERE status = 'cerrado' AND d BETWEEN start_date AND end_date) THEN
    RAISE EXCEPTION 'PERIODO_CERRADO: la fecha % pertenece a un periodo cerrado', d USING ERRCODE = 'P0001';
  END IF;
END $$;

CREATE FUNCTION trg_lock_period() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE col text := TG_ARGV[0]; dn date; dold date;
BEGIN
  IF TG_OP IN ('INSERT','UPDATE') THEN EXECUTE format('SELECT ($1).%I::date', col) INTO dn USING NEW; PERFORM assert_period_open(dn); END IF;
  IF TG_OP IN ('UPDATE','DELETE') THEN EXECUTE format('SELECT ($1).%I::date', col) INTO dold USING OLD; PERFORM assert_period_open(dold); END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;

CREATE TRIGGER lock_period BEFORE INSERT OR UPDATE OR DELETE ON production_records FOR EACH ROW EXECUTE FUNCTION trg_lock_period('record_date');
CREATE TRIGGER lock_period BEFORE INSERT OR UPDATE OR DELETE ON hours_records      FOR EACH ROW EXECUTE FUNCTION trg_lock_period('record_date');
CREATE TRIGGER lock_period BEFORE INSERT OR UPDATE OR DELETE ON requirements       FOR EACH ROW EXECUTE FUNCTION trg_lock_period('request_date');
CREATE TRIGGER lock_period BEFORE INSERT OR UPDATE OR DELETE ON inventory_scrap    FOR EACH ROW EXECUTE FUNCTION trg_lock_period('scrap_date');
CREATE TRIGGER lock_period BEFORE INSERT OR UPDATE OR DELETE ON attendance         FOR EACH ROW EXECUTE FUNCTION trg_lock_period('week_monday');

-- ───────────────────────── Historial, idempotencia, integración ─────────────────────────
CREATE TABLE audit_log (
  id          bigserial PRIMARY KEY,
  at          timestamptz NOT NULL DEFAULT now(),
  user_id     uuid REFERENCES users(id),
  user_email  text,
  entity      text NOT NULL,
  entity_id   text NOT NULL,
  action      text NOT NULL,                       -- crear | editar | anular | confirmar | cerrar | reabrir | importar | login ...
  reason      text,
  before      jsonb,
  after       jsonb
);
CREATE INDEX audit_entity ON audit_log (entity, entity_id, at DESC);
CREATE INDEX audit_at ON audit_log (at DESC);

CREATE TABLE idempotency_keys (
  key           text NOT NULL,
  user_id       uuid NOT NULL REFERENCES users(id),
  request_hash  text NOT NULL,
  status_code   integer NOT NULL,
  response      jsonb NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (key, user_id)
);

-- Preparado para SAP: referencia externa por registro; no hay integración real (ver docs).
CREATE TABLE external_refs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity       text NOT NULL,
  entity_id    uuid NOT NULL,
  system       text NOT NULL DEFAULT 'SAP',
  external_id  text,
  sync_status  text NOT NULL DEFAULT 'pendiente' CHECK (sync_status IN ('pendiente','enviado','confirmado','error')),
  last_error   text,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (entity, entity_id, system)
);
