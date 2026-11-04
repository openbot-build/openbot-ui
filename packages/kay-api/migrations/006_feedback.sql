CREATE TABLE IF NOT EXISTS kay_feedback_connections (
 account_id text NOT NULL,
 organization_id text NOT NULL,
 connection_id uuid NOT NULL UNIQUE,
 credential_hash text NOT NULL UNIQUE,
 bot_id text NOT NULL,
 enabled boolean NOT NULL DEFAULT true,
 PRIMARY KEY(account_id,organization_id)
);
CREATE TABLE IF NOT EXISTS kay_feedback_reports (
 id uuid PRIMARY KEY,
 account_id text NOT NULL,
 organization_id text NOT NULL,
 bot_id text NOT NULL,
 report_id uuid NOT NULL,
 content jsonb NOT NULL,
 status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','triaged','resolved')),
 revision integer NOT NULL DEFAULT 0,
 created_at bigint NOT NULL,
 updated_at bigint NOT NULL,
 updated_by text,
 UNIQUE(account_id,organization_id,report_id)
);
CREATE INDEX IF NOT EXISTS kay_feedback_reports_inbox ON kay_feedback_reports(status,created_at DESC,id);
