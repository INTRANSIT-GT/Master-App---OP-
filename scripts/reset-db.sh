#!/usr/bin/env bash
# Recrea una base local desde cero (solo desarrollo/pruebas). Uso: scripts/reset-db.sh omnia|omnia_test
set -euo pipefail
DB=${1:-omnia}
su postgres -c "psql -q -c 'DROP DATABASE IF EXISTS $DB' -c 'CREATE DATABASE $DB OWNER omnia'"
cd "$(dirname "$0")/../server"
DATABASE_URL=postgres://omnia:omnia_dev@localhost:5432/$DB npx tsx src/migrate.ts
