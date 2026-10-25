#!/usr/bin/env bash
# Build and (re)start the app on the VM. Run from anywhere: bash /opt/game/deploy/deploy.sh
# Requires package-lock.json to be committed (npm ci refuses to run without it).
set -euo pipefail
SELF="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
cd "$(dirname "$SELF")/.."

# Pull, then restart this script so the rest always runs the version just pulled
# (otherwise bash keeps executing the old copy that was already loaded).
if [ "${DEPLOY_PULLED:-}" != 1 ]; then
  git pull --ff-only || true
  DEPLOY_PULLED=1 exec bash "$SELF" "$@"
fi
# tsx (which runs the server) is a devDependency, so install dev deps even if NODE_ENV=production.
npm ci --include=dev
# Build Part 4's frontend into apps/web/dist, served directly by Caddy.
# Socket.IO uses the website's origin; Caddy proxies /socket.io to the server.
# A failed build or typecheck stops deployment before the server reload.
npm run build:web
pm2 startOrReload deploy/ecosystem.config.cjs
pm2 save
# The server takes a moment to boot after a reload.
for i in $(seq 1 15); do
  if curl -fs http://localhost:4000/health; then
    echo " ← game server healthy"
    exit 0
  fi
  sleep 1
done
echo "game server did not answer /health; check: pm2 logs game-server --lines 50" >&2
exit 1
