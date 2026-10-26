# 09 · Operaciones en GitHub Pages + Supabase (sin servidor propio)

Desde el 2026-10-25, OP funciona como Transportes: la web es un sitio estático en GitHub Pages y los datos, la sesión y la lógica viven en Supabase. Por ahora es un **entorno de prueba**: el proyecto de Supabase es de prueba y los datos son de demostración.

| | Dirección |
|---|---|
| App | https://intransit-gt.github.io/Master-App---OP-/ (lleva a `app/`) |
| Demostración sin cuenta (solo lectura) | https://intransit-gt.github.io/Master-App---OP-/demo/ |
| API (Edge Function) | `https://bocgzjupocnvjehklxhs.supabase.co/functions/v1/operaciones/api` |

## Cómo está armado

```
Navegador ──(archivos)──▶ GitHub Pages: app/ (build «supabase» de web/)
    │
    ├──(correo y contraseña)──▶ Supabase Auth: las mismas cuentas de Transportes
    │                            la sesión queda en sb-<ref>-auth-token (compartida con Transportes en el mismo sitio)
    │
    └──(token de la sesión)──▶ Edge Function «operaciones» = el mismo servidor Express de server/, empaquetado
                                   └──▶ PostgreSQL de Supabase, esquema «operaciones»
```

- **No se reescribió la lógica.** La Edge Function corre el mismo código que `server/` (motor de cálculo, cierres, compras, exportes a Excel y PDF), así que las pruebas de `server/` siguen probando lo que corre en Supabase. La alternativa, rehacer cada operación como funciones SQL y reglas de acceso (RLS) para que el navegador escriba directo en las tablas, duplicaba el trabajo y el riesgo sin ganar nada a cambio.
- **Esquema propio.** Las tablas de OP están en `operaciones`; Transportes usa `master` y `public`. La API pública de Supabase no expone `operaciones`: solo entra la función (rol `postgres`). Por eso no hacen falta políticas RLS.
- **Cuentas y roles.** Las cuentas son las de Supabase Auth. El acceso y el rol en OP están en `app_metadata.modulos.operaciones` (`administrador`, `supervisor`, `operador`, `consulta`, `comercial`); la entrada de otros módulos no se toca. Con `SSO_USUARIOS=modulo` el servidor lee el rol en `auth.users` en cada acceso (con 30 s de caché), así que un cambio de rol aplica en segundos y no hay que esperar a que se renueve el token. Un administrador de OP da acceso en **Ajustes › Usuarios**: si la cuenta ya existe, por ejemplo una de Transportes, solo se le agrega OP y su contraseña no cambia; si no existe, se crea con la contraseña inicial.

## Actualizar

```bash
# web → app/ (luego commit y push: Pages publica main)
cd web && npm run build:supabase
# servidor → Edge Function (supabase CLI con sesión: supabase login)
node scripts/supabase-funcion.mjs --desplegar
# esquema nuevo (db/migrations) → hoy no hay migrador automático: aplicar el .sql con
#   supabase db query --linked --project-ref <ref> -f <archivo>   (anteponiendo SET search_path TO operaciones, extensions;)
#   y registrar el nombre en operaciones.schema_migrations
```

`scripts/supabase-base.mjs esquema | datos | rehacer` crea el esquema desde `db/migrations` y copia los datos de la base local `omnia` (`pg_dump`). `rehacer` **borra** el esquema `operaciones` con todo lo capturado.

La configuración de la función está en `server/src/edge.ts` y no en los secretos del proyecto, porque esos los comparten todas las funciones, también las de Transportes (`api`, `sync-flota`). Supabase inyecta `SUPABASE_URL`, `SUPABASE_DB_URL`, `SUPABASE_ANON_KEY` y `SUPABASE_SERVICE_ROLE_KEY`. La web toma el proyecto de `supabase/proyecto.json`, que solo trae la clave **publishable**, pública por diseño.

## Cuentas de prueba

`op-prueba-admin@intransit.test` (administrador) y `op-prueba-operador@intransit.test` (operador). Sus contraseñas están en `<carpeta de repos>/.eos/local/op-supabase-prueba.json`, fuera de Git; no se copian al chat ni a documentos.

## Límites conocidos

- **Velocidad:** cada consulta tardó entre 0.3 y 1.6 s (medido el 2026-10-25 desde Guatemala; la función y la base están en us-east-1), y entrar hasta ver el Dashboard, unos 5 s. Es más lento que el servidor local.
- **Límites del plan gratuito de Supabase:** número de invocaciones y tiempo de CPU por petición. Hay que revisarlos si el uso crece.
- **Contraseñas:** OP no cambia contraseñas de cuentas existentes y la app no tiene «olvidé mi contraseña». Cada persona la cambia desde Transportes o desde Supabase.
- **Importar Excel** usa la misma ruta que antes. No se probó todavía en la función (límite de 15 MB por archivo).
- **Repositorio público:** la dirección de la función y la clave publishable quedan a la vista. Eso es esperado; la protección real está en el token y los roles.

## Deshacer

```bash
supabase functions delete operaciones --project-ref bocgzjupocnvjehklxhs
supabase db query --linked --project-ref bocgzjupocnvjehklxhs "DROP SCHEMA operaciones CASCADE"
# quitar app/ e index.html del repositorio; las cuentas de prueba se borran en Supabase › Authentication
```
