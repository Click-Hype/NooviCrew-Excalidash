#!/bin/sh

set -eu

compose_file="${COMPOSE_FILE:-docker-compose.prod.yml}"
env_file="${ENV_FILE:-.env}"

if [ ! -f "$compose_file" ]; then
  echo "Compose file not found: $compose_file" >&2
  exit 1
fi

if [ ! -f "$env_file" ]; then
  echo "Environment file not found: $env_file" >&2
  echo "Run ./scripts/init-production-env.sh $env_file first." >&2
  exit 1
fi

mode="$(stat -c '%a' "$env_file" 2>/dev/null || stat -f '%Lp' "$env_file")"
case "$mode" in
  600|400) ;;
  *)
    echo "$env_file must be private (mode 0600 or 0400); current mode is $mode" >&2
    exit 1
    ;;
esac

env_value() {
  key="$1"
  sed -n "s/^${key}=//p" "$env_file" | tail -n 1
}

for key in JWT_SECRET CSRF_SECRET API_KEY_HASH_PEPPER; do
  value="$(env_value "$key")"
  if [ "${#value}" -lt 32 ]; then
    echo "$key must be set to at least 32 characters in $env_file" >&2
    exit 1
  fi
done

docker compose --env-file "$env_file" -f "$compose_file" config --quiet

images="$(docker compose --env-file "$env_file" -f "$compose_file" config --images)"
if printf '%s\n' "$images" | grep -Eq '(^|:)latest$'; then
  echo "Production images must be pinned to a version tag or digest:" >&2
  printf '%s\n' "$images" >&2
  exit 1
fi

echo "Production preflight passed. Images:"
printf '  %s\n' $images
