-- v2: clientes y proyectos, órdenes de compra, inventario de insumos, módulo comercial,
--     retiro de áreas (outsourcing, entregas Villa Nueva, administración, coordinador) y bloqueo de borrado.

ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'comercial';

-- ───────── clientes y proyectos ─────────
CREATE TABLE clients (
  id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code    text NOT NULL UNIQUE,
  name    text NOT NULL,
  active  boolean NOT NULL DEFAULT true,
  sort    integer NOT NULL DEFAULT 0
);
CREATE TABLE projects (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES clients(id),
  code      text NOT NULL,
  name      text NOT NULL,
  kinds     text[] NOT NULL,                 -- tipos de registro de producción que admite (el primero es el predeterminado); 'gen' = registro genérico
  um        text NOT NULL DEFAULT 'UNIDAD',  -- unidad de medida de la cantidad (informativo y para el cobro)
  active    boolean NOT NULL DEFAULT true,
  sort      integer NOT NULL DEFAULT 0,
  UNIQUE (client_id, code)
);

WITH c AS (
  INSERT INTO clients (code, name, sort) VALUES ('FRITOLAY','Fritolay',1), ('COCACOLA','Coca Cola',2), ('ALNOST','Alnost',3), ('XPORTA','XPORTA',4), ('LICORERA','Licorera',5)
  RETURNING id, code)
INSERT INTO projects (client_id, code, name, kinds, um, sort)
SELECT c.id, p.code, p.name, p.kinds, p.um, p.sort FROM c JOIN (VALUES
  ('FRITOLAY','MAQ','Maquila',                           ARRAY['maq'],            'CAJA',     1),
  ('FRITOLAY','WM','Walmart',                            ARRAY['wm'],             'UNIDADES', 2),
  ('FRITOLAY','COB','Embolsado Cobán',                   ARRAY['cob'],            'CAJA',     3),
  ('FRITOLAY','DESC','Descargas',                        ARRAY['desc'],           'CONTEN.',  4),
  ('FRITOLAY','UNI','Unisuper',                          ARRAY['uni'],            'UNIDADES', 5),
  ('FRITOLAY','DC','Dollar City',                        ARRAY['dc'],             'CAJA',     6),
  ('FRITOLAY','REVM','Revisión',                         ARRAY['revm'],           'UNIDADES', 7),
  ('FRITOLAY','ETQ','Etiquetado',                        ARRAY['etq','noc','qua'],'UNIDADES', 8),
  ('FRITOLAY','SUN','Sunchips',                          ARRAY['sun'],            'UNIDADES', 9),
  ('FRITOLAY','CRK','Crackets',                          ARRAY['crk'],            'CAJA',     10),
  ('COCACOLA','ENV','Habilitación de envase - trasiego', ARRAY['gen'],            'UNIDAD',   1),
  ('COCACOLA','TAR','Habilitación de tarimas - trasiego',ARRAY['gen'],            'TARIMA',   2),
  ('COCACOLA','PACKS','Packs',                           ARRAY['gen'],            'PACK',     3),
  ('COCACOLA','DESARME','Desarme',                       ARRAY['gen'],            'UNIDAD',   4),
  ('ALNOST','VF','Validación de fechas',                 ARRAY['gen'],            'CAJA',     1),
  ('XPORTA','VF','Validación de fechas',                 ARRAY['gen'],            'CAJA',     1),
  ('LICORERA','ETQ','Etiquetado',                        ARRAY['gen'],            'UNIDAD',   1),
  ('LICORERA','PACKS','Packs',                           ARRAY['gen'],            'PACK',     2)
) AS p(client, code, name, kinds, um, sort) ON p.client = c.code;

-- producción: proyecto y registro genérico
ALTER TABLE production_records DROP CONSTRAINT production_records_kind_check;
ALTER TABLE production_records ADD CONSTRAINT production_records_kind_check
  CHECK (kind IN ('maq','wm','cob','desc','uni','dc','revm','etq','noc','qua','sun','crk','gen'));
ALTER TABLE production_records ADD COLUMN project_id uuid REFERENCES projects(id);
UPDATE production_records r SET project_id = p.id FROM projects p WHERE r.kind = ANY(p.kinds) AND p.kinds[1] <> 'gen' AND p.client_id = (SELECT id FROM clients WHERE code='FRITOLAY');
CREATE INDEX production_records_project ON production_records (project_id, record_date) WHERE status = 'confirmado';

