# PeerConnect repository audit

Audited 2026-11-08, before the product transformation began. Everything below describes the
repository as found. `docs/ARCHITECTURE.md` describes what replaced it.

## 1. Technology stack as found

| Area | Finding |
|---|---|
| Frontend | 11 hand-written `.html` pages, one shared `assets/styles.css`, one `assets/site.js` (vanilla JS) |
| Backend | None |
| Database | None |
| Package manager | None: no `package.json`, `requirements.txt` or lockfile |
| Tests | None |
| Deployment | None: no Dockerfile, CI or hosting configuration |
| Version control | Folder is not a git repository |
| Environment config | None. `.vscode/` is empty |

## 2. Architecture as found

A folder of static files opened directly in a browser. No build step, routing, server or state.
The current look of the pages comes from an earlier redesign in this project.

## 3. Features and their real status

| Feature | Status |
|---|---|
| Marketing copy | Present |
| Login (student/teacher tabs) | Interface only. `action="#"`; no account exists anywhere |
| Sign up | Interface only. Student form only; no teacher registration |
| Forgot password | Interface only. Sends nothing |
| Contact form | Interface only. Message is discarded |
| Study groups, matching, mentorship, chat, resources, badges, analytics, premium | Described in copy only. No implementation |
| Mobile navigation, tabs, scroll reveal | Working (`assets/site.js`) |

## 4. Pages

| File | Purpose | Inbound links |
|---|---|---|
| `index.html` | Home | All pages |
| `features.html` | Feature list | Nav |
| `feature-matching.html` | Matching detail | `features.html` |
| `advantages.html` | Benefits | Nav |
| `testimonials.html` | Quotes | Nav |
| `contact.html` | Contact form | Nav |
| `login.html` / `signup.html` / `forgot-password.html` | Auth screens | Nav, each other |
| `start-connecting.html` | Text-only end page | `feature-matching.html`, |
| `code.html` | Early one-page draft of the site | None (orphan) |

## 5. Database structure

None exists. Nothing needs migrating and no user data can be lost.

## 6. Backend architecture

None exists.

## 7. Authentication and authorization

None. The Student/Teacher tabs only change which form is visible.

## 8. Security findings

No server means no server-side vulnerabilities, but the forms mislead users:

- Password fields on `login.html` POST to `#`. Over plain hosting this would send credentials to
  whatever serves the page.
- `signup.html` and `forgot-password.html` use the default GET method. Their inputs have no `name`,
  which is the only reason passwords are not placed in the URL.
- The site implies accounts and "secure" reset links that do not exist.

## 9. Performance

Light pages. The only external dependency is Google Fonts. No issues of note at this size.

## 10. Broken or incomplete functionality

- Every form is non-functional (section 3).
- `features.html` advertises features that do not exist, including a Premium tier with no billing.
- `start-connecting.html` promises real-time discussions and contains none.

## 11. Redundant files

| File | Assessment |
|---|---|
| `code.html` | Orphan draft; content duplicated elsewhere |
| `advantages.html`, `features.html` | Useful copy; should merge into the landing page |
| `testimonials.html` | Quotes cannot be verified as genuine. The brief forbids presenting demonstration data as real, so they must not ship unless confirmed |
| `feature-matching.html`, `start-connecting.html` | Superseded by real product workflows |

## 12. Recommended architecture

The requested product needs persistent data, server-side authorization, file handling and real-time
messaging, which static files cannot provide. A backend is an addition rather than a migration.

- **Server:** Node.js 24, Express 5, TypeScript, zod for validation.
- **Database:** PostgreSQL. Relational integrity suits this domain, and it is what production would use.
- **Client:** React 19, Vite and TypeScript, because about 30 role-specific screens share state and components.
- **Shape:** one npm workspace repository, one deployable server that also serves the built client.

The toolchain on the audit machine shaped this: Node 24, npm and PostgreSQL 18 binaries are installed;
the Docker daemon is not running. Development and tests therefore use a private PostgreSQL instance
started from those binaries (`npm run db:local`), and Docker configuration is provided for deployment.

## 13. Migration risks

| Risk | Mitigation |
|---|---|
| Old URLs (`/login.html` etc.) may be bookmarked | Server issues permanent redirects to the new routes |
| OneDrive syncs the project folder, including `node_modules` | Database data lives outside the folder; consider excluding `node_modules` from sync |
| No version control | `.gitignore` is included; the owner decides when to run `git init` |

## 14. Roadmap

The 14 phases in the brief, executed in order. Status of each feature at completion is recorded in
`docs/FEATURE_GUIDE.md`.
