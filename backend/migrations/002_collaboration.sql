-- Study groups, workspaces, projects, messaging, sessions and resources.

CREATE TABLE study_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  objectives text NOT NULL DEFAULT '',
  difficulty text NOT NULL DEFAULT 'intermediate' CHECK (difficulty IN ('beginner', 'intermediate', 'advanced')),
  capacity integer NOT NULL DEFAULT 10 CHECK (capacity BETWEEN 2 AND 200),
  visibility text NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'private')),
  kind text NOT NULL DEFAULT 'study' CHECK (kind IN ('study', 'community')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX study_groups_browse_idx ON study_groups (visibility, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX study_groups_owner_idx ON study_groups (owner_id);
CREATE INDEX study_groups_name_idx ON study_groups (lower(name) text_pattern_ops);

CREATE TABLE group_topics (
  group_id uuid NOT NULL REFERENCES study_groups (id) ON DELETE CASCADE,
  topic_id uuid NOT NULL REFERENCES topics (id) ON DELETE CASCADE,
  PRIMARY KEY (group_id, topic_id)
);
CREATE INDEX group_topics_topic_idx ON group_topics (topic_id);

CREATE TABLE group_members (
  group_id uuid NOT NULL REFERENCES study_groups (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'leader', 'member')),
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, user_id)
);
CREATE INDEX group_members_user_idx ON group_members (user_id);

CREATE TABLE group_join_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES study_groups (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  message text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  decided_by uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz
);
CREATE UNIQUE INDEX group_join_requests_pending_key ON group_join_requests (group_id, user_id) WHERE status = 'pending';

CREATE TABLE group_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES study_groups (id) ON DELETE CASCADE,
  inviter_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  invitee_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined')),
  created_at timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz
);
CREATE UNIQUE INDEX group_invitations_pending_key ON group_invitations (group_id, invitee_id) WHERE status = 'pending';
CREATE INDEX group_invitations_invitee_idx ON group_invitations (invitee_id, status);

CREATE TABLE group_activity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES study_groups (id) ON DELETE CASCADE,
  actor_id uuid REFERENCES users (id) ON DELETE SET NULL,
  verb text NOT NULL,
  detail text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX group_activity_group_idx ON group_activity (group_id, created_at DESC);

CREATE TABLE announcements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES study_groups (id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  title text NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX announcements_group_idx ON announcements (group_id, created_at DESC);

CREATE TABLE projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES study_groups (id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  objectives text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX projects_group_idx ON projects (group_id, created_at DESC);

CREATE TABLE project_members (
  project_id uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  PRIMARY KEY (project_id, user_id)
);
CREATE INDEX project_members_user_idx ON project_members (user_id);

CREATE TABLE milestones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  title text NOT NULL,
  due_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX milestones_project_idx ON milestones (project_id);

-- A task belongs to a group and optionally to one of that group's projects.
CREATE TABLE tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES study_groups (id) ON DELETE CASCADE,
  project_id uuid REFERENCES projects (id) ON DELETE CASCADE,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'in_progress', 'review', 'completed')),
  assignee_id uuid REFERENCES users (id) ON DELETE SET NULL,
  created_by uuid REFERENCES users (id) ON DELETE SET NULL,
  due_at timestamptz,
  completed_at timestamptz,
  reminded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tasks_group_idx ON tasks (group_id, status);
CREATE INDEX tasks_project_idx ON tasks (project_id, status);
CREATE INDEX tasks_assignee_idx ON tasks (assignee_id, status);
CREATE INDEX tasks_due_idx ON tasks (due_at) WHERE status <> 'completed';

CREATE TABLE conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL CHECK (type IN ('direct', 'group', 'project')),
  direct_key text UNIQUE,
  group_id uuid REFERENCES study_groups (id) ON DELETE CASCADE,
  project_id uuid REFERENCES projects (id) ON DELETE CASCADE,
  last_message_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((type = 'direct') = (direct_key IS NOT NULL))
);
CREATE UNIQUE INDEX conversations_group_key ON conversations (group_id) WHERE type = 'group';
CREATE UNIQUE INDEX conversations_project_key ON conversations (project_id) WHERE type = 'project';

CREATE TABLE conversation_members (
  conversation_id uuid NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  last_read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, user_id)
);
CREATE INDEX conversation_members_user_idx ON conversation_members (user_id);

CREATE TABLE messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  sender_id uuid REFERENCES users (id) ON DELETE SET NULL,
  body text NOT NULL DEFAULT '',
  file_id uuid REFERENCES files (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX messages_conversation_idx ON messages (conversation_id, created_at DESC);

CREATE TABLE study_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organizer_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  group_id uuid REFERENCES study_groups (id) ON DELETE CASCADE,
  mentorship_id uuid,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  starts_at timestamptz NOT NULL,
  duration_minutes integer NOT NULL CHECK (duration_minutes BETWEEN 5 AND 600),
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'cancelled')),
  reminded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX study_sessions_start_idx ON study_sessions (starts_at) WHERE status = 'scheduled';
CREATE INDEX study_sessions_group_idx ON study_sessions (group_id);

CREATE TABLE session_participants (
  session_id uuid NOT NULL REFERENCES study_sessions (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  attended_at timestamptz,
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, user_id)
);
CREATE INDEX session_participants_user_idx ON session_participants (user_id);

CREATE TABLE resources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  group_id uuid REFERENCES study_groups (id) ON DELETE CASCADE,
  project_id uuid REFERENCES projects (id) ON DELETE CASCADE,
  subject_id uuid REFERENCES topics (id) ON DELETE SET NULL,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  kind text NOT NULL CHECK (kind IN ('file', 'link')),
  url text,
  file_id uuid REFERENCES files (id) ON DELETE SET NULL,
  tags text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind = 'link') = (url IS NOT NULL))
);
CREATE INDEX resources_group_idx ON resources (group_id, created_at DESC);
CREATE INDEX resources_project_idx ON resources (project_id);
CREATE INDEX resources_subject_idx ON resources (subject_id);
CREATE INDEX resources_tags_idx ON resources USING gin (tags);
