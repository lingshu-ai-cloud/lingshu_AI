#!/bin/sh
set -eu

if [ -n "${PB_ADMIN_EMAIL:-}" ] && [ -n "${PB_ADMIN_PASSWORD:-}" ]; then
  /pb/pocketbase superuser upsert "$PB_ADMIN_EMAIL" "$PB_ADMIN_PASSWORD" --dir=/pb/pb_data >/dev/null
fi

PB_RUNTIME_MIGRATIONS_DIR="${PB_MIGRATIONS_DIR:-/pb/pb_migrations}"
mkdir -p "$PB_RUNTIME_MIGRATIONS_DIR"

exec /pb/pocketbase serve \
  --http=0.0.0.0:8090 \
  --dir=/pb/pb_data \
  --migrationsDir="$PB_RUNTIME_MIGRATIONS_DIR" \
  --publicDir=/pb/pb_public
