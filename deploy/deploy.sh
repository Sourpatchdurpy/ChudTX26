#!/usr/bin/env bash
# Build and (re)start the app on the VM. Run from anywhere: bash /opt/game/deploy/deploy.sh
# Requires package-lock.json to be committed (npm ci refuses to run without it).
set -euo pipefail
cd "$(dirname "$0")/.."

git pull --ff-only || true
# tsx (which runs the server) is a devDependency, so install dev deps even if NODE_ENV=production.
npm ci --include=dev
if [ -f index.html ]; then
  # Vite frontend at the repo root: builds to dist/, which Caddy serves as static files.
  # A failed build (or typecheck) stops here, so the previous version keeps running.
  npm run build
elif [ -f apps/web/package.json ]; then
  # Production web build talks to the same origin, so NEXT_PUBLIC_SERVER_URL stays empty.
  NEXT_PUBLIC_SERVER_URL= npm run build -w @game/web
else
  echo "no frontend found: skipping the web build (server only)"
fi
pm2 startOrReload deploy/ecosystem.config.cjs
pm2 save
# The server takes a moment to boot after a reload.
for i in $(seq 1 15); do
  if curl -fsS http://localhost:4000/health; then
    echo " ← game server healthy"
    exit 0
  fi
  sleep 1
done
echo "game server did not answer /health; check: pm2 logs game-server --lines 50" >&2
exit 1
