# Deploying MengAI on a personal VPS

One container runs the API and serves the web app. Postgres and Redis run
next to it on an internal Docker network with no published ports. A TLS
reverse proxy on the host (Caddy in this guide) is the only thing facing the
internet.

```
internet --443--> Caddy (host, TLS) --127.0.0.1:3001--> app --internal--> postgres, redis
```

## 1. Server

- Any small Linux VPS (1 vCPU, 1 GB RAM is enough to start) with a DNS name
  pointing at it, for example `mengai.example.com`.
- Docker Engine with the compose plugin.
- Firewall: allow 22, 80 and 443 only.

```sh
sudo ufw default deny incoming
sudo ufw allow 22/tcp && sudo ufw allow 80/tcp && sudo ufw allow 443/tcp
sudo ufw enable
```

## 2. Configure

```sh
git clone <your fork of this repo> mengai && cd mengai
cp .env.example .env
chmod 600 .env
```

Fill in `.env` (see `.env.example` for every key):

| Key | How to set it |
|---|---|
| `VAULT_KEK` | `openssl rand -base64 32`. Encrypts every stored API key. Back it up somewhere safe: losing it means re-entering all provider keys. Never change it in place. |
| `SETUP_CODE` | `openssl rand -base64 24`. Needed once to create the owner account. Remove it after setup. |
| `POSTGRES_PASSWORD` | `openssl rand -hex 24` |
| `REDIS_PASSWORD` | `openssl rand -hex 24` |
| `ALLOWED_ORIGINS` | Only if another origin must call the API. Same origin (`https://mengai.example.com`) is always allowed. Exact origins, comma separated, never `*`. |
| `S3_*` | Optional. Any S3-compatible storage for generated assets. Leave empty to keep blobs in the `app-data` volume. |

`DATABASE_URL`, `REDIS_URL` and `TRUST_PROXY=1` are set by
`infra/docker-compose.yml`, you do not need them in `.env`.

## 3. Start

```sh
docker compose -f infra/docker-compose.yml --env-file .env up -d --build
docker compose -f infra/docker-compose.yml --env-file .env ps
```

Migrations run automatically on boot. The app answers on `127.0.0.1:3001`
only, so nothing is exposed until the proxy is in place.

## 4. TLS reverse proxy (Caddy)

Install Caddy on the host and use this `/etc/caddy/Caddyfile`:

```
mengai.example.com {
	encode zstd gzip
	reverse_proxy 127.0.0.1:3001 {
		# server-sent events: flush every write immediately
		flush_interval -1
	}
}
```

```sh
sudo systemctl reload caddy
```

Caddy gets and renews the certificate on its own. It puts the client address
at the right-hand end of `X-Forwarded-For`; the app trusts exactly one proxy
hop (`TRUST_PROXY=1`) and reads only that right-most entry, so a client cannot
spoof its address for rate limits. If you put another proxy or CDN in front, raise
`TRUST_PROXY` to the number of proxies you run.

Any other proxy works the same way: terminate TLS, forward to
`127.0.0.1:3001`, disable response buffering for `/api/events`.

## 5. First login

1. Open `https://mengai.example.com`.
2. The app asks for the setup code, an email and a password (12 characters or
   more). This works only while no owner account exists.
3. Remove `SETUP_CODE` from `.env` and restart:
   `docker compose -f infra/docker-compose.yml --env-file .env up -d`.

Login is limited to 5 attempts per minute per client address. Sessions are
HttpOnly, Secure, SameSite=Strict cookies that slide for 30 days.

## 6. Backups

```sh
# database
docker compose -f infra/docker-compose.yml --env-file .env exec -T postgres \
  pg_dump -U mengai -d mengai --format=custom > mengai-$(date +%F).dump
# app data (blobs, workspaces) when S3 is not used
docker run --rm -v mengai_app-data:/data -v "$PWD":/out alpine \
  tar czf /out/mengai-data-$(date +%F).tgz -C /data .
```

Keep `.env` (above all `VAULT_KEK`) in the same backup plan, stored apart from
the dumps. Redis holds only rate limits and caches and is not backed up.

## 7. Updates

```sh
git pull
docker compose -f infra/docker-compose.yml --env-file .env up -d --build
docker image prune -f
```

## 8. Checks

- `curl -s https://mengai.example.com/api/health` returns `{"ok":true,...}`.
- `docker compose -f infra/docker-compose.yml --env-file .env logs -f app`
  shows JSON log lines; secrets are redacted before they are written.
- `ss -tlnp` on the host shows 3001 bound to 127.0.0.1 only, and no 5432 or
  6379 at all.
