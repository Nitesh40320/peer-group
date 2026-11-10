-- Accounts, sessions, profiles, topics and the social graph.

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  password_hash text NOT NULL,
  full_name text NOT NULL,
  role text NOT NULL CHECK (role IN ('student', 'teacher', 'admin')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  email_verified_at timestamptz,
  avatar_file_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_email_lowercase CHECK (email = lower(email))
);
CREATE UNIQUE INDEX users_email_key ON users (email);
CREATE INDEX users_role_idx ON users (role, status);
CREATE INDEX users_name_search_idx ON users (lower(full_name) text_pattern_ops);

CREATE TABLE files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  storage_key text NOT NULL UNIQUE,
  original_name text NOT NULL,
  mime_type text NOT NULL,
  size_bytes integer NOT NULL CHECK (size_bytes > 0),
  purpose text NOT NULL CHECK (purpose IN ('avatar', 'verification', 'resource', 'message', 'submission')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX files_owner_idx ON files (owner_id);

ALTER TABLE users ADD CONSTRAINT users_avatar_fk FOREIGN KEY (avatar_file_id) REFERENCES files (id) ON DELETE SET NULL;

CREATE TABLE sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  csrf_token text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_idx ON sessions (user_id);
CREATE INDEX sessions_expiry_idx ON sessions (expires_at);

CREATE TABLE auth_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  purpose text NOT NULL CHECK (purpose IN ('verify_email', 'reset_password')),
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auth_tokens_user_idx ON auth_tokens (user_id, purpose);

CREATE TABLE student_profiles (
  user_id uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  institution text NOT NULL DEFAULT '',
  department text NOT NULL DEFAULT '',
  academic_year smallint CHECK (academic_year BETWEEN 1 AND 8),
  bio text NOT NULL DEFAULT '',
  learning_goals text NOT NULL DEFAULT '',
  learning_methods text[] NOT NULL DEFAULT '{}',
  availability text[] NOT NULL DEFAULT '{}',
  visibility text NOT NULL DEFAULT 'everyone' CHECK (visibility IN ('everyone', 'connections', 'hidden')),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX student_profiles_year_idx ON student_profiles (academic_year);
CREATE INDEX student_profiles_availability_idx ON student_profiles USING gin (availability);

CREATE TABLE teacher_profiles (
  user_id uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  institution text NOT NULL DEFAULT '',
  department text NOT NULL DEFAULT '',
  designation text NOT NULL DEFAULT '',
  bio text NOT NULL DEFAULT '',
  experience text NOT NULL DEFAULT '',
  verification_status text NOT NULL DEFAULT 'pending'
    CHECK (verification_status IN ('pending', 'approved', 'rejected', 'needs_info')),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX teacher_profiles_status_idx ON teacher_profiles (verification_status);

CREATE TABLE teacher_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  statement text NOT NULL DEFAULT '',
  document_file_id uuid REFERENCES files (id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'needs_info')),
  reviewer_id uuid REFERENCES users (id) ON DELETE SET NULL,
  decision_note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz
);
CREATE INDEX teacher_verifications_status_idx ON teacher_verifications (status, created_at);
CREATE INDEX teacher_verifications_teacher_idx ON teacher_verifications (teacher_id, created_at DESC);

-- Subjects, skills and interests share a shape, so one table holds all three.
CREATE TABLE topics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('subject', 'skill', 'interest')),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX topics_kind_name_key ON topics (kind, lower(name));

CREATE TABLE user_topics (
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  topic_id uuid NOT NULL REFERENCES topics (id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, topic_id)
);
CREATE INDEX user_topics_topic_idx ON user_topics (topic_id, user_id);

-- A row is a request while pending and a connection once accepted.
CREATE TABLE connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  addressee_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
  created_at timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz,
  CHECK (requester_id <> addressee_id)
);
CREATE UNIQUE INDEX connections_pair_key ON connections (LEAST(requester_id, addressee_id), GREATEST(requester_id, addressee_id));
CREATE INDEX connections_addressee_idx ON connections (addressee_id, status);
CREATE INDEX connections_requester_idx ON connections (requester_id, status);

CREATE TABLE user_blocks (
  blocker_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  blocked_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id),
  CHECK (blocker_id <> blocked_id)
);
CREATE INDEX user_blocks_blocked_idx ON user_blocks (blocked_id);

CREATE TABLE notification_preferences (
  user_id uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  muted_types text[] NOT NULL DEFAULT '{}',
  email_types text[] NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE personal_goals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  title text NOT NULL,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX personal_goals_user_idx ON personal_goals (user_id, created_at DESC);
