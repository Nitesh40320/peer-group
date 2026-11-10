-- Mentorship, assignments, notifications, moderation and platform administration.

-- A request becomes the ongoing relationship when its status is 'accepted'.
CREATE TABLE mentorships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  teacher_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  objective text NOT NULL,
  topics text[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected', 'ended')),
  response_note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz
);
CREATE UNIQUE INDEX mentorships_open_key ON mentorships (student_id, teacher_id) WHERE status IN ('pending', 'accepted');
CREATE INDEX mentorships_teacher_idx ON mentorships (teacher_id, status);

ALTER TABLE study_sessions
  ADD CONSTRAINT study_sessions_mentorship_fk FOREIGN KEY (mentorship_id) REFERENCES mentorships (id) ON DELETE CASCADE;

CREATE TABLE mentorship_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mentorship_id uuid NOT NULL REFERENCES mentorships (id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX mentorship_feedback_idx ON mentorship_feedback (mentorship_id, created_at DESC);

CREATE TABLE assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  group_id uuid REFERENCES study_groups (id) ON DELETE SET NULL,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  resource_id uuid REFERENCES resources (id) ON DELETE SET NULL,
  due_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed')),
  reminded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX assignments_teacher_idx ON assignments (teacher_id, created_at DESC);
CREATE INDEX assignments_due_idx ON assignments (due_at) WHERE status = 'active';

CREATE TABLE assignment_recipients (
  assignment_id uuid NOT NULL REFERENCES assignments (id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  PRIMARY KEY (assignment_id, student_id)
);
CREATE INDEX assignment_recipients_student_idx ON assignment_recipients (student_id);

CREATE TABLE submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id uuid NOT NULL REFERENCES assignments (id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  body text NOT NULL DEFAULT '',
  file_id uuid REFERENCES files (id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'needs_changes', 'completed')),
  feedback text NOT NULL DEFAULT '',
  reviewed_by uuid REFERENCES users (id) ON DELETE SET NULL,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  UNIQUE (assignment_id, student_id)
);
CREATE INDEX submissions_status_idx ON submissions (assignment_id, status);

CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  type text NOT NULL,
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  link text NOT NULL DEFAULT '',
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user_idx ON notifications (user_id, created_at DESC);
CREATE INDEX notifications_unread_idx ON notifications (user_id) WHERE read_at IS NULL;

CREATE TABLE reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id uuid REFERENCES users (id) ON DELETE SET NULL,
  target_type text NOT NULL CHECK (target_type IN ('user', 'group', 'message', 'resource')),
  target_id uuid NOT NULL,
  reason text NOT NULL,
  details text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'reviewing', 'resolved', 'dismissed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX reports_status_idx ON reports (status, created_at DESC);

CREATE TABLE report_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid NOT NULL REFERENCES reports (id) ON DELETE CASCADE,
  admin_id uuid REFERENCES users (id) ON DELETE SET NULL,
  status text NOT NULL,
  note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX report_events_report_idx ON report_events (report_id, created_at);

CREATE TABLE audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid REFERENCES users (id) ON DELETE SET NULL,
  action text NOT NULL,
  target_type text NOT NULL DEFAULT '',
  target_id text NOT NULL DEFAULT '',
  metadata jsonb NOT NULL DEFAULT '{}',
  ip text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_created_idx ON audit_logs (created_at DESC);
CREATE INDEX audit_logs_actor_idx ON audit_logs (actor_id);

CREATE TABLE support_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  name text NOT NULL,
  email text NOT NULL,
  category text NOT NULL CHECK (category IN ('general', 'problem', 'account')),
  message text NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX support_requests_status_idx ON support_requests (status, created_at DESC);

CREATE TABLE platform_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_by uuid REFERENCES users (id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO platform_settings (key, value) VALUES
  ('registration_open', 'true'),
  ('ai_enabled', 'true'),
  ('announcement_banner', '""');

CREATE TABLE ai_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  feature text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_usage_user_idx ON ai_usage (user_id, created_at DESC);
