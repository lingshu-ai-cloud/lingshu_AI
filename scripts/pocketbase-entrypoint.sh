#!/bin/sh
set -eu

PB_ADMIN_EMAIL="${PB_ADMIN_EMAIL:-}"
PB_ADMIN_PASSWORD="${PB_ADMIN_PASSWORD:-}"
[ -n "$PB_ADMIN_EMAIL" ] && [ -n "$PB_ADMIN_PASSWORD" ] || { echo "PB_ADMIN_EMAIL and PB_ADMIN_PASSWORD are required." >&2; exit 1; }
[ "${#PB_ADMIN_PASSWORD}" -ge 16 ] || { echo "PB_ADMIN_PASSWORD must contain at least 16 characters." >&2; exit 1; }
case "$PB_ADMIN_EMAIL:$PB_ADMIN_PASSWORD" in
  *example.com*|*change-me*|*placeholder*|*generate-with*) echo "PocketBase administrator credentials still contain placeholders." >&2; exit 1 ;;
esac
PB_RUNTIME_MIGRATIONS_DIR="${PB_MIGRATIONS_DIR:-/pb/pb_migrations}"
[ -d "$PB_RUNTIME_MIGRATIONS_DIR" ] || { echo "PocketBase migrations directory is missing." >&2; exit 1; }
/pb/pocketbase superuser upsert "$PB_ADMIN_EMAIL" "$PB_ADMIN_PASSWORD" \
  --dir=/pb/pb_data \
  --migrationsDir="$PB_RUNTIME_MIGRATIONS_DIR" \
  --hooksDir=/pb/pb_hooks \
  --automigrate=false \
  --hooksWatch=false \
  --dev=false >/dev/null

exec /pb/pocketbase serve \
  --http=0.0.0.0:8090 \
  --dir=/pb/pb_data \
  --migrationsDir="$PB_RUNTIME_MIGRATIONS_DIR" \
  --hooksDir=/pb/pb_hooks \
  --publicDir=/pb/pb_public \
  --automigrate=false \
  --hooksWatch=false \
  --dev=false
