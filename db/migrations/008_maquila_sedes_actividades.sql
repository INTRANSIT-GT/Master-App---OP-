-- 008 · Maquilas por sede: cada sede tiene sus propios proyectos (los clientes siguen siendo comunes),
--       actividades dentro de cada proyecto, confirmación previa del cliente y desglose de la salida.
--       Corrige además el candado de periodo de maquilas: 004 llamaba a assert_period_open(fecha), que 003
--       había reemplazado por assert_period_open(sede, fecha), y por eso no se podía crear ninguna orden.
--
-- Catálogo: lista de proyectos y actividades por sede entregada por Ing. Carmen el 2026-10-30.
-- Categorías de servicio (Ing. Carmen, 2026-10-30): Maquila, la principal, y Outsourcing (Unisuper, Dollar City,
-- Revisión y Sunchips de Omnia). Outsourcing es una categoría, no un proyecto.

-- ───────── candado de periodo de maquilas, por sede ─────────
CREATE OR REPLACE FUNCTION trg_maquila_lock_period() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM assert_period_open(NEW.sede_id, NEW.order_date);
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    PERFORM assert_period_open(OLD.sede_id, OLD.order_date);
    RETURN OLD;
  END IF;
  IF NEW.order_date IS DISTINCT FROM OLD.order_date
     OR NEW.produced_qty IS DISTINCT FROM OLD.produced_qty
     OR NEW.produced_detail IS DISTINCT FROM OLD.produced_detail
     OR NEW.started_at IS DISTINCT FROM OLD.started_at
     OR NEW.finished_at IS DISTINCT FROM OLD.finished_at THEN
    PERFORM assert_period_open(NEW.sede_id, NEW.order_date);
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION trg_maquila_assignment_period() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE d date; s text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT order_date, sede_id INTO d, s FROM maquila_orders WHERE id = OLD.order_id;
    PERFORM assert_period_open(s, d);
    RETURN OLD;
  END IF;
  SELECT order_date, sede_id INTO d, s FROM maquila_orders WHERE id = NEW.order_id;
  PERFORM assert_period_open(s, d);
  RETURN NEW;
END $$;

-- ───────── proyectos por sede ─────────
-- Lo existente nace en Omnia (la única sede que había) y abajo se reparte según la lista.
ALTER TABLE projects ADD COLUMN sede_id text NOT NULL DEFAULT 'OMNIA' REFERENCES sedes(id);
ALTER TABLE projects ALTER COLUMN sede_id DROP DEFAULT;
ALTER TABLE projects DROP CONSTRAINT projects_client_id_code_key, ADD CONSTRAINT projects_sede_client_code_key UNIQUE (sede_id, client_id, code);
CREATE INDEX projects_sede ON projects (sede_id, active, sort);

-- Cómo se trabaja el proyecto (se muestra al programar), confirmación que el cliente debe dar antes de iniciar
-- (vacía = no requiere) y partes en que se desglosa la cantidad producida (vacía = una sola cantidad).
ALTER TABLE projects
  ADD COLUMN category      text NOT NULL DEFAULT 'MAQUILA' CHECK (category IN ('MAQUILA', 'OUTSOURCING')),
  ADD COLUMN process_notes text,
  ADD COLUMN confirm_label text,
  ADD COLUMN output_parts  text[] NOT NULL DEFAULT '{}';

-- ───────── actividades de cada proyecto ─────────
CREATE TABLE project_activities (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES projects(id),
  code        text NOT NULL,
  name        text NOT NULL,
  active      boolean NOT NULL DEFAULT true,
  sort        integer NOT NULL DEFAULT 0,
  UNIQUE (project_id, code)
);
CREATE TRIGGER no_delete BEFORE DELETE ON project_activities FOR EACH ROW EXECUTE FUNCTION trg_no_delete();

-- ───────── orden de maquila: actividad, confirmación del cliente y desglose ─────────
ALTER TABLE maquila_orders
  ADD COLUMN activity_id          uuid REFERENCES project_activities(id),
  ADD COLUMN client_confirmation  text,
  ADD COLUMN confirmed_at         timestamptz,
  ADD COLUMN confirmed_by         uuid REFERENCES users(id),
  ADD COLUMN produced_detail      jsonb NOT NULL DEFAULT '{}'::jsonb;
