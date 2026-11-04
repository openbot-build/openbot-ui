-- Task activity is separate from socket liveness. Missing activity cannot start idle cleanup.
ALTER TABLE kay_basic_compute_lease
  ADD COLUMN IF NOT EXISTS activity text NOT NULL DEFAULT 'unknown'
    CHECK (activity IN ('working', 'idle', 'unknown')),
  ADD COLUMN IF NOT EXISTS activity_at bigint,
  ADD COLUMN IF NOT EXISTS idle_since bigint;
