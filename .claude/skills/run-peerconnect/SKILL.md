---
name: run-peerconnect
description: Launch PeerConnect locally (Postgres + API + Vite client) and drive it in a real browser — sign up, verify, sign in, screenshot dashboard and groups. Use when asked to run, start, smoke-test or screenshot the app.
---

# Run PeerConnect

Windows dev machine. Stack: private PostgreSQL 18 on 127.0.0.1:54329, Express API on :4000,
Vite client on :5173 (proxies `/api` and `/ws` to :4000).

## 1. Database

Do **not** use `npm run db:local` from a tool call — the tool shell's exit sends Ctrl+C
(0xC000013A) and kills Postgres, even when backgrounded. Start the server binary directly,
with `run_in_background: true`:

```bash
"C:/Program Files/PostgreSQL/18/bin/postgres.exe" -D "$LOCALAPPDATA/PeerConnect/pgdata" -p 54329 -c listen_addresses=127.0.0.1
```

Wait for the port, then migrate:

```bash
for i in $(seq 1 60); do node -e "require('net').connect(54329,'127.0.0.1').on('connect',()=>process.exit(0)).on('error',()=>process.exit(1))" && break; sleep 1; done
npm run db:migrate
```

If the log (`%LOCALAPPDATA%\PeerConnect\postgres.log`) shows "database system is starting up"
for a while, it is doing crash recovery after an unclean stop — keep waiting.

## 2. API + client

`npm run dev` with `run_in_background: true`, then poll:

```bash
for i in $(seq 1 60); do curl -sf http://localhost:5173 >/dev/null && curl -sf http://localhost:4000/health >/dev/null && break; sleep 1; done
curl -s http://localhost:4000/health   # {"status":"ok"}
```

## 3. Drive it

Playwright's bundled browsers are **not** downloaded; `drive.cjs` uses the installed Chrome
(`channel: 'chrome'`; set `CH=msedge` for Edge). No `npx playwright install` needed.

```bash
OUT="<scratchpad dir>" node .claude/skills/run-peerconnect/drive.cjs
```

It loads `/`, registers a fresh student through the API, verifies it via the dev mail outbox
(`GET /api/dev/outbox?email=...` — SMTP is unset in dev), signs in through the login form,
and screenshots `1-landing.png`, `2-dashboard.png`, `3-groups.png` into `$OUT`. Read the
screenshots. Expected: titles "PeerConnect: Learn Together…", "Welcome, <name> | PeerConnect",
"Study groups | PeerConnect".

Known noise: a few `401 (Unauthorized)` console errors from the session probe before login.
Each run leaves a `run.<timestamp>@example.test` account in the dev database.

## 4. Stop

```bash
"C:/Program Files/PostgreSQL/18/bin/pg_ctl.exe" -D "$LOCALAPPDATA/PeerConnect/pgdata" stop -m fast
```

Stop the `npm run dev` background task (TaskStop), or kill the listeners on :4000 and :5173.