CREATE INDEX maquila_orders_actividad ON maquila_orders (activity_id) WHERE activity_id IS NOT NULL;

-- ───────── catálogo por sede (lista del 2026-10-30) ─────────
INSERT INTO clients (code, name, sort)
SELECT 'CEBOLLINES', 'Cebollines', coalesce(max(sort), 0) + 1 FROM clients
ON CONFLICT (code) DO NOTHING;

-- SEDE INTRANSIT Z11: Coca Cola, Alnost, Xporta, Cebollines y Licorera
UPDATE projects p SET sede_id = 'Z11' FROM clients c
 WHERE c.id = p.client_id AND c.code IN ('COCACOLA', 'ALNOST', 'XPORTA', 'LICORERA');
UPDATE projects p SET name = v.name FROM clients c, (VALUES
  ('ENV', 'Trasiego de envase'), ('TAR', 'Trasiego de tarimas'), ('PACKS', 'Armado de packs'), ('DESARME', 'Desarme')
) AS v(code, name) WHERE c.id = p.client_id AND c.code = 'COCACOLA' AND p.code = v.code;
UPDATE projects p SET
  confirm_label = 'Producto y fecha confirmados por el cliente',
  process_notes = 'Se envía al cliente por WhatsApp la fotografía de los productos en bodega con su fecha. El cliente valida y confirma qué producto y qué fecha se trabajan.'
  FROM clients c WHERE c.id = p.client_id AND c.code = 'ALNOST' AND p.code = 'VF';
-- Xporta hace etiquetado (no validación de fechas); Licorera, maquila de ofertas. Lo anterior se desactiva, no se borra.
UPDATE projects p SET active = false FROM clients c
 WHERE c.id = p.client_id AND ((c.code = 'XPORTA' AND p.code = 'VF') OR (c.code = 'LICORERA' AND p.code IN ('ETQ', 'PACKS')));
INSERT INTO projects (sede_id, client_id, code, name, kinds, um, sort, confirm_label, process_notes)
SELECT 'Z11', c.id, v.code, v.name, ARRAY['gen'], v.um, v.sort, v.confirm, v.notes
  FROM clients c JOIN (VALUES
    ('XPORTA', 'ETQ', 'Etiquetado', 'UNIDAD', 2, 'Exportador confirmado por el cliente',
     'El cliente confirma qué exportador se lleva el producto; con eso se imprimen y completan las etiquetas.'),
    ('CEBOLLINES', 'PACKS', 'Maquila de packs', 'PACK', 1, NULL,
     'Entran cajas (p. ej. 12 unidades de salsa verde y 12 de salsa roja). Se sacan, se limpian y se juntan con una manga; pasan por el túnel para que se adhiera; se coloca la etiqueta EAN y una etiqueta en blanco que cubre los códigos de barra. Salida: bandejas con packs.'),
    ('LICORERA', 'OFE', 'Maquila de ofertas', 'UNIDAD', 3, NULL, NULL)
  ) AS v(client, code, name, um, sort, confirm, notes) ON v.client = c.code
ON CONFLICT (sede_id, client_id, code) DO NOTHING;

-- SEDE FRITOLAY OMNIA: Fritolay (los proyectos ya están); Unisuper, Dollar City, Revisión y Sunchips son outsourcing
UPDATE projects p SET category = 'OUTSOURCING' FROM clients c
 WHERE c.id = p.client_id AND c.code = 'FRITOLAY' AND p.sede_id = 'OMNIA' AND p.code IN ('UNI', 'DC', 'REVM', 'SUN');

-- SEDE FRITOLAY SAN JUAN: maquilado de cartón, se presenta en unidades de cartón A, B y C
INSERT INTO projects (sede_id, client_id, code, name, kinds, um, sort, output_parts)
SELECT 'SAN-JUAN', c.id, 'CARTON', 'Maquilado de cartón', ARRAY['gen'], 'UNIDAD', 1, ARRAY['Cartón A', 'Cartón B', 'Cartón C']
  FROM clients c WHERE c.code = 'FRITOLAY'
