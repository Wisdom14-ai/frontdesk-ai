-- §6 Lead-source attribution.
-- Per-clinic list of marketing channels (Google Ads, GMB, Referral, ...) and
-- the natural-language phrase a clinic's wasap.my link pre-fills, so the
-- inbound webhook can attribute a brand-new contact's channel on first
-- message instead of every lead landing as "whatsapp_inbound".
--
-- Run this in the Supabase SQL editor for the production project.
-- Safe to run multiple times.
--
-- DEPLOY ORDER: the application code that reads/writes this table is
-- schema-tolerant (falls back to no attribution match if the table is
-- missing), so ship the code first or this migration first — either order
-- is safe.
create table if not exists lead_sources (
  id uuid primary key default uuid_generate_v4(),
  clinic_id uuid references clinics(id) on delete cascade not null,
  label text not null,
  match_phrase text not null,
  created_at timestamptz default now()
);

alter table lead_sources enable row level security;

drop policy if exists lead_sources_same_clinic on lead_sources;
create policy lead_sources_same_clinic on lead_sources for all
  using (clinic_id = current_user_active_clinic_id())
  with check (clinic_id = current_user_active_clinic_id());

create index if not exists idx_lead_sources_clinic on lead_sources(clinic_id);
