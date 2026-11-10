# Database schema

PostgreSQL. All tables use UUID keys and foreign keys with explicit delete behaviour. The SQL in `backend/migrations/` is authoritative.

## Migration order

Applied in filename order, each once and each in a transaction. Applied names are stored in `schema_migrations`, and an advisory lock prevents concurrent runs.

1. `001_foundation.sql`: accounts, sessions, profiles, topics, connections
2. `002_collaboration.sql`: groups, projects, tasks, messaging, sessions, resources
3. `003_guidance_and_admin.sql`: mentorship, assignments, notifications, moderation, settings

Never edit an applied migration. Add a new numbered file.

## Tables

| Area | Table | Notes |
|---|---|---|
| Accounts | `users` | Email stored lowercase and unique; `role`, `status` |
| | `sessions` | Stores a SHA-256 hash of the token, never the token |
| | `auth_tokens` | Single-use verification and reset tokens, hashed |
| | `notification_preferences` | Muted and email-enabled types |
| Profiles | `student_profiles`, `teacher_profiles` | One row per user |
| | `teacher_verifications` | Submission and decision history |
| | `topics`, `user_topics` | Subjects, skills and interests share one table, distinguished by `kind` |
| | `personal_goals` | Student goals |
| Social | `connections` | A request while `pending`, a connection once `accepted`; one row per pair (expression unique index) |
| | `user_blocks` | |
| Groups | `study_groups` | Soft deleted through `deleted_at`, so history survives accidental deletion |
| | `group_topics`, `group_members` | Member role: owner, leader, member |
| | `group_join_requests`, `group_invitations` | Partial unique index allows one pending per person |
| | `group_activity`, `announcements` | |
| Projects | `projects`, `project_members`, `milestones` | |
| | `tasks` | Belongs to a group and optionally a project, so group and project boards share one implementation |
| Messaging | `conversations` | `direct`, `group` or `project`; unique `direct_key` prevents duplicates |
| | `conversation_members`, `messages` | Unread counts derive from `last_read_at` |
| Sessions | `study_sessions`, `session_participants` | Times are `timestamptz` (UTC) |
| Files | `files`, `resources` | `files.purpose` determines the access rule |
| Guidance | `mentorships` | A request becomes the relationship at `accepted`; partial unique index allows one open per pair |
| | `mentorship_feedback` | |
| | `assignments`, `assignment_recipients`, `submissions` | Recipients are fixed when the assignment is created |
| Platform | `notifications`, `reports`, `report_events`, `audit_logs`, `support_requests`, `platform_settings`, `ai_usage` | |

## How the brief's logical entities map

Subjects, Skills and Interests became `topics`. UserSubjects, UserSkills and UserInterests became `user_topics`. Connections and ConnectionRequests became `connections`. MentorshipRequests and MentorshipRelationships became `mentorships`. Reviews are fields on `submissions`. UserPreferences became `notification_preferences`.

## Backup

See `DEPLOYMENT.md`. Back up the database and the upload directory together.