ON CONFLICT (sede_id, client_id, code) DO NOTHING;

-- Actividades
INSERT INTO project_activities (project_id, code, name, sort)
SELECT p.id, v.acode, v.aname, v.sort
  FROM projects p JOIN clients c ON c.id = p.client_id
  JOIN (VALUES
    ('OMNIA', 'FRITOLAY', 'MAQ', 'OFPK', 'Armado de ofertas y packs', 1),
    ('OMNIA', 'FRITOLAY', 'WM', 'REV', 'Revisión', 1),
    ('OMNIA', 'FRITOLAY', 'WM', 'TRAS', 'Trasiego', 2),
    ('OMNIA', 'FRITOLAY', 'WM', 'CETQ', 'Cambio de etiqueta', 3),
    ('OMNIA', 'FRITOLAY', 'WM', 'FLEJ', 'Flejado', 4),
    ('OMNIA', 'FRITOLAY', 'ETQ', 'ETQ', 'Etiquetado', 1),
    ('OMNIA', 'FRITOLAY', 'DESC', 'DCON', 'Descargas de contenedores', 1),
    ('OMNIA', 'FRITOLAY', 'COB', 'EMOF', 'Embolsado de ofertas', 1),
    ('OMNIA', 'FRITOLAY', 'CRK', 'RIST', 'Armado de ristra de Crackets', 1),
    ('SAN-JUAN', 'FRITOLAY', 'CARTON', 'AMAR', 'Amarre', 1),
    ('SAN-JUAN', 'FRITOLAY', 'CARTON', 'TACH', 'Tachado', 2),
    ('SAN-JUAN', 'FRITOLAY', 'CARTON', 'CLAS', 'Clasificación de cartón', 3)
  ) AS v(sede, client, pcode, acode, aname, sort) ON v.sede = p.sede_id AND v.client = c.code AND v.pcode = p.code
ON CONFLICT (project_id, code) DO NOTHING;

-- Los registros de DEMOSTRACIÓN de clientes que ahora son de Z11 se mueven a Z11 (eran de Omnia porque era la única sede).
-- Solo is_demo: un registro real nunca cambia de sede en silencio.
SELECT set_config('omnia.override_lock', 'on', true);
UPDATE production_records r SET sede_id = p.sede_id
  FROM projects p WHERE p.id = r.project_id AND r.is_demo AND r.sede_id <> p.sede_id;
SELECT set_config('omnia.override_lock', 'off', true);

-- Por facturar: con la actividad y el desglose
DROP VIEW maquila_por_facturar;
CREATE VIEW maquila_por_facturar AS
SELECT o.id, o.sede_id, o.client_id, c.name AS client_name, o.project_id, p.name AS project_name,
       o.activity_id, a.name AS activity_name,
       o.order_date, o.shift, o.sap, o.product_name, o.unit, o.produced_qty, o.produced_detail, o.validated_at
FROM maquila_orders o
JOIN clients c ON c.id = o.client_id
JOIN projects p ON p.id = o.project_id
LEFT JOIN project_activities a ON a.id = o.activity_id
WHERE o.status = 'VALIDADA' AND o.statement_id IS NULL;

COMMENT ON COLUMN projects.sede_id IS 'Sede donde se trabaja el proyecto. Los clientes son comunes; los proyectos, de cada sede.';
COMMENT ON COLUMN projects.category IS 'Categoría de servicio: MAQUILA (la principal) u OUTSOURCING.';
COMMENT ON COLUMN projects.confirm_label IS 'Confirmación que el cliente da antes de iniciar (p. ej. exportador). Vacía = no requiere.';
COMMENT ON COLUMN projects.output_parts IS 'Partes en que se desglosa la cantidad producida (p. ej. cartón A/B/C). Vacía = una sola cantidad.';
COMMENT ON TABLE project_activities IS 'Actividades de un proyecto (p. ej. Walmart: revisión, trasiego, cambio de etiqueta, flejado).';
