# Environment setup

Configuration comes from environment variables, loaded from `.env` in development. `.env` is git-ignored. The server validates configuration at startup and exits with a clear list of problems.

| Variable | Required | Purpose |
|---|---|---|
| `NODE_ENV` | No | `development`, `test` or `production` |
| `PORT` | No | Default 4000 |
| `APP_ORIGIN` | Production | Public URL. Used in emails and the WebSocket check. Must be `https` in production |
| `CORS_ORIGINS` | No | Extra allowed browser origins. Usually empty |
| `TRUST_PROXY` | Behind a proxy | Number of proxies in front of the app, needed for correct client IPs |
| `LOG_LEVEL` | No | `debug`, `info`, `warn`, `error` |
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `TEST_DATABASE_URL` | For tests | A separate database. **Tests erase it** |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD` | Production | Mail server. Production refuses to start without `SMTP_HOST` |
| `EMAIL_FROM` | Production | Sender address |
| `STORAGE_DIR` | No | Upload directory. Must not be publicly served |
| `MAX_UPLOAD_MB` | No | Default 10 |
| `ANTHROPIC_API_KEY` | No | Enables the AI assistant |
| `AI_MODEL` | No | Default `claude-opus-5-5` |
| `AI_DAILY_LIMIT` | No | Requests per user per day. Default 20 |
| `ERROR_WEBHOOK_URL` | No | Receives unhandled errors as JSON |

Only for the provided scripts: `ADMIN_PASSWORD` (`admin:create`), `DEMO_PASSWORD` (`db:seed:demo`), `PG_BIN` (`db:local`, if PostgreSQL is not found automatically).

## Local database

`npm run db:local` creates a private cluster on first use in `%LOCALAPPDATA%\PeerConnect\pgdata` (Windows) or `~/.local/share/PeerConnect/pgdata`, listening only on 127.0.0.1:54329. It generates a random password and writes the two database URLs to `.env`. Run it in its own terminal and leave that terminal open: pressing Ctrl+C in a console that started the database can stop it. If you delete `.env`, also delete the data directory so a new password can be generated.

## Providers without credentials

| Provider | Behaviour without credentials |
|---|---|
| Email | Development prints messages to the server console. Production will not start |
| AI | The assistant page says it is unavailable. Everything else works |
| Error monitoring | Errors go to the log only |
| Cloud storage | Files are stored on local disk |
