# API

`docs/openapi.json` is an OpenAPI 3.1 document generated from the routes the server registers, listing all 112 operations with their validation schemas and access rules. It cannot drift from the code as long as it is regenerated: `npm run openapi`. Load it into Swagger UI, Postman or similar to browse it.

## Conventions

- Base path `/api`, JSON unless an operation is `multipart/form-data`.
- Sessions use an HttpOnly cookie. State-changing requests must send `x-csrf-token`, returned by `POST /api/auth/login` and `GET /api/auth/me`.
- Lists accept `page` and `pageSize` (maximum 50) and return `{ items, page, pageSize, total, totalPages }`.
- Timestamps are ISO 8601 with an offset, stored and returned as UTC.

Errors always have this shape:

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "…", "details": [{ "field": "email", "message": "…" }] } }
```

| Status | Meaning |
|---|---|
| 401 | Not signed in |
| 403 | Signed in without permission, or CSRF failure |
| 404 | Missing, or private and hidden from you |
| 409 | Conflict with current state |
| 413 | Upload too large |
| 422 | Validation failed |
| 429 | Rate limited |
| 503 | Optional service, such as AI, is unavailable |

## Endpoint groups

| Group | Paths |
|---|---|
| Authentication | `/auth/register`, `verify-email`, `resend-verification`, `login`, `logout`, `forgot-password`, `reset-password`, `change-password`, `me` |
| Profiles | `/users/me`, `/users/me/avatar`, `/users/me/preferences`, `/users/:id`, `/topics` |
| Discovery | `/students`, `/matches`, `/teachers` |
| Connections | `/connections`, `/connections/:id`, `/blocks`, `/blocks/:id` |
| Groups | `/groups`, `/groups/:id`, `join`, `leave`, `members`, `requests`, `invitations`, `/invitations/:id`, `/public/groups` |
| Workspace | `/groups/:id/workspace`, `announcements`, `tasks`, `/tasks/:id` |
| Projects | `/projects`, `/projects/:id`, `tasks`, `milestones`, `/milestones/:id` |
| Messaging | `/conversations`, `/conversations/:id/messages`, `/conversations/:id/read` |
| Sessions | `/sessions`, `/sessions/:id`, `join`, `leave`, `check-in`, `calendar.ics` |
| Resources | `/resources`, `/resources/:id`, `/files/:id` |
| Mentorship | `/mentorship`, `/mentorship/requests`, `/mentorship/requests/:id`, `/mentorship/:id/feedback` |
| Assignments | `/assignments`, `/assignments/:id`, `submission`, `/submissions/:id` |
| Dashboards | `/student/dashboard`, `/student/progress`, `/student/goals`, `/teacher/dashboard`, `/teacher/analytics`, `/teacher/verification` |
| Notifications | `/notifications`, `unread-count`, `read-all`, `/:id/read` |
| Administration | `/admin/dashboard`, `users`, `verifications`, `teachers/:id/verification`, `reports`, `audit`, `support`, `system`, `settings`, `broadcast` |
| Other | `/reports`, `/support`, `/meta`, `/ai/status`, `/ai/assist`; outside `/api`: `/health`, `/ws` |
