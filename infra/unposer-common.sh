#!/usr/bin/env bash
#
# Shared setup for run-unposer / update-unposer. Not meant to be run
# directly — sourced by those scripts, which must set SCRIPT_DIR before
# sourcing this file:
#
#   SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
#   source "$SCRIPT_DIR/unposer-common.sh"
#
# All three files are meant to live together outside the git checkout,
# alongside the production .env file (e.g. /root/unposer/{run-unposer,
# update-unposer,unposer-common.sh,.env}), while REPO_DIR below points at
# the git checkout that contains docker-compose.yml / docker-compose.production.yml.

set -euo pipefail

# --- Configuration -----------------------------------------------------------
# Path to the unposer git checkout (contains docker-compose*.yml).
REPO_DIR="${REPO_DIR:-/root/unposer/app}"
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

COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.production.yml --env-file "$ENV_FILE")

# Explicit — deliberately excludes the base file's `nginx` service (dev-mode
# edge proxy; `nginx-proxy` replaces its job in production). See the
# comment at the top of docker-compose.production.yml for why this can't
# just be an override instead. Always pass this to `up`, never a blanket
# `up -d` with no service names.
PROD_SERVICES=(api postgres frontend nginx-proxy certbot)

cd "$REPO_DIR"