-- ───────── áreas retiradas ─────────
ALTER TABLE hours_records DISABLE TRIGGER lock_period;
DELETE FROM hours_records WHERE is_demo AND kind IN ('adm','os','evn','coord');
UPDATE hours_records SET status = 'anulado', void_reason = 'Área retirada del sistema (v2)', voided_at = now()
 WHERE NOT is_demo AND kind IN ('adm','os','evn','coord') AND status <> 'anulado';
ALTER TABLE hours_records ENABLE TRIGGER lock_period;
ALTER TABLE hours_records DROP CONSTRAINT hours_records_kind_check;
ALTER TABLE hours_records ADD CONSTRAINT hours_records_kind_check CHECK (kind IN ('adm','os','evn','imp','coord','maqp'));  -- los antiguos solo existen anulados
ALTER TABLE hours_records ADD COLUMN project_id uuid REFERENCES projects(id);
DELETE FROM standards WHERE scope = 'line' AND key IN ('adm','evn','osD','osN','coord');
DELETE FROM process_lines WHERE key IN ('adm','evn','osD','osN','coord');

-- ───────── inventario de insumos ─────────
ALTER TABLE inv_items DROP CONSTRAINT inv_items_kind_check;
ALTER TABLE inv_items ADD CONSTRAINT inv_items_kind_check CHECK (kind IN ('lab','rib','bag','ins'));
ALTER TABLE inv_items ADD COLUMN unit text;

