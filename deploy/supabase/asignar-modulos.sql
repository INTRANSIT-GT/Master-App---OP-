-- Asignación de módulos por usuario (portal + módulos Transportes y Operaciones)
--
-- Dónde se guarda: auth.users.raw_app_meta_data -> 'modulos' (aparece en el token como app_metadata.modulos).
--   { "operaciones": "supervisor", "transportes": "usuario" }
-- El valor de cada módulo es el rol DENTRO de ese módulo. Operaciones acepta:
--   administrador | supervisor | operador | consulta | comercial
-- app_metadata solo lo cambia el servidor (SQL Editor o service_role): el usuario NO puede editarlo.
-- No uses user_metadata para esto: lo puede modificar el propio usuario.
--
-- Ejecutar a mano en el SQL Editor de Supabase. Los cambios llegan al token en el siguiente inicio
-- de sesión o renovación (hasta 1 hora), según la vigencia de los tokens del proyecto.

create or replace function public.asignar_modulo(p_email text, p_modulo text, p_rol text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_mods jsonb;
begin
  if p_modulo !~ '^[a-z][a-z0-9_]{1,30}$' then raise exception 'Nombre de módulo no válido: %', p_modulo; end if;
  select id, coalesce(raw_app_meta_data -> 'modulos', '{}'::jsonb) into v_id, v_mods from auth.users where lower(email) = lower(p_email);
  if v_id is null then raise exception 'No existe el usuario %', p_email; end if;
  -- formato lista ["operaciones"] → objeto, con rol mínimo
  if jsonb_typeof(v_mods) = 'array' then
    select coalesce(jsonb_object_agg(x, 'consulta'), '{}'::jsonb) into v_mods from jsonb_array_elements_text(v_mods) as x;
  end if;
  v_mods := v_mods || jsonb_build_object(p_modulo, coalesce(p_rol, 'usuario'));
  update auth.users set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('modulos', v_mods) where id = v_id;
  return v_mods;
end $$;

create or replace function public.quitar_modulo(p_email text, p_modulo text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_mods jsonb;
begin
  select id, coalesce(raw_app_meta_data -> 'modulos', '{}'::jsonb) into v_id, v_mods from auth.users where lower(email) = lower(p_email);
  if v_id is null then raise exception 'No existe el usuario %', p_email; end if;
  if jsonb_typeof(v_mods) = 'array' then
    select coalesce(jsonb_object_agg(x, 'consulta'), '{}'::jsonb) into v_mods from jsonb_array_elements_text(v_mods) as x;
  end if;
  v_mods := v_mods - p_modulo;
  update auth.users set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('modulos', v_mods) where id = v_id;
  return v_mods;
end $$;

-- Estas funciones cambian permisos: nadie desde la API pública (anon / authenticated) puede ejecutarlas.
revoke all on function public.asignar_modulo(text, text, text) from public, anon, authenticated;
revoke all on function public.quitar_modulo(text, text) from public, anon, authenticated;
grant execute on function public.asignar_modulo(text, text, text) to service_role;
grant execute on function public.quitar_modulo(text, text) to service_role;

-- ───────────── Ejemplos (descomenta y adapta) ─────────────
-- select public.asignar_modulo('ana@intransit.gt', 'operaciones', 'supervisor');
-- select public.asignar_modulo('ana@intransit.gt', 'transportes');
-- select public.quitar_modulo('luis@intransit.gt', 'operaciones');
--
-- Dar Transportes a todos los usuarios que ya existen (para no dejarlos sin acceso al activar el portal):
-- select public.asignar_modulo(email, 'transportes') from auth.users;
--
-- Ver las asignaciones:
-- select email, raw_app_meta_data -> 'modulos' as modulos from auth.users order by email;
