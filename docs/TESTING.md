# Testing

`npm test` erases `TEST_DATABASE_URL` before running. Never point it at data you need.

| Layer | Location | Command |
|---|---|---|
| Unit | `backend/test/unit.test.ts` | `npm test` |
| Integration (real HTTP stack and PostgreSQL) | `backend/test/integration.test.ts` | `npm test` |
| End-to-end (real Chrome) | `e2e/` | `npm run build`, then `npm run test:e2e` |
| Static | ESLint and TypeScript | `npm run lint`, `npm run typecheck` |
| Dependencies | npm audit | `npm audit --omit=dev` |

**Unit tests** cover authentication validation, role checks, profile completion, the matching algorithm, group rules, project and session rules, notification logic and file detection.

**Integration tests** cover registration, verification, sessions, CSRF, password reset, privacy, discovery, connections, groups (including simultaneous approvals against capacity), projects, messaging, sessions, file permissions, teacher verification, role boundaries, mentorship, assignments, notifications, administration, and injection handling.

**End-to-end tests** drive the six workflows in the brief through the interface:

| | Workflow |
|---|---|
| A | Register, verify email, complete profile, discover, connect |
| B | Create group, request to join, approve, both reach the workspace |
| C | Create project, assign tasks, progress them, complete a milestone |
| D | Request mentorship, teacher accepts, session scheduled |
| E | Teacher registers, admin approves, teacher creates a community |
| F | Admin suspends; the user loses access |

`e2e/quality.spec.ts` visits public, student, teacher and admin screens at 360, 390, 768, 1024 and 1440 pixels and fails on horizontal overflow, unnamed controls, missing headings or alt text, small touch targets, or console errors. It also tests route guards, legacy redirects, live message delivery and output escaping.

## Not covered by automated tests

- A live AI provider call or a real SMTP server (no credentials were available)
- The Docker image and hosted deployment
- Load testing
- Screen-reader testing. Accessibility checks are automated and structural, so they do not establish full WCAG 2.2 AA conformance
