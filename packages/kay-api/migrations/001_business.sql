CREATE TABLE IF NOT EXISTS kay_preferences (
 account_id text PRIMARY KEY, body jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS kay_operations (
 id text PRIMARY KEY, account_id text NOT NULL, backend text NOT NULL,
 epoch bigint NOT NULL, kind text NOT NULL, request jsonb NOT NULL,
 phase text NOT NULL CHECK (phase IN ('Prepared','Sending','Applied','Completed','OutcomeUnknown')),
 result jsonb, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS kay_operations_owner ON kay_operations(account_id, phase);
CREATE TABLE IF NOT EXISTS kay_navigation (
 account_id text NOT NULL, flow_id text NOT NULL, return_to text NOT NULL,
 PRIMARY KEY(account_id, flow_id)
);

CREATE TABLE IF NOT EXISTS kay_auth_revocations (
 id text PRIMARY KEY, credential_digest text NOT NULL, account_id text NOT NULL,
 backend text NOT NULL CHECK(backend IN ('e','openbot')), epoch bigint NOT NULL,
 phase text NOT NULL CHECK(phase IN ('Pending','Completed')),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS kay_auth_revocations_pending ON kay_auth_revocations(credential_digest) WHERE phase='Pending';

-- Kay owns presentation metadata; execution and history remain in OpenBot.
CREATE TABLE IF NOT EXISTS kay_chat_metadata (
 account_id text NOT NULL, organization_id text NOT NULL, chat_id text NOT NULL,
 revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
 title text, archived boolean NOT NULL DEFAULT false,
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(account_id, organization_id, chat_id)
);
