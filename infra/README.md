# Production deployment runbook

Everything here is for the real, internet-facing deployment at
**unposer.com**. Local development (`docker-compose.yml` +
`docker-compose.override.yml`, no SSL, no certbot) is unaffected by any of
this — see the root `CLAUDE.md` for that flow, including testing under
`dev.unposer.com` via a `/etc/hosts` entry (still plain HTTP, no separate
compose file).

## Layout

- **In the repo** (this checkout, cloned onto the server): `docker-compose.yml`,
  `docker-compose.production.yml`, `infra/nginx/prod.conf.template`,
  `infra/init-letsencrypt.sh`.
- **Outside the repo**, on the server, at `/root/unposer/`: the production
  `.env` (real secrets — never committed) plus copies of `run-unposer`,
  `update-unposer`, `unposer-common.sh` from this directory. Keeping these
  outside the checkout means `git reset --hard` during an update (see
  below) never touches them.

```
/root/unposer/
├── app/                  # git checkout (this repo, on the `deploy` branch)
├── .env                  # production secrets, from .env.template
├── run-unposer            # copied from infra/run-unposer
├── update-unposer          # copied from infra/update-unposer
└── unposer-common.sh        # copied from infra/unposer-common.sh
```

## One-time server setup

```bash
mkdir -p /root/unposer
git clone git@github.com:mtutty/unposer.git /root/unposer/app
cd /root/unposer/app
git checkout deploy   # created automatically the first time CI promotes main

cp infra/run-unposer infra/update-unposer infra/unposer-common.sh /root/unposer/
chmod +x /root/unposer/run-unposer /root/unposer/update-unposer

cp .env.template /root/unposer/.env
# Edit /root/unposer/.env:
#   NODE_ENV=production
#   DEV_AUTH_ENABLED=false
#   DOMAIN_NAME=unposer.com
#   CERTBOT_EMAIL=<a real address you monitor>
#   FRONTEND_URL=https://unposer.com
#   POSTGRES_PASSWORD / SESSION_SECRET → real generated secrets
#   LLM_API_KEY → real key
```

If the `deploy` branch doesn't exist yet (first deploy ever, before CI has
promoted anything), push it manually once: `git push origin main:deploy`.

## First-run SSL

nginx refuses to start if it can't find the certificate it's configured to
use, so don't `run-unposer` on a brand new host — bootstrap the cert first:

```bash
cd /root/unposer/app
ENV_FILE=/root/unposer/.env ./infra/init-letsencrypt.sh
```

This issues the real Let's Encrypt certificate for `DOMAIN_NAME` (see the
script's own comments for the dummy-cert-then-swap mechanics) and leaves the
full stack — including the certbot renewal sidecar — running. After this,
use `run-unposer` / `update-unposer` as normal; nginx already has a valid
cert on disk (in the `certbot-conf` volume) so it starts cleanly.

## Database

Migrations run automatically on every `api` container start (see
`backend/docker-entrypoint.sh`) — nothing to run by hand on first deploy or
any deploy after. Data lives in the named `postgres_data` volume, which
persists across `up`/`down`/rebuilds (only `docker compose down -v` would
destroy it — never run that in production).

To back up:

```bash
cd /root/unposer/app
docker compose -f docker-compose.yml -f docker-compose.production.yml \
  --env-file /root/unposer/.env exec postgres \
  pg_dump -U appuser appdb | gzip > /root/unposer/backups/appdb-$(date +%F).sql.gz
```

## Ongoing operation

- **`run-unposer`** — starts the stack from whatever images are already
  built (e.g. after a host reboot). Consider a `@reboot` crontab entry.
- **`update-unposer`** — fetches `origin/deploy`; if it has moved, resets the
  checkout to it, rebuilds, and restarts. A no-op otherwise, so it's safe to
  run on a timer:

  ```cron
  */10 * * * * /root/unposer/update-unposer >> /root/unposer/update.log 2>&1
  ```

## How code reaches the server

1. Push to `main` → `.github/workflows/ci.yml` builds and typechecks both
   `backend` and `frontend`.
2. Only if both pass, the `promote` job fast-forwards `deploy` to that
   commit. A push that fails CI never touches `deploy`.
3. The server's cron job (`update-unposer`) picks up the new `deploy` commit
   within its polling interval, rebuilds, and restarts.

Nothing pushes to the server directly — it always pulls, on its own
schedule, from a branch that only ever holds commits CI has already passed.
