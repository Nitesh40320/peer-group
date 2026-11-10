# backend

The API server (Node.js + Express + PostgreSQL). It runs on http://localhost:4000 during development.

| Path | What it does |
|---|---|
| `src/index.ts` | Starts the server |
| `src/app.ts` | Wires up middleware, routes, and serves the built frontend |
| `src/config.ts` | Reads and checks settings from `.env` |
| `src/db.ts` | Database queries, transactions and migrations |
| `src/lib/` | Shared helpers: route declaration, errors, logging, email, files, notifications |
| `src/modules/` | One file per feature area: auth, people, groups, collaboration, guidance, admin, ai, rules |
| `src/cli/` | Command-line tasks: migrate, seed, create-admin, openapi |
| `migrations/` | SQL files that create the database tables |
| `test/` | Unit and integration tests (`npm test`) |

Matching and the AI assistant's prompts live in [`../model`](../model/README.md); this folder decides who may use them.
