#!/usr/bin/env bash
#
# Shared setup for run-crm / update-crm. Not meant to be run directly —
# sourced by those scripts, which must set SCRIPT_DIR before sourcing this
# file:
#
#   SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
#   source "$SCRIPT_DIR/crm-common.sh"
#
# All three files are meant to live together outside the git checkout,
# alongside the production .env file (e.g. /opt/gforge-crm/{run-crm,
# update-crm,crm-common.sh,.env}), while REPO_DIR below points at the git
# checkout that contains docker-compose.yml / docker-compose.prod.yml.

set -euo pipefail

# --- Configuration -----------------------------------------------------------
# Path to the gforge-crm git checkout (contains docker-compose*.yml).
REPO_DIR="${REPO_DIR:-/opt/gforge-crm/app}"
# -----------------------------------------------------------------------------

ENV_FILE="$SCRIPT_DIR/.env"

if [ ! -f "$ENV_FILE" ]; then
  echo "Error: $ENV_FILE not found" >&2
  exit 1
fi

if [ ! -f "$REPO_DIR/docker-compose.yml" ]; then
  echo "Error: $REPO_DIR/docker-compose.yml not found (check REPO_DIR)" >&2
  exit 1
fi

COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file "$ENV_FILE")

cd "$REPO_DIR"
