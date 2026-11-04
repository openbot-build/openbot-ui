-- Product associations do not change the core trigger's execution destination.
ALTER TABLE kay_chat_metadata
  ADD COLUMN IF NOT EXISTS automation_ids jsonb NOT NULL DEFAULT '[]'::jsonb
  CHECK (jsonb_typeof(automation_ids) = 'array');
