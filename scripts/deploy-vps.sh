#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if ! command -v pm2 >/dev/null 2>&1; then
  echo "pm2 is required on the VPS." >&2
  exit 1
fi

npm ci --include=dev --no-audit --no-fund
npm run build
pm2 startOrReload ecosystem.config.cjs --only frontdesk-ai --update-env
pm2 save

for attempt in $(seq 1 60); do
  if curl --fail --silent http://127.0.0.1:3000/login >/dev/null 2>&1; then
    exit 0
  fi

  sleep 2
done

echo "frontdesk-ai did not become healthy on http://127.0.0.1:3000/login" >&2
exit 1
