-- §2e Bot skip observability.
-- Records the most recent reason the WhatsApp chatbot skipped / cap-blocked an
-- inbound message for a clinic, so the admin go-live checklist and the clinic's
-- own dashboard can surface silent bot failures instead of pretending "the
-- assistant is handling everything".
--
-- Run this in the Supabase SQL editor for the production project.
-- Safe to run multiple times.
--
-- DEPLOY ORDER: the application code that writes these columns ships BEFORE this
-- migration runs. Those writes are schema-tolerant (see recordBotSkip in
-- src/lib/server/bot-skip-observability.ts) and never block the webhook, so the
-- bot keeps replying whether or not this has been applied yet.
alter table clinics add column if not exists last_bot_skip_reason text;
alter table clinics add column if not exists last_bot_skip_at timestamptz;
