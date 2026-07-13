#!/bin/sh

set -eu

base_url="${BASE_URL:-http://localhost:6767}"
base_url="${base_url%/}"

if ! command -v curl >/dev/null 2>&1; then
  echo "curl is required for the production smoke check" >&2
  exit 1
fi

frontend_status="$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' --max-time 15 "$base_url/")"
if [ "$frontend_status" != "200" ]; then
  echo "Frontend check failed with HTTP $frontend_status: $base_url/" >&2
  exit 1
fi

health_payload="$(curl --fail --silent --show-error --max-time 15 "$base_url/api/health")"
if ! printf '%s' "$health_payload" | grep -Eq '"status"[[:space:]]*:[[:space:]]*"ok"'; then
  echo "Backend health response is not healthy" >&2
  exit 1
fi

echo "Production smoke check passed: frontend HTTP 200 and backend healthy at $base_url"
