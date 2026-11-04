-- Kay memberships are account entitlements, independent of core organization data.
CREATE TABLE IF NOT EXISTS kay_subscriptions (
 account_id text PRIMARY KEY,
 plan_id text NOT NULL CHECK (plan_id IN ('precious','flawless')),
 starts_at bigint NOT NULL,
 expires_at bigint NOT NULL CHECK (expires_at > starts_at),
 revision bigint NOT NULL CHECK (revision > 0)
);
CREATE TABLE IF NOT EXISTS kay_membership_codes (
 sequence bigserial UNIQUE NOT NULL,
 id text PRIMARY KEY,
 code_hash text UNIQUE NOT NULL CHECK (code_hash ~ '^[0-9a-f]{64}$'),
 account_id text,
 redeemed_name text,
 plan_id text NOT NULL CHECK (plan_id IN ('precious','flawless')),
 months integer NOT NULL CHECK (months BETWEEN 1 AND 12),
 created_by text NOT NULL,
 request_id text NOT NULL,
 created_at bigint NOT NULL,
 redeemed_at bigint,
 revoked_at bigint,
 revoked_by text,
 UNIQUE(created_by, request_id),
 CHECK (redeemed_at IS NULL OR revoked_at IS NULL),
 CHECK ((redeemed_at IS NULL) = (account_id IS NULL)),
 CHECK ((redeemed_at IS NULL) = (redeemed_name IS NULL)),
 CHECK ((revoked_at IS NULL) = (revoked_by IS NULL))
);
CREATE TABLE IF NOT EXISTS kay_membership_redemptions (
 account_id text NOT NULL,
 request_id text NOT NULL,
 code_id text NOT NULL REFERENCES kay_membership_codes(id),
 plan_id text NOT NULL CHECK (plan_id IN ('precious','flawless')),
 starts_at bigint NOT NULL,
 expires_at bigint NOT NULL,
 redeemed_at bigint NOT NULL,
 PRIMARY KEY(account_id,request_id)
);
CREATE INDEX IF NOT EXISTS kay_membership_redemption_code ON kay_membership_redemptions(code_id);
