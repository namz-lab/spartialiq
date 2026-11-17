#!/usr/bin/env bash
# Start the finance demonstration on THIS laptop, against the LOCAL Docker database (lamis-db).
#
#   bash backend/scripts/start-finance-demo.sh          # start backend :3011 and frontend :5180
#   bash backend/scripts/start-finance-demo.sh stop     # stop both
#
# Why separate ports: backend/.env points at the LIVE Neon database and the everyday dev servers
# (3001 / 5174) use it. The demo must never write to live, so it runs its own pair of servers with
# DATABASE_URL overridden to the local container. Open http://localhost:5180 and sign in as any
# demo.<role>@vungu.test account with password demo1234.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
LOGS="${TMPDIR:-/tmp}/lamis-finance-demo"
mkdir -p "$LOGS"

if [[ "${1:-}" == "stop" ]]; then
  for f in "$LOGS"/*.pid; do [[ -f "$f" ]] && kill "$(cat "$f")" 2>/dev/null || true; rm -f "$f"; done
  echo "Finance demo stopped."; exit 0
fi

docker start lamis-db >/dev/null
PW="$(docker inspect lamis-db --format '{{range .Config.Env}}{{println .}}{{end}}' | sed -n 's/^POSTGRES_PASSWORD=//p')"
export DATABASE_URL="postgresql://postgres:${PW}@127.0.0.1:5434/vungu_master_db_v1"
for i in $(seq 1 30); do docker exec lamis-db pg_isready -U postgres >/dev/null 2>&1 && break; sleep 1; done

if ! curl -sf --max-time 5 http://127.0.0.1:3011/api/health >/dev/null; then
  (cd "$ROOT/backend" && PORT=3011 setsid nohup node server.js </dev/null >"$LOGS/backend.log" 2>&1 & echo $! >"$LOGS/backend.pid")
  for i in $(seq 1 40); do curl -sf --max-time 5 http://127.0.0.1:3011/api/health >/dev/null && break; sleep 1; done
fi
curl -sf --max-time 5 http://127.0.0.1:3011/api/health >/dev/null || { echo "Backend failed to start; see $LOGS/backend.log"; exit 1; }

if ! curl -sf --max-time 5 http://127.0.0.1:5180 >/dev/null; then
  (cd "$ROOT/frontend" && VITE_BACKEND_PROXY=http://127.0.0.1:3011 setsid nohup npx vite --config vite.config.run.ts --port 5180 --strictPort </dev/null \
     >"$LOGS/frontend.log" 2>&1 & echo $! >"$LOGS/frontend.pid")
  for i in $(seq 1 60); do curl -sf --max-time 5 http://127.0.0.1:5180 >/dev/null && break; sleep 1; done
fi
curl -sf --max-time 5 http://127.0.0.1:5180 >/dev/null || { echo "Frontend failed to start; see $LOGS/frontend.log"; exit 1; }

echo "Finance demo running (local database)."
echo "  Open:      http://localhost:5180"
echo "  Password:  demo1234 for every demo.<role>@vungu.test account"
echo "  Logs:      $LOGS"
echo "  Stop:      bash backend/scripts/start-finance-demo.sh stop"
