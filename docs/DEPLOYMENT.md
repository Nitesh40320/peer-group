# Deployment

The server serves the API, WebSockets and the built client from one process, so there is one thing to deploy plus a PostgreSQL database.

> Status: the production build and production-mode startup have been run locally. The Docker image and a real hosted deployment have **not** been tested, because the Docker daemon was not running during development.

## Requirements

- PostgreSQL 14 or newer
- An SMTP provider
- HTTPS termination (a reverse proxy or the hosting platform), with WebSocket upgrades allowed on `/ws`
- Persistent disk for uploads
- **One application instance** (see `ARCHITECTURE.md`)

## Option A: Docker Compose

1. Copy `.env.example` to `.env`. Set `APP_ORIGIN=https://your-domain`, the SMTP values, and add `POSTGRES_PASSWORD=<a long random value>`.
2. Build and start: `docker compose up -d --build`
3. Migrate and seed:
   ```bash
   docker compose run --rm app node dist/cli/migrate.js
   docker compose run --rm app node dist/cli/seed.js
   ```
4. Create the administrator: `docker compose run --rm -e ADMIN_PASSWORD='<password>' app node dist/cli/create-admin.js you@example.com "Your Name"`
5. Point your HTTPS reverse proxy at port 4000.

## Option B: Node host

```bash
npm ci
npm run build
NODE_ENV=production npm run migrate:prod -w backend
NODE_ENV=production npm run seed:prod -w backend
NODE_ENV=production npm start
```

Set the environment variables on the host. Set `TRUST_PROXY=1` behind one proxy. Point `STORAGE_DIR` at a persistent disk.

## Updating

Back up first, deploy the new code, run the migrations, then restart. The server drains connections on `SIGTERM`.

## Health and logs

`GET /health` returns `{"status":"ok"}`, or 503 if the database is unreachable. Logs are JSON lines on stdout and stderr. Set `ERROR_WEBHOOK_URL` to forward unhandled errors.

## Backup and recovery

Back up both at the same time, or file references will not match:

- Database: `pg_dump -Fc "$DATABASE_URL" > peerconnect.dump`
- Uploads: copy `STORAGE_DIR`

Restore with `pg_restore --clean --no-owner -d "$DATABASE_URL" peerconnect.dump` and put the upload directory back. Test a restore before relying on it.

## Pre-launch checklist

- [ ] HTTPS active and `APP_ORIGIN` correct
- [ ] Test email delivery by registering an account
- [ ] Administrator created; no demo data
- [ ] Backups scheduled and a restore tested
- [ ] Terms and privacy reviewed by someone qualified
