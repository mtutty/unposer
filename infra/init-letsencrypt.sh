#!/usr/bin/env bash
#
# One-time bootstrap for Let's Encrypt certs in production.
#
# nginx-proxy refuses to start if the SSL config references certificate files
# that don't exist yet, so this script:
#   1. generates a throwaway self-signed cert so nginx-proxy can start
#   2. starts nginx-proxy (serving the ACME challenge path)
#   3. removes the throwaway cert and requests a real one from Let's Encrypt
#   4. reloads nginx-proxy and starts the certbot renewal sidecar
#
# Requires DOMAIN_NAME and CERTBOT_EMAIL to be set in the env file.
#
# Usage: ./infra/init-letsencrypt.sh
#   ENV_FILE defaults to .env in the repo root; override to point at an
#   env file kept outside the repo, e.g.:
#     ENV_FILE=/root/unposer/.env ./infra/init-letsencrypt.sh

set -euo pipefail
cd "$(dirname "$0")/.."

ENV_FILE="${ENV_FILE:-.env}"

if [ ! -f "$ENV_FILE" ]; then
  echo "Error: $ENV_FILE not found (set ENV_FILE=/path/to/.env)" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1091
source "$ENV_FILE"
set +a

COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.production.yml --env-file "$ENV_FILE")

: "${DOMAIN_NAME:?Set DOMAIN_NAME in $ENV_FILE}"
: "${CERTBOT_EMAIL:?Set CERTBOT_EMAIL in $ENV_FILE}"

echo "### Creating dummy certificate for ${DOMAIN_NAME} ..."
"${COMPOSE[@]}" run --rm --entrypoint "sh -c '\
  mkdir -p /etc/letsencrypt/live/${DOMAIN_NAME} && \
  openssl req -x509 -nodes -newkey rsa:2048 -days 1 \
    -keyout /etc/letsencrypt/live/${DOMAIN_NAME}/privkey.pem \
    -out /etc/letsencrypt/live/${DOMAIN_NAME}/fullchain.pem \
    -subj /CN=localhost'" certbot

echo "### Starting nginx-proxy with dummy certificate ..."
# Explicit — deliberately excludes the base file's `nginx` service (dev-mode
# edge proxy); see the comment at the top of docker-compose.production.yml.
"${COMPOSE[@]}" up -d nginx-proxy

echo "### Deleting dummy certificate ..."
"${COMPOSE[@]}" run --rm --entrypoint "sh -c '\
  rm -rf /etc/letsencrypt/live/${DOMAIN_NAME} \
         /etc/letsencrypt/archive/${DOMAIN_NAME} \
         /etc/letsencrypt/renewal/${DOMAIN_NAME}.conf'" certbot

echo "### Requesting real certificate from Let's Encrypt ..."
"${COMPOSE[@]}" run --rm --entrypoint "sh -c '\
  certbot certonly --webroot -w /var/www/certbot \
    --email ${CERTBOT_EMAIL} -d ${DOMAIN_NAME} \
    --rsa-key-size 4096 --agree-tos --non-interactive'" certbot

echo "### Reloading nginx-proxy ..."
"${COMPOSE[@]}" exec nginx-proxy nginx -s reload

echo "### Starting the rest of the stack (api, postgres, certbot renewal sidecar) ..."
"${COMPOSE[@]}" up -d api postgres nginx-proxy certbot

echo "### Done. ${DOMAIN_NAME} is now served over HTTPS."
