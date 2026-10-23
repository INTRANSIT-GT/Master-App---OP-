#!/usr/bin/env bash
# Prueba integrada: nginx (puerto 8080) con portal + Transportes de prueba + Operaciones, y un Supabase simulado.
# Requisitos: nginx, Node 22, PostgreSQL con la base `omnia` sembrada (npm run seed) y la web compilada (cd web && npm run build).
set -euo pipefail
DBURL="${DATABASE_URL:-postgres://omnia:omnia_dev@localhost:5432/omnia}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; TMP="$(mktemp -d)"; export SUPABASE_JWT_SECRET="secreto-de-prueba-integrado-0123456789abcdef"
# Cada servicio en su propio grupo de procesos para poder cerrarlo completo al terminar.
cleanup() { for p in ${PIDS:-}; do kill -- -"$p" 2>/dev/null || true; done; sleep 0.5; for p in ${PIDS:-}; do kill -9 -- -"$p" 2>/dev/null || true; done; rm -rf "$TMP"; }; trap cleanup EXIT
chmod 755 "$TMP"   # mktemp crea 700 y los procesos de nginx no podrían leer el portal
mkdir -p "$TMP/portal" "$TMP/b" "$TMP/p" "$TMP/f" "$TMP/u" "$TMP/s"; cp "$ROOT"/deploy/portal/{index.html,modulos.json,logo.png,isologo.png} "$TMP/portal/"
cat > "$TMP/portal/config.js" <<CFG
window.PORTAL_CONFIG = { supabaseUrl: 'http://localhost:8080', supabaseKey: 'pk_test_integrado' };
CFG
sed "s#__TMP__#$TMP#g; s#__ROOT__#$ROOT#g" "$ROOT/e2e/integrado/nginx.test.conf.tpl" > "$TMP/nginx.conf"
MOCK_ISS="http://localhost:8080/auth/v1" setsid node "$ROOT/e2e/integrado/mock-supabase.mjs" & PIDS="$!"
setsid bash -c "cd '$ROOT/server' && exec env BASE_PATH=/operaciones AUTH_MODE=sso SUPABASE_URL=http://localhost:8080 SUPABASE_PUBLISHABLE_KEY=pk_test_integrado PORTAL_URL=/ WEB_DIST=../web/dist DATABASE_URL='$DBURL' npx tsx src/index.ts" & PIDS="$PIDS $!"
setsid nginx -c "$TMP/nginx.conf" & PIDS="$PIDS $!"
for i in $(seq 1 40); do curl -sf localhost:8080/operaciones/api/health >/dev/null && break; sleep 0.5; done
cd "$ROOT/e2e" && SHOTS="${SHOTS:-./shots-integrado}" node integrado/flujo.mjs
