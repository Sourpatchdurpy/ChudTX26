#!/usr/bin/env bash
# Build and (re)start the app on the VM. Run from anywhere: bash /opt/game/deploy/deploy.sh
# Requires package-lock.json to be committed (npm ci refuses to run without it).
set -euo pipefail
cd "$(dirname "$0")/.."

git pull --ff-only || true
npm ci
# Production web build talks to the same origin, so NEXT_PUBLIC_SERVER_URL stays empty.
NEXT_PUBLIC_SERVER_URL= npm run build -w @game/web
pm2 startOrReload deploy/ecosystem.config.cjs
pm2 save
curl -fsS http://localhost:4000/health && echo " ← game server healthy"
