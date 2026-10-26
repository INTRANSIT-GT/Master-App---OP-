"""Recrea una base local desde cero en Windows (solo desarrollo/pruebas). Equivale a scripts/reset-db.sh.

Uso: python scripts/reset-db-windows.py omnia|omnia_test

Necesita PostgreSQL 16 local y la clave del superusuario postgres: en PGPASSWORD o en el archivo
<carpeta de repos>/.eos/local/postgres-superusuario.txt (lo crea EOS al instalar; fuera de Git; nunca se imprime).
Crea el rol omnia (clave de desarrollo omnia_dev) si falta, borra y crea la base, y aplica las migraciones.
"""
import os
import shutil
import subprocess
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
CLAVE = RAIZ.parent / ".eos" / "local" / "postgres-superusuario.txt"
BIN = Path("C:/Program Files/PostgreSQL/16/bin")

sys.stdout.reconfigure(encoding="utf-8")
db = sys.argv[1] if len(sys.argv) > 1 else "omnia"
if db not in ("omnia", "omnia_test"):
    sys.exit("Base no válida: usar omnia u omnia_test")
psql = shutil.which("psql") or shutil.which("psql", path=str(BIN))
if not psql:
    sys.exit("No se encontró psql: instalar PostgreSQL 16 (winget install -e --id PostgreSQL.PostgreSQL.16)")
entorno = dict(os.environ)
if "PGPASSWORD" not in entorno:
    if not CLAVE.exists():
        sys.exit(f"Falta la clave del superusuario: definir PGPASSWORD o crear {CLAVE}")
    entorno["PGPASSWORD"] = CLAVE.read_text(encoding="utf-8").strip()


def sql(*ordenes, base="postgres"):
    args = [psql, "-q", "-h", "localhost", "-U", "postgres", "-d", base, "-v", "ON_ERROR_STOP=1"]
    for orden in ordenes:
        args += ["-c", orden]
    subprocess.run(args, env=entorno, check=True)


sql("DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'omnia') "
    "THEN CREATE ROLE omnia LOGIN PASSWORD 'omnia_dev'; END IF; END $$;",
    f"DROP DATABASE IF EXISTS {db}", f"CREATE DATABASE {db} OWNER omnia")
sql("CREATE EXTENSION IF NOT EXISTS pgcrypto", "CREATE EXTENSION IF NOT EXISTS btree_gist", base=db)
print(f"Base {db} creada (dueño omnia). Migrando...", flush=True)
subprocess.run([shutil.which("npx"), "tsx", "src/migrate.ts"], cwd=RAIZ / "server", check=True,
               env=dict(os.environ, DATABASE_URL=f"postgres://omnia:omnia_dev@localhost:5432/{db}"))
