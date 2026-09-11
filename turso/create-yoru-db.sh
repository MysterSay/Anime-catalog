#!/usr/bin/env bash
set -euo pipefail
DB_NAME="${1:-yoru-anime}"

echo "Creating Turso database: $DB_NAME"
turso db create "$DB_NAME"
echo
echo "Database URL:"
turso db show "$DB_NAME" --url
echo
echo "Database token (copy it now and keep it secret):"
turso db tokens create "$DB_NAME" --expiration never