CREATE TABLE supply_movements (                      -- ingresos y consumos de insumos
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  move_date    date NOT NULL,
  item_id      text NOT NULL REFERENCES inv_items(id),
  kind         text NOT NULL CHECK (kind IN ('ingreso','consumo')),
  qty          numeric NOT NULL CHECK (qty > 0),
  project_id   uuid REFERENCES projects(id),
  area         text,                                -- sección del Resumen a la que se carga el costo del consumo (opcional)
  notes        text,
  po_line_id   uuid,                                -- si viene de una orden de compra completada
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
CREATE INDEX supply_movements_date ON supply_movements (move_date, item_id) WHERE status = 'confirmado';

-- ───────── órdenes de compra ─────────
CREATE TABLE counters (key text PRIMARY KEY, value integer NOT NULL);
-- Formato basado en «Orden de compra y/o requerimiento de pago» de Intransit (ejemplo OC_FLEETIO_JULIO.pdf)
CREATE TABLE purchase_orders (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prefix              text NOT NULL DEFAULT 'OC',          -- ORDEN NO. = prefijo-consecutivo (p. ej. FLEE-12)
  seq                 integer NOT NULL,
  number              text NOT NULL UNIQUE,
  po_date             date NOT NULL,
  cost_center         text,                                -- CENTRO DE COSTO
  service_type        text,                                -- SERVICIOS / categoría (p. ej. 08-TRANSPORTE)
  client_id           uuid REFERENCES clients(id),         -- cliente/proyecto para el que se compra (opcional)
  payment_condition   text NOT NULL DEFAULT 'CONTADO' CHECK (payment_condition IN ('CONTADO','CREDITO')),
  currency            text NOT NULL DEFAULT 'GTQ' CHECK (currency IN ('GTQ','USD')),
  exchange_rate       numeric NOT NULL DEFAULT 1 CHECK (exchange_rate > 0),   -- a quetzales, para costos y reportes
  supplier            text NOT NULL,
  supplier_contact    text,
  supplier_address    text,
  supplier_nit        text,
  supplier_phone      text,
  credit_days         text,
  advance_pct         numeric CHECK (advance_pct IS NULL OR (advance_pct >= 0 AND advance_pct <= 100)),
  advance_amount      numeric CHECK (advance_amount IS NULL OR advance_amount >= 0),
  payment_method      text,                                -- FORMA DE PAGO
  bank_account        text,
  bank                text,
  account_type        text,
  instructions        text,
  requested_by        text,                                -- SOLICITADO POR
  deliver_to          text,                                -- ENTREGAR A
  delivery_place      text,                                -- LUGAR DE ENTREGA
  prepared_by         text,                                -- REALIZADO POR (nombre y cargo)
  prepared_position   text,
  approved_by         text,                                -- AUTORIZA (nombre y puesto)
  approved_position   text,
  lot                 text,
  check_no            text,
  notes               text,
  status              text NOT NULL DEFAULT 'borrador' CHECK (status IN ('borrador','emitida','completada','anulada')),
  total               numeric NOT NULL DEFAULT 0 CHECK (total >= 0),   -- en la moneda de la OC
  issued_at           timestamptz,
  received_date       date,
  completed_at        timestamptz,
  completed_by        uuid REFERENCES users(id),
  is_demo             boolean NOT NULL DEFAULT false,
  void_reason         text,
  voided_by           uuid REFERENCES users(id),
  voided_at           timestamptz,
  created_by          uuid REFERENCES users(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_by          uuid REFERENCES users(id),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  version             integer NOT NULL DEFAULT 1,
  UNIQUE (prefix, seq),
  CHECK ((status = 'anulada') = (voided_at IS NOT NULL)),
  CHECK (status <> 'anulada' OR coalesce(length(trim(void_reason)),0) >= 5)
);
CREATE TABLE purchase_order_lines (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  po_id       uuid NOT NULL REFERENCES purchase_orders(id),
  line_no     integer NOT NULL,
  code        text,                                  -- CÓDIGO (SAP / código del bien)
  mat_type    text NOT NULL DEFAULT 'Otro' CHECK (mat_type IN ('Etiqueta','Ribbon','Bolsa','Insumo','Directo','Otro')),
  mat_ref     text,                                  -- código de etiqueta / ribbon, id de insumo (conecta con inventario)
  description text NOT NULL,                         -- DESCRIPCIÓN DEL BIEN O SERVICIO
  qty         numeric NOT NULL CHECK (qty > 0),      -- CANTIDAD
  unit_price  numeric NOT NULL DEFAULT 0 CHECK (unit_price >= 0),   -- PRECIO UNITARIO
  amount      numeric NOT NULL DEFAULT 0 CHECK (amount >= 0),       -- MONTO TOTAL
  area        text,                                  -- sección del Resumen (Directo/Otro restan costo del área)
  UNIQUE (po_id, line_no)
);
CREATE INDEX purchase_orders_date ON purchase_orders (po_date DESC);

ALTER TABLE requirements ADD COLUMN po_line_id uuid REFERENCES purchase_order_lines(id);
ALTER TABLE supply_movements ADD CONSTRAINT supply_po_line_fk FOREIGN KEY (po_line_id) REFERENCES purchase_order_lines(id);

CREATE TRIGGER lock_period BEFORE INSERT OR UPDATE OR DELETE ON supply_movements FOR EACH ROW EXECUTE FUNCTION trg_lock_period('move_date');

-- ───────── módulo comercial: tarifas de cobro por proyecto ─────────
CREATE TABLE billing_rates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES projects(id),
  rate        numeric NOT NULL CHECK (rate >= 0),
  unit        text NOT NULL,
  valid_from  date NOT NULL,
  valid_to    date,
  note        text,
  created_by  uuid REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (valid_to IS NULL OR valid_to >= valid_from),
  EXCLUDE USING gist (project_id WITH =, daterange(valid_from, coalesce(valid_to, 'infinity'::date), '[]') WITH &&)
);

-- ───────── los registros no se borran: solo se anulan ─────────
CREATE FUNCTION trg_no_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'REGISTRO_NO_BORRABLE: % no se borra; se anula con justificación', TG_TABLE_NAME USING ERRCODE = 'P0002'; END $$;
CREATE TRIGGER no_delete BEFORE DELETE ON production_records     FOR EACH ROW EXECUTE FUNCTION trg_no_delete();
CREATE TRIGGER no_delete BEFORE DELETE ON hours_records          FOR EACH ROW EXECUTE FUNCTION trg_no_delete();
CREATE TRIGGER no_delete BEFORE DELETE ON requirements           FOR EACH ROW EXECUTE FUNCTION trg_no_delete();
CREATE TRIGGER no_delete BEFORE DELETE ON inventory_scrap        FOR EACH ROW EXECUTE FUNCTION trg_no_delete();
CREATE TRIGGER no_delete BEFORE DELETE ON supply_movements       FOR EACH ROW EXECUTE FUNCTION trg_no_delete();
CREATE TRIGGER no_delete BEFORE DELETE ON purchase_orders        FOR EACH ROW EXECUTE FUNCTION trg_no_delete();
-- las líneas de una OC solo se pueden quitar mientras la orden es borrador/emitida (el cambio queda en la bitácora)
CREATE FUNCTION trg_po_line_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT status FROM purchase_orders WHERE id = OLD.po_id) IN ('borrador','emitida') THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'REGISTRO_NO_BORRABLE: las líneas de una orden completada o anulada no se borran' USING ERRCODE = 'P0002';
END $$;
CREATE TRIGGER no_delete BEFORE DELETE ON purchase_order_lines FOR EACH ROW EXECUTE FUNCTION trg_po_line_delete();
CREATE TRIGGER no_delete BEFORE DELETE ON audit_log              FOR EACH ROW EXECUTE FUNCTION trg_no_delete();
