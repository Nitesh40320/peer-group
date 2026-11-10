# Authentication and security

## Accounts

- Public registration can only create students and teachers. Administrators are created with the `admin:create` command.
- Passwords are hashed with Argon2id and need at least 10 characters, with a letter and a number.
- Sign-in requires a verified email. Registration and password-reset responses do not reveal whether an account exists.
- The Student/Teacher switch on the sign-in screen only changes labels. Permissions come from the account on the server.

## Sessions

Sessions are random tokens in an `HttpOnly`, `SameSite=Lax` cookie, `Secure` and `__Host-` prefixed in production. Only a SHA-256 hash is stored. They expire after 14 days. Every request reloads the user, so a suspension takes effect immediately. Suspension and password reset delete all of a user's sessions.

## CSRF and CORS

Each session has a CSRF token, and every state-changing authenticated request must send it in `x-csrf-token`. CORS is closed unless `CORS_ORIGINS` is set. WebSockets also check the `Origin` header.

## Authorization

`route()` applies each endpoint's access list:

| Access | Who |
|---|---|
| `public` | Anyone |
| `any` | Any signed-in user |
| `student` / `teacher` / `admin` | That role |
| `approved_teacher` | Teachers an administrator has approved |
| `COLLABORATORS` | Students and approved teachers |

Resources are then checked against ownership or membership: group role, project membership, conversation membership, assignment recipient, and a per-purpose rule for each file. Private items you cannot access return 404, so their existence is not revealed. Teachers receive no access to conversations they are not part of.

## Teacher verification

States: `pending`, `approved`, `rejected`, `needs_info`. Only administrators decide. Each decision is written to the audit log. Verification documents can be read only by their owner and administrators.

## Other protections

| Threat | Protection |
|---|---|
| SQL injection | Parameterized queries only; `LIKE` wildcards escaped |
| XSS | React output encoding, Content-Security-Policy, `javascript:` links rejected |
| Malicious uploads | Type detected from file bytes; extension and declared type are not trusted; random storage names; sanitized filenames; size limit; served as attachments with `nosniff` |
| Brute force | Rate limits on authentication and email endpoints, plus a general API limit |
| Information leaks | Generic 500 responses; `/health` reveals only status; secrets never appear in responses |
| Shared-cache leaks | API responses are `no-store`; files are `private` |
| Accountability | `audit_logs` records sign-ins, suspensions, verification decisions, moderation and settings changes |

Dependencies were checked with `npm audit --omit=dev` (0 known vulnerabilities on 2026-11-08). No external penetration test has been performed.
