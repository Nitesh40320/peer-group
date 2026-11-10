# Architecture

One repository with three npm workspaces (`frontend`, `backend`, `model`), deployed as one server process.

```
browser ── HTTPS ──▶ Express (backend/) ──▶ PostgreSQL
   │                   ├─ /api/*  JSON API
   └── WebSocket /ws ──┤─ /ws     real-time events
                       ├─ /health
                       └─ everything else: built React app (frontend/dist)
Uploaded files: local disk, behind the FileStorage interface
```

## Why this stack

The original project was static HTML with no server. Accounts, private data, file permissions and messaging need a backend, so one was added rather than migrated to. Node keeps one language across the codebase. PostgreSQL suits the heavily relational domain. React replaced static pages because about 30 screens share state and components. Reasoning is in `PROJECT_AUDIT.md`.

## Backend (`backend/src`)

| Path | Responsibility |
|---|---|
| `config.ts` | Validates the environment at startup and refuses unsafe production settings |
| `db.ts` | Parameterized queries, transactions, migration runner |
| `lib/route.ts` | **Every endpoint is declared here**: session lookup, CSRF, role check, validation, OpenAPI entry |
| `lib/services.ts` | Email, file storage and type detection, audit log, WebSocket delivery, notifications |
| `lib/core.ts` | Errors, logging, error reporting |
| `modules/auth.ts` | Registration, sessions, verification, password reset |
| `modules/people.ts` | Profiles, discovery, connections, blocks, file downloads |
| `modules/rules.ts` | Business rules (pure, unit tested) |
| `modules/groups.ts` | Groups, membership, workspace |
| `modules/collaboration.ts` | Projects, messaging, sessions, resources |
| `modules/guidance.ts` | Verification, mentorship, assignments, dashboards, notifications API |
| `modules/admin.ts` | Administration, moderation, support |
| `modules/ai.ts` | AI endpoints: access, daily limit, user-facing errors (calls the model) |
| `jobs.ts` | Reminders and cleanup, each minute or hour |
| `cli/` | migrate, seed, create-admin, openapi |

Key decisions:

- Authorization lives in `route()` and module functions such as `requireMember`, never in the client.
- Transactions use `AsyncLocalStorage`, so a helper called inside `tx()` joins that transaction automatically.
- List screens use single queries with subselects, avoiding N+1 queries.

## Model (`model/src`)

Pure logic with no database, HTTP or user accounts. The backend imports it as `@peerconnect/model`.

| Path | Responsibility |
|---|---|
| `matching.ts` | Study-partner recommendation engine: weighted rules with plain-English reasons |
| `assistant.ts` | AI assistant: prompts, the Claude API call, and a small set of failure reasons |
| `index.ts` | What the package exports |

During development the backend loads the model's TypeScript source directly (the `source` export condition), so edits show up without a build. `npm run build` compiles it to `model/dist` for production.

## Frontend (`frontend/src`)

| Path | Responsibility |
|---|---|
| `lib/api.ts` | The only code that talks to the backend |
| `lib/auth.tsx` | Session state and real-time connection |
| `components/ui.tsx` | Design system components, including `Async` for loading, error and empty states |
| `components/shared.tsx` | Chat pane, task board and resources, reused by groups and projects |
| `components/Shell.tsx` | Role-based sidebar, top bar and notifications |
| `pages/*` | Lazy-loaded screens by area |

The stylesheet (`styles.css`) begins with the design tokens from the brief.

## Real-time

The server pushes `message` and `notification` events to a user's open sockets. The socket checks the session cookie and the `Origin` header. The client refetches affected data on each event. If the socket drops, it reconnects with backoff and polls every 20 seconds until it returns.

**Limitation:** connections are tracked in process memory, as are rate-limit counters. Running more than one server instance requires a shared pub/sub (for example Redis) and a shared rate-limit store. Run a single instance until then.

## Extension points

| Point | How |
|---|---|
| Machine-learned matching | Implement `Matcher` in `model/src/matching.ts` and change `activeMatcher` |
| Cloud file storage | Implement `FileStorage` in `backend/src/lib/services.ts` |
| Error monitoring | Set `ERROR_WEBHOOK_URL`, or extend `reportError` |
