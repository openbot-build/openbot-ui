-- Kay owns membership eligibility and connector references, never the core's tables.
CREATE TABLE IF NOT EXISTS kay_basic_compute_accounts (
  account_id text NOT NULL,
  organization_id text NOT NULL,
  computer_id text UNIQUE,
  bot_id text,
  generation integer NOT NULL DEFAULT 0 CHECK (generation >= 0),
  token_ciphertext text,
  state text NOT NULL DEFAULT 'provisioning' CHECK (state IN ('provisioning','needs_repair','connecting','ready')),
  last_request_id text,
  connected_at bigint,
  operation_lock_owner text,
  operation_lock_request_id text,
  operation_lock_until bigint,
  updated_at bigint NOT NULL,
  PRIMARY KEY (account_id, organization_id)
);
CREATE TABLE IF NOT EXISTS kay_basic_compute_operations (
  account_id text NOT NULL,
  organization_id text NOT NULL,
  request_id text NOT NULL,
  action text NOT NULL CHECK (action IN ('provision','repair','release')),
  phase text NOT NULL CHECK (phase IN ('pending','creating','granting','issuing_token','ready','needs_repair','failed')),
  computer_id text,
  command_key text NOT NULL,
  execution_id text,
  retired_computer_id text,
  retired_execution_id text,
  create_sent boolean NOT NULL DEFAULT false,
  grant_sent boolean NOT NULL DEFAULT false,
  token_sent boolean NOT NULL DEFAULT false,
  generation integer NOT NULL DEFAULT 0,
  revision integer NOT NULL DEFAULT 0,
  message text,
  lock_owner text,
  lock_until bigint,
  updated_at bigint NOT NULL,
  PRIMARY KEY (account_id, organization_id, request_id)
);
CREATE TABLE IF NOT EXISTS kay_basic_compute_lease (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  lease_id text NOT NULL UNIQUE,
  account_id text NOT NULL,
  organization_id text NOT NULL,
  computer_id text NOT NULL,
  generation integer NOT NULL,
  connection_nonce text NOT NULL,
  creation_confirmed boolean NOT NULL DEFAULT false,
  container_name text NOT NULL UNIQUE,
  expires_at bigint NOT NULL,
  state text NOT NULL CHECK (state IN ('starting','active','cleanup_pending'))
);
CREATE TABLE IF NOT EXISTS kay_basic_compute_calls (
  computer_id text NOT NULL,
  operation_id text NOT NULL,
  account_id text NOT NULL,
  organization_id text NOT NULL,
  generation integer NOT NULL,
  lease_id text,
  kind text NOT NULL CHECK (kind IN ('command','file')),
  status text NOT NULL CHECK (status IN ('started','completed','unknown')),
  started_at bigint NOT NULL,
  ended_at bigint,
  PRIMARY KEY (computer_id, operation_id)
);
