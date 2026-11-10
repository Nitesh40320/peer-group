# PeerConnect

**Learn Together. Build Together. Grow Together.**

Author: Nitesh Tanawade

A collaborative academic platform. Students find compatible learning partners, run study groups and work on projects together. Verified teachers mentor students and set assignments. Administrators manage the platform.

## Main features

- Student and teacher accounts with email verification, password reset and server-enforced roles
- Teacher verification reviewed by administrators
- Student discovery and explainable, rule-based partner matching
- Study groups with a shared workspace: discussion, tasks, projects, resources, schedule, members
- Project boards, milestones and project discussions
- One-to-one and group messaging over WebSockets, with file sharing
- Study sessions with reminders, attendance and calendar files
- Secure learning resources
- Mentorship, assignments, submissions and feedback
- Notifications with per-type preferences
- Administration: users, verification, moderation, support, audit log, settings
- Optional AI assistant

Feature status, including what is partial, is in [docs/FEATURE_GUIDE.md](docs/FEATURE_GUIDE.md).

## Project layout

The code is split into three parts. Each folder is its own npm workspace with a short README.

```
PeerConnect/
├── frontend/   What runs in the browser: React pages and components
├── backend/    The API server: routes, accounts, permissions, database, emails
├── model/      The "smart" parts: the AI study assistant and study-partner matching
├── e2e/        Browser tests that click through the whole app
├── docs/       Longer documentation
└── scripts/    Helpers for local development (start database, run dev servers)
```

How they connect: the **frontend** only talks to the **backend** over HTTP (`/api/...`).
The **backend** imports the **model** like a library (`import { activeMatcher } from '@peerconnect/model'`).
The model never touches the database or HTTP, so it can be read and tested on its own.

## Technology stack

Node.js 24, Express 5, TypeScript, zod, PostgreSQL, React 19, Vite, TanStack Query, Vitest, Playwright. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Prerequisites

- Node.js 22 or newer and npm
- PostgreSQL 14 or newer, installed locally or reachable by URL
- Chrome, for the end-to-end tests only

## Installation and first run

```bash
npm install
npm run setup:env       # creates .env from .env.example
npm run db:local        # starts a private PostgreSQL and writes its URLs into .env
npm run db:migrate
npm run db:seed         # subject, skill and interest suggestions
npm run dev             # http://localhost:5173
```

`db:local` uses installed PostgreSQL binaries with its own data directory and port (54329), so an existing PostgreSQL is not touched. To use another database, set `DATABASE_URL` and `TEST_DATABASE_URL` in `.env` and skip it.

Create an administrator. There is deliberately no public way to do this. PowerShell:

```powershell
$env:ADMIN_PASSWORD = "choose-a-strong-password-1"
npm run admin:create -- you@example.com "Your Name"
Remove-Item Env:ADMIN_PASSWORD
```

macOS, Linux or Git Bash: `ADMIN_PASSWORD='choose-a-strong-password-1' npm run admin:create -- you@example.com "Your Name"`

Without SMTP configured, verification and reset emails print to the backend console in development. Optional sample accounts: set `DEMO_PASSWORD`, then run `npm run db:seed:demo`.

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Backend on :4000 and frontend on :5173 with reload |
| `npm test` | Unit and integration tests |
| `npm run test:e2e` | Browser tests. Run `npm run build` first |
| `npm run lint` / `npm run typecheck` | Static checks |
| `npm run build` | Production build of model, frontend and backend |
| `npm start` | Run the production build |
| `npm run openapi` | Regenerate `docs/openapi.json` |
| `npm run db:local:stop` | Stop the private PostgreSQL |

## Environment, testing and deployment

- [docs/ENVIRONMENT_SETUP.md](docs/ENVIRONMENT_SETUP.md)
- [docs/TESTING.md](docs/TESTING.md)
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)
- [docs/API_DOCUMENTATION.md](docs/API_DOCUMENTATION.md), [docs/DATABASE_SCHEMA.md](docs/DATABASE_SCHEMA.md), [docs/AUTHENTICATION.md](docs/AUTHENTICATION.md), [docs/PROJECT_AUDIT.md](docs/PROJECT_AUDIT.md)

