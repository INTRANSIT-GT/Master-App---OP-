# 06 · Publicar en GitHub y desplegar

Son dos procesos independientes. **Nada de lo siguiente se ha ejecutado por ti**: no se hizo `git push` ni se tocó ningún repositorio remoto.

## A. Subir el código a GitHub

1. Crea un repositorio **privado** vacío en GitHub (sin README ni `.gitignore` iniciales), p. ej. `intransit-operaciones`.
2. En la carpeta del proyecto (descomprime `intransit-operaciones-listo-para-github.zip`):
   ```bash
   git init -b main
   git add .
   git status        # revisa: NO deben aparecer .env, node_modules ni *.dump
   git commit -m "Versión inicial: In Transit Operaciones"
   git remote add origin https://github.com/<tu-usuario>/intransit-operaciones.git
   git push -u origin main      # esta línea la ejecutas tú, cuando estés listo
   ```
3. En GitHub → Settings → Secrets: si algún día usas despliegue automático, guarda ahí las claves; nunca en el código.
4. El workflow `.github/workflows/ci.yml` ejecutará tipos, 84 + 10 pruebas y la compilación en cada push.
5. Mantén el repositorio **privado** mientras existan datos demo con nombres de productos y SAP reales de clientes.

Verificación previa hecha: no hay claves API, tokens ni credenciales reales en el código. Los únicos valores tipo clave son de desarrollo local/demo (`omnia_dev`, `Omnia2026!demo`, `dev-only-secret-change-me`); este último **impide arrancar en producción** (se exige `JWT_SECRET` de 32+ caracteres).

## B. Desplegar en un servidor

Requiere un servidor Linux (VPS o nube) con Docker, un dominio y HTTPS.

1. `cp .env.example .env` y completa **todo**: `POSTGRES_PASSWORD`, `DATABASE_URL` (misma clave), `JWT_SECRET` (`openssl rand -hex 32`), `CORS_ORIGIN` (tu dominio), `ADMIN_EMAIL`, `ADMIN_PASSWORD` (10+ caracteres con letras y números).
2. `docker compose up -d --build`. Al arrancar: aplica migraciones, carga catálogos (sin datos demo) y crea el administrador.
3. Coloca un proxy inverso con TLS (Caddy o nginx) hacia el puerto 3001. No expongas PostgreSQL a Internet.
4. Entra con el administrador, crea los usuarios reales y carga el conteo físico de inventario vigente.
5. Respaldo diario y prueba de restauración: ver `docs/03-tecnica.md`.
6. Antes de operar: validar P1–P13 y los catálogos vacíos (P12) con Operaciones y Finanzas (`docs/04`).

**Limitación:** la construcción de la imagen Docker no pudo ejecutarse en el entorno de desarrollo (sin servicio Docker). La app sí se ejecutó y probó directamente con Node 22 + PostgreSQL 16. Haz `docker compose up --build` primero en un entorno de prueba.

## B2. Desplegar junto con Transportes (servidor común)

Si Operaciones va dentro del mismo servidor que la Master App y con los mismos usuarios de Supabase, sigue `docs/08-modulo-operaciones-e-integracion.md` (usa `docker-compose.integrado.yml` y la carpeta `deploy/`). Las secciones A y B de este documento siguen valiendo para publicar el código y para el uso independiente.

## C. Desarrollo en Windows

El script `scripts/reset-db.sh` está pensado para Linux. En Windows: instala PostgreSQL 16, crea el rol `omnia` (clave `omnia_dev`) y las bases `omnia` y `omnia_test`, y ejecuta en `server/`: `set DATABASE_URL=postgres://omnia:omnia_dev@localhost:5432/omnia` y `npx tsx src/migrate.ts`. Alternativa: usar WSL2.
