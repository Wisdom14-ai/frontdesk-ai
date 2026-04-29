-- Supabase schema for Clinic OS retention-focused MVP

create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

create table if not exists clinics (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  clinic_type text check (clinic_type in ('dental', 'aesthetic', 'gp', 'functional_medicine', 'physio')) not null default 'dental',
  plan_type text check (plan_type in ('starter', 'pro')) not null default 'starter',
  subscription_status text check (subscription_status in ('active', 'paused', 'cancelled', 'churned')) not null default 'active',
  payment_status text check (payment_status in ('pending', 'received')) not null default 'pending',
  payment_received_at timestamp with time zone,
  billing_cycle_anchor date,
  whatsapp_status text check (whatsapp_status in ('not_connected', 'pending_qr', 'connected', 'disconnected')) not null default 'not_connected',
  whatsapp_number text,
  whatsapp_qr_code text,
  whatsapp_pairing_code text,
  whatsapp_connected_at timestamp with time zone,
  whatsapp_last_synced_at timestamp with time zone,
  onboarding_completed_at timestamp with time zone,
  owner_name text,
  owner_phone text,
  clinic_prompt text,
  internal_notes text,
  manual_monthly_cost_myr numeric(10, 2),
  contact_limit_override integer,
  monthly_message_limit_override integer,
  evolution_api_url text,
  evolution_api_key text,
  evolution_instance_name text,
  n8n_webhook_url text,
  webhook_secret text default encode(gen_random_bytes(16), 'hex'),
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

alter table clinics add column if not exists evolution_api_url text;
alter table clinics add column if not exists evolution_api_key text;
alter table clinics add column if not exists evolution_instance_name text;
alter table clinics add column if not exists n8n_webhook_url text;
alter table clinics add column if not exists webhook_secret text default encode(gen_random_bytes(16), 'hex');
alter table clinics add column if not exists clinic_type text check (clinic_type in ('dental', 'aesthetic', 'gp', 'functional_medicine', 'physio')) not null default 'dental';
alter table clinics add column if not exists plan_type text check (plan_type in ('starter', 'pro')) not null default 'starter';
alter table clinics add column if not exists subscription_status text check (subscription_status in ('active', 'paused', 'cancelled', 'churned')) not null default 'active';
alter table clinics add column if not exists payment_status text check (payment_status in ('pending', 'received')) not null default 'pending';
alter table clinics add column if not exists payment_received_at timestamp with time zone;
alter table clinics add column if not exists billing_cycle_anchor date;
alter table clinics add column if not exists whatsapp_status text check (whatsapp_status in ('not_connected', 'pending_qr', 'connected', 'disconnected')) not null default 'not_connected';
alter table clinics add column if not exists whatsapp_number text;
alter table clinics add column if not exists whatsapp_qr_code text;
alter table clinics add column if not exists whatsapp_pairing_code text;
alter table clinics add column if not exists whatsapp_connected_at timestamp with time zone;
alter table clinics add column if not exists whatsapp_last_synced_at timestamp with time zone;
alter table clinics add column if not exists onboarding_completed_at timestamp with time zone;
alter table clinics add column if not exists owner_name text;
alter table clinics add column if not exists owner_phone text;
alter table clinics add column if not exists clinic_prompt text;
alter table clinics add column if not exists internal_notes text;
alter table clinics add column if not exists manual_monthly_cost_myr numeric(10, 2);
alter table clinics add column if not exists contact_limit_override integer;
alter table clinics add column if not exists monthly_message_limit_override integer;

create table if not exists agency_admins (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  created_at timestamp with time zone default now()
);

create table if not exists users (
  id uuid primary key references auth.users(id) on delete cascade,
  clinic_id uuid references clinics(id) not null,
  role text check (role in ('admin', 'receptionist', 'manager')) not null default 'receptionist',
  full_name text not null,
  email text not null,
  status text check (status in ('active', 'invited', 'disabled')) not null default 'active',
  invited_at timestamp with time zone,
  disabled_at timestamp with time zone,
  last_seen_at timestamp with time zone,
  created_at timestamp with time zone default now()
);

alter table users add column if not exists status text check (status in ('active', 'invited', 'disabled')) not null default 'active';
alter table users add column if not exists invited_at timestamp with time zone;
alter table users add column if not exists disabled_at timestamp with time zone;
alter table users add column if not exists last_seen_at timestamp with time zone;

do $$
declare
  legacy_constraint record;
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'users'
  ) then
    for legacy_constraint in
      select con.conname
      from pg_constraint con
      join pg_class rel on rel.oid = con.conrelid
      join pg_namespace nsp on nsp.oid = rel.relnamespace
      where nsp.nspname = 'public'
        and rel.relname = 'users'
        and con.contype = 'c'
        and pg_get_constraintdef(con.oid) ilike '%role%'
    loop
      execute format(
        'alter table public.users drop constraint if exists %I',
        legacy_constraint.conname
      );
    end loop;

    if exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'users'
        and column_name = 'is_active'
    ) then
      update public.users
      set
        status = case
          when is_active = false then 'disabled'
          when status in ('active', 'invited', 'disabled') then status
          else 'active'
        end,
        disabled_at = case
          when is_active = false and disabled_at is null then now()
          when is_active = true then null
          else disabled_at
        end;
    else
      update public.users
      set status = case
        when status in ('active', 'invited', 'disabled') then status
        else 'active'
      end;
    end if;

    update public.users
    set role = case
      when role = 'owner' then 'admin'
      when role in ('admin', 'manager', 'receptionist') then role
      else 'receptionist'
    end;

    alter table public.users
      alter column role set default 'receptionist',
      alter column role set not null;

    alter table public.users
      add constraint users_role_check
      check (role in ('admin', 'manager', 'receptionist'));
  end if;
end;
$$;

create table if not exists contacts (
  id uuid primary key default uuid_generate_v4(),
  clinic_id uuid references clinics(id) not null,
  full_name text not null,
  phone_e164 text not null,
  treatment_interest text,
  current_status text not null default 'new_lead',
  assigned_user_id uuid references users(id),
  source text,
  lead_source_detail text,
  campaign_name text,
  unread_count integer default 0,
  bot_mode text check (bot_mode in ('active', 'paused', 'handoff_required')) default 'active',
  ai_last_intent text,
  ai_last_confidence numeric,
  automation_enabled boolean default true,
  next_follow_up_at timestamp with time zone,
  last_handoff_reason text,
  last_inbound_at timestamp with time zone,
  last_outbound_at timestamp with time zone,
  appointment_date date,
  appointment_time time,
  reminder_sent_at timestamp with time zone,
  marketing_opt_out_at timestamp with time zone,
  marketing_opt_out_reason text,
  marketing_opt_out_source text,
  lead_memory_auto jsonb not null default '{}'::jsonb,
  lead_memory_override jsonb not null default '{}'::jsonb,
  staff_note text,
  lead_memory_last_generated_at timestamp with time zone,
  lead_memory_last_error text,
  attendance_status text check (attendance_status in ('pending', 'attended', 'no_show', 'cancelled')) default 'pending',
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

alter table contacts add column if not exists automation_enabled boolean default true;
alter table contacts add column if not exists next_follow_up_at timestamp with time zone;
alter table contacts add column if not exists last_handoff_reason text;
alter table contacts add column if not exists lead_source_detail text;
alter table contacts add column if not exists reminder_sent_at timestamp with time zone;
alter table contacts add column if not exists marketing_opt_out_at timestamp with time zone;
alter table contacts add column if not exists marketing_opt_out_reason text;
alter table contacts add column if not exists marketing_opt_out_source text;
alter table contacts add column if not exists lead_memory_auto jsonb not null default '{}'::jsonb;
alter table contacts add column if not exists lead_memory_override jsonb not null default '{}'::jsonb;
alter table contacts add column if not exists staff_note text;
alter table contacts add column if not exists lead_memory_last_generated_at timestamp with time zone;
alter table contacts add column if not exists lead_memory_last_error text;

create table if not exists contact_memory_jobs (
  id uuid primary key default uuid_generate_v4(),
  clinic_id uuid references clinics(id) on delete cascade not null,
  contact_id uuid references contacts(id) on delete cascade not null,
  trigger_source text check (
    trigger_source in (
      'message_inbound',
      'message_outbound_human',
      'message_outbound_bot',
      'contact_updated',
      'manual_refresh',
      'backfill'
    )
  ) not null,
  status text check (
    status in ('pending', 'processing', 'completed', 'failed', 'skipped')
  ) not null default 'pending',
  scheduled_for timestamp with time zone not null default now(),
  attempt_count integer not null default 0,
  last_error text,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  completed_at timestamp with time zone
);

alter table contact_memory_jobs add column if not exists clinic_id uuid references clinics(id) on delete cascade;
alter table contact_memory_jobs add column if not exists contact_id uuid references contacts(id) on delete cascade;
alter table contact_memory_jobs add column if not exists trigger_source text;
alter table contact_memory_jobs add column if not exists status text default 'pending';
alter table contact_memory_jobs add column if not exists scheduled_for timestamp with time zone default now();
alter table contact_memory_jobs add column if not exists attempt_count integer default 0;
alter table contact_memory_jobs add column if not exists last_error text;
alter table contact_memory_jobs add column if not exists created_at timestamp with time zone default now();
alter table contact_memory_jobs add column if not exists updated_at timestamp with time zone default now();
alter table contact_memory_jobs add column if not exists completed_at timestamp with time zone;

with ranked_pending_contact_memory_jobs as (
  select
    id,
    row_number() over (
      partition by clinic_id, contact_id
      order by scheduled_for asc, created_at asc, id asc
    ) as row_num
  from contact_memory_jobs
  where status = 'pending'
)
update contact_memory_jobs as jobs
set
  status = 'skipped',
  last_error = coalesce(jobs.last_error, 'Skipped duplicate pending lead memory job.'),
  updated_at = now(),
  completed_at = now()
from ranked_pending_contact_memory_jobs as ranked
where jobs.id = ranked.id
  and ranked.row_num > 1;

create unique index if not exists idx_contact_memory_jobs_one_pending_per_contact
  on contact_memory_jobs(clinic_id, contact_id)
  where status = 'pending';

create table if not exists conversations (
  id uuid primary key default uuid_generate_v4(),
  clinic_id uuid references clinics(id) on delete cascade not null,
  contact_id uuid references contacts(id) on delete cascade not null,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

alter table conversations add column if not exists clinic_id uuid references clinics(id) on delete cascade;
alter table conversations add column if not exists contact_id uuid references contacts(id) on delete cascade;
alter table conversations add column if not exists created_at timestamp with time zone default now();
alter table conversations add column if not exists updated_at timestamp with time zone default now();

create table if not exists messages (
  id uuid primary key default uuid_generate_v4(),
  clinic_id uuid references clinics(id) not null,
  contact_id uuid references contacts(id) on delete cascade not null,
  conversation_id uuid references conversations(id) on delete set null,
  provider_message_id text unique,
  direction text check (direction in ('inbound', 'outbound')) not null,
  sender_type text check (sender_type in ('lead', 'bot', 'human', 'system')) not null,
  content text not null,
  ai_generated boolean default false,
  ai_confidence numeric,
  created_at timestamp with time zone default now()
);

alter table messages add column if not exists clinic_id uuid references clinics(id);
alter table messages add column if not exists conversation_id uuid references conversations(id) on delete set null;
alter table messages add column if not exists provider_message_id text;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'messages'
      and column_name = 'wa_message_id'
  ) then
    update public.messages
    set provider_message_id = wa_message_id
    where provider_message_id is null
      and wa_message_id is not null;
  end if;
end;
$$;

do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'conversations'
  ) then
    with ranked as (
      select
        id,
        first_value(id) over (
          partition by clinic_id, contact_id
          order by created_at asc nulls last, id asc
        ) as canonical_id,
        row_number() over (
          partition by clinic_id, contact_id
          order by created_at asc nulls last, id asc
        ) as duplicate_rank
      from public.conversations
      where clinic_id is not null
        and contact_id is not null
    )
    update public.messages as m
    set conversation_id = ranked.canonical_id
    from ranked
    where ranked.duplicate_rank > 1
      and m.conversation_id = ranked.id;

    delete from public.conversations as c
    using (
      select id
      from (
        select
          id,
          row_number() over (
            partition by clinic_id, contact_id
            order by created_at asc nulls last, id asc
          ) as duplicate_rank
        from public.conversations
        where clinic_id is not null
          and contact_id is not null
      ) ranked
      where ranked.duplicate_rank > 1
    ) duplicates
    where c.id = duplicates.id;
  end if;
end;
$$;

create unique index if not exists idx_conversations_clinic_contact_unique
  on conversations(clinic_id, contact_id);

insert into conversations (clinic_id, contact_id)
select distinct clinic_id, id
from contacts
where clinic_id is not null
on conflict (clinic_id, contact_id) do nothing;

update messages
set conversation_id = conversations.id
from conversations
where messages.conversation_id is null
  and conversations.clinic_id = messages.clinic_id
  and conversations.contact_id = messages.contact_id;

create table if not exists revenue_logs (
  id uuid primary key default uuid_generate_v4(),
  clinic_id uuid references clinics(id) not null,
  contact_id uuid references contacts(id) on delete cascade not null,
  amount numeric(10, 2),
  note text,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

alter table revenue_logs add column if not exists clinic_id uuid references clinics(id);

create table if not exists ai_conversation_state (
  contact_id uuid primary key references contacts(id) on delete cascade,
  context_json jsonb default '{}'::jsonb,
  last_evaluated_at timestamp with time zone default now()
);

create table if not exists audit_logs (
  id uuid primary key default uuid_generate_v4(),
  clinic_id uuid references clinics(id) not null,
  user_id uuid references auth.users(id),
  action text not null,
  resource_type text not null,
  resource_id text not null,
  details jsonb,
  created_at timestamp with time zone default now()
);

create table if not exists automation_rules (
  id uuid primary key default uuid_generate_v4(),
  clinic_id uuid references clinics(id) on delete cascade not null,
  rule_key text not null,
  name text not null,
  job_type text check (job_type in ('same_day_reminder', 'no_reply_follow_up', 'monthly_nurture')) not null,
  delay_hours integer not null default 0,
  template_key text,
  template_body text,
  is_enabled boolean not null default true,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  unique (clinic_id, rule_key)
);

alter table automation_rules add column if not exists clinic_id uuid references clinics(id) on delete cascade;
alter table automation_rules add column if not exists rule_key text;
alter table automation_rules add column if not exists name text;
alter table automation_rules add column if not exists job_type text;
alter table automation_rules add column if not exists delay_hours integer default 0;
alter table automation_rules add column if not exists template_key text;
alter table automation_rules add column if not exists template_body text;
alter table automation_rules add column if not exists is_enabled boolean default true;
alter table automation_rules add column if not exists created_at timestamp with time zone default now();
alter table automation_rules add column if not exists updated_at timestamp with time zone default now();

create table if not exists automation_jobs (
  id uuid primary key default uuid_generate_v4(),
  clinic_id uuid references clinics(id) on delete cascade not null,
  contact_id uuid references contacts(id) on delete cascade not null,
  rule_key text,
  job_type text check (job_type in ('same_day_reminder', 'no_reply_follow_up', 'monthly_nurture')) not null,
  template_key text,
  status text check (status in ('pending', 'processing', 'sent', 'cancelled', 'failed', 'skipped')) not null default 'pending',
  scheduled_for timestamp with time zone not null,
  payload jsonb default '{}'::jsonb,
  sent_at timestamp with time zone,
  cancelled_at timestamp with time zone,
  cancel_reason text,
  last_error text,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

alter table automation_jobs add column if not exists clinic_id uuid references clinics(id) on delete cascade;
alter table automation_jobs add column if not exists contact_id uuid references contacts(id) on delete cascade;
alter table automation_jobs add column if not exists rule_key text;
alter table automation_jobs add column if not exists job_type text;
alter table automation_jobs add column if not exists template_key text;
alter table automation_jobs add column if not exists status text default 'pending';
alter table automation_jobs add column if not exists scheduled_for timestamp with time zone;
alter table automation_jobs add column if not exists payload jsonb default '{}'::jsonb;
alter table automation_jobs add column if not exists sent_at timestamp with time zone;
alter table automation_jobs add column if not exists cancelled_at timestamp with time zone;
alter table automation_jobs add column if not exists cancel_reason text;
alter table automation_jobs add column if not exists last_error text;
alter table automation_jobs add column if not exists created_at timestamp with time zone default now();
alter table automation_jobs add column if not exists updated_at timestamp with time zone default now();

create table if not exists automation_runner_runs (
  id uuid primary key default uuid_generate_v4(),
  clinic_id uuid references clinics(id) on delete cascade not null,
  trigger_source text check (trigger_source in ('scheduler', 'manual')) not null default 'scheduler',
  requested_by_user_id uuid references auth.users(id),
  status text check (status in ('completed', 'failed')) not null default 'completed',
  jobs_scanned integer not null default 0,
  jobs_sent integer not null default 0,
  jobs_failed integer not null default 0,
  jobs_skipped integer not null default 0,
  started_at timestamp with time zone not null default now(),
  completed_at timestamp with time zone,
  error text,
  created_at timestamp with time zone default now()
);

alter table automation_runner_runs add column if not exists clinic_id uuid references clinics(id) on delete cascade;
alter table automation_runner_runs add column if not exists trigger_source text default 'scheduler';
alter table automation_runner_runs add column if not exists requested_by_user_id uuid references auth.users(id);
alter table automation_runner_runs add column if not exists status text default 'completed';
alter table automation_runner_runs add column if not exists jobs_scanned integer default 0;
alter table automation_runner_runs add column if not exists jobs_sent integer default 0;
alter table automation_runner_runs add column if not exists jobs_failed integer default 0;
alter table automation_runner_runs add column if not exists jobs_skipped integer default 0;
alter table automation_runner_runs add column if not exists started_at timestamp with time zone default now();
alter table automation_runner_runs add column if not exists completed_at timestamp with time zone;
alter table automation_runner_runs add column if not exists error text;
alter table automation_runner_runs add column if not exists created_at timestamp with time zone default now();

create table if not exists contact_memory_runner_runs (
  id uuid primary key default uuid_generate_v4(),
  clinic_id uuid references clinics(id) on delete cascade not null,
  trigger_source text check (trigger_source in ('scheduler', 'manual')) not null default 'scheduler',
  requested_by_user_id uuid references auth.users(id),
  status text check (status in ('completed', 'failed')) not null default 'completed',
  jobs_scanned integer not null default 0,
  jobs_completed integer not null default 0,
  jobs_failed integer not null default 0,
  jobs_skipped integer not null default 0,
  started_at timestamp with time zone not null default now(),
  completed_at timestamp with time zone,
  error text,
  created_at timestamp with time zone default now()
);

alter table contact_memory_runner_runs add column if not exists clinic_id uuid references clinics(id) on delete cascade;
alter table contact_memory_runner_runs add column if not exists trigger_source text default 'scheduler';
alter table contact_memory_runner_runs add column if not exists requested_by_user_id uuid references auth.users(id);
alter table contact_memory_runner_runs add column if not exists status text default 'completed';
alter table contact_memory_runner_runs add column if not exists jobs_scanned integer default 0;
alter table contact_memory_runner_runs add column if not exists jobs_completed integer default 0;
alter table contact_memory_runner_runs add column if not exists jobs_failed integer default 0;
alter table contact_memory_runner_runs add column if not exists jobs_skipped integer default 0;
alter table contact_memory_runner_runs add column if not exists started_at timestamp with time zone default now();
alter table contact_memory_runner_runs add column if not exists completed_at timestamp with time zone;
alter table contact_memory_runner_runs add column if not exists error text;
alter table contact_memory_runner_runs add column if not exists created_at timestamp with time zone default now();

create table if not exists broadcast_campaigns (
  id uuid primary key default uuid_generate_v4(),
  clinic_id uuid references clinics(id) on delete cascade not null,
  name text not null,
  status text check (status in ('scheduled', 'running', 'completed', 'completed_with_errors', 'cancelled', 'halted')) not null default 'scheduled',
  delivery_type text check (delivery_type in ('send_now', 'scheduled')) not null default 'send_now',
  message_template text not null,
  segment_filters jsonb not null default '[]'::jsonb,
  scheduled_for timestamp with time zone not null,
  daily_send_cap integer not null default 100,
  stop_on_invalid_number boolean not null default true,
  total_recipients integer not null default 0,
  pending_count integer not null default 0,
  sent_count integer not null default 0,
  failed_count integer not null default 0,
  skipped_count integer not null default 0,
  cancelled_count integer not null default 0,
  invalid_count integer not null default 0,
  replied_count integer not null default 0,
  created_by_user_id uuid references auth.users(id),
  created_by_name text,
  started_at timestamp with time zone,
  completed_at timestamp with time zone,
  last_error text,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

alter table broadcast_campaigns add column if not exists clinic_id uuid references clinics(id) on delete cascade;
alter table broadcast_campaigns add column if not exists name text;
alter table broadcast_campaigns add column if not exists status text default 'scheduled';
alter table broadcast_campaigns add column if not exists delivery_type text default 'send_now';
alter table broadcast_campaigns add column if not exists message_template text;
alter table broadcast_campaigns add column if not exists segment_filters jsonb default '[]'::jsonb;
alter table broadcast_campaigns add column if not exists scheduled_for timestamp with time zone;
alter table broadcast_campaigns add column if not exists daily_send_cap integer default 100;
alter table broadcast_campaigns add column if not exists stop_on_invalid_number boolean default true;
alter table broadcast_campaigns add column if not exists total_recipients integer default 0;
alter table broadcast_campaigns add column if not exists pending_count integer default 0;
alter table broadcast_campaigns add column if not exists sent_count integer default 0;
alter table broadcast_campaigns add column if not exists failed_count integer default 0;
alter table broadcast_campaigns add column if not exists skipped_count integer default 0;
alter table broadcast_campaigns add column if not exists cancelled_count integer default 0;
alter table broadcast_campaigns add column if not exists invalid_count integer default 0;
alter table broadcast_campaigns add column if not exists replied_count integer default 0;
alter table broadcast_campaigns add column if not exists created_by_user_id uuid references auth.users(id);
alter table broadcast_campaigns add column if not exists created_by_name text;
alter table broadcast_campaigns add column if not exists started_at timestamp with time zone;
alter table broadcast_campaigns add column if not exists completed_at timestamp with time zone;
alter table broadcast_campaigns add column if not exists last_error text;
alter table broadcast_campaigns add column if not exists created_at timestamp with time zone default now();
alter table broadcast_campaigns add column if not exists updated_at timestamp with time zone default now();

create table if not exists broadcast_campaign_jobs (
  id uuid primary key default uuid_generate_v4(),
  clinic_id uuid references clinics(id) on delete cascade not null,
  campaign_id uuid references broadcast_campaigns(id) on delete cascade not null,
  contact_id uuid references contacts(id) on delete cascade not null,
  status text check (status in ('pending', 'processing', 'sent', 'failed', 'skipped', 'cancelled')) not null default 'pending',
  scheduled_for timestamp with time zone not null,
  sent_at timestamp with time zone,
  first_reply_at timestamp with time zone,
  last_reply_at timestamp with time zone,
  reply_count integer not null default 0,
  cancel_reason text,
  failure_code text,
  last_error text,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  unique (campaign_id, contact_id)
);

alter table broadcast_campaign_jobs add column if not exists clinic_id uuid references clinics(id) on delete cascade;
alter table broadcast_campaign_jobs add column if not exists campaign_id uuid references broadcast_campaigns(id) on delete cascade;
alter table broadcast_campaign_jobs add column if not exists contact_id uuid references contacts(id) on delete cascade;
alter table broadcast_campaign_jobs add column if not exists status text default 'pending';
alter table broadcast_campaign_jobs add column if not exists scheduled_for timestamp with time zone;
alter table broadcast_campaign_jobs add column if not exists sent_at timestamp with time zone;
alter table broadcast_campaign_jobs add column if not exists first_reply_at timestamp with time zone;
alter table broadcast_campaign_jobs add column if not exists last_reply_at timestamp with time zone;
alter table broadcast_campaign_jobs add column if not exists reply_count integer default 0;
alter table broadcast_campaign_jobs add column if not exists cancel_reason text;
alter table broadcast_campaign_jobs add column if not exists failure_code text;
alter table broadcast_campaign_jobs add column if not exists last_error text;
alter table broadcast_campaign_jobs add column if not exists created_at timestamp with time zone default now();
alter table broadcast_campaign_jobs add column if not exists updated_at timestamp with time zone default now();

create table if not exists broadcast_campaign_runner_runs (
  id uuid primary key default uuid_generate_v4(),
  clinic_id uuid references clinics(id) on delete cascade not null,
  trigger_source text check (trigger_source in ('scheduler', 'manual')) not null default 'scheduler',
  requested_by_user_id uuid references auth.users(id),
  status text check (status in ('completed', 'failed')) not null default 'completed',
  jobs_scanned integer not null default 0,
  jobs_sent integer not null default 0,
  jobs_failed integer not null default 0,
  jobs_skipped integer not null default 0,
  jobs_cancelled integer not null default 0,
  started_at timestamp with time zone not null default now(),
  completed_at timestamp with time zone,
  error text,
  created_at timestamp with time zone default now()
);

alter table broadcast_campaign_runner_runs add column if not exists clinic_id uuid references clinics(id) on delete cascade;
alter table broadcast_campaign_runner_runs add column if not exists trigger_source text default 'scheduler';
alter table broadcast_campaign_runner_runs add column if not exists requested_by_user_id uuid references auth.users(id);
alter table broadcast_campaign_runner_runs add column if not exists status text default 'completed';
alter table broadcast_campaign_runner_runs add column if not exists jobs_scanned integer default 0;
alter table broadcast_campaign_runner_runs add column if not exists jobs_sent integer default 0;
alter table broadcast_campaign_runner_runs add column if not exists jobs_failed integer default 0;
alter table broadcast_campaign_runner_runs add column if not exists jobs_skipped integer default 0;
alter table broadcast_campaign_runner_runs add column if not exists jobs_cancelled integer default 0;
alter table broadcast_campaign_runner_runs add column if not exists started_at timestamp with time zone default now();
alter table broadcast_campaign_runner_runs add column if not exists completed_at timestamp with time zone;
alter table broadcast_campaign_runner_runs add column if not exists error text;
alter table broadcast_campaign_runner_runs add column if not exists created_at timestamp with time zone default now();

create index if not exists idx_contacts_clinic_status on contacts(clinic_id, current_status);
create index if not exists idx_contacts_phone_clinic on contacts(clinic_id, phone_e164);
create index if not exists idx_contacts_marketing_opt_out on contacts(clinic_id, marketing_opt_out_at)
  where marketing_opt_out_at is not null;
create index if not exists idx_clinics_evolution_instance on clinics(evolution_instance_name)
  where evolution_instance_name is not null;
create index if not exists idx_conversations_contact_created on conversations(contact_id, created_at);
create index if not exists idx_messages_clinic_contact_created on messages(clinic_id, contact_id, created_at);
create index if not exists idx_messages_clinic_conversation_created on messages(clinic_id, conversation_id, created_at);
create index if not exists idx_messages_clinic_provider_message on messages(clinic_id, provider_message_id);
create index if not exists idx_contact_memory_jobs_due on contact_memory_jobs(clinic_id, status, scheduled_for);
create index if not exists idx_contact_memory_jobs_contact_created on contact_memory_jobs(contact_id, created_at desc);
create index if not exists idx_revenue_logs_clinic_contact on revenue_logs(clinic_id, contact_id);
create index if not exists idx_automation_jobs_due on automation_jobs(clinic_id, status, scheduled_for);
create index if not exists idx_automation_jobs_pending_due on automation_jobs(clinic_id, scheduled_for)
  where status = 'pending';
create index if not exists idx_automation_runner_runs_clinic_started on automation_runner_runs(clinic_id, started_at desc);
create index if not exists idx_contact_memory_runner_runs_clinic_started on contact_memory_runner_runs(clinic_id, started_at desc);
create index if not exists idx_broadcast_campaigns_clinic_created on broadcast_campaigns(clinic_id, created_at desc);
create index if not exists idx_broadcast_campaigns_clinic_status on broadcast_campaigns(clinic_id, status, scheduled_for);
create index if not exists idx_broadcast_campaign_jobs_due on broadcast_campaign_jobs(clinic_id, status, scheduled_for);
create index if not exists idx_broadcast_campaign_jobs_pending_due on broadcast_campaign_jobs(clinic_id, scheduled_for)
  where status = 'pending';
create index if not exists idx_broadcast_campaign_jobs_campaign_status on broadcast_campaign_jobs(campaign_id, status, scheduled_for);
create index if not exists idx_broadcast_campaign_jobs_contact_sent on broadcast_campaign_jobs(clinic_id, contact_id, sent_at desc)
  where status = 'sent';
create index if not exists idx_broadcast_campaign_runner_runs_clinic_started on broadcast_campaign_runner_runs(clinic_id, started_at desc);
create index if not exists idx_clinics_subscription_status on clinics(subscription_status, payment_status, whatsapp_status);

grant usage on schema public to authenticated, service_role;
grant all on all tables in schema public to authenticated, service_role;
grant all on all routines in schema public to authenticated, service_role;

alter table clinics enable row level security;
alter table agency_admins enable row level security;
alter table users enable row level security;
alter table contacts enable row level security;
alter table conversations enable row level security;
alter table messages enable row level security;
alter table contact_memory_jobs enable row level security;
alter table revenue_logs enable row level security;
alter table ai_conversation_state enable row level security;
alter table audit_logs enable row level security;
alter table automation_rules enable row level security;
alter table automation_jobs enable row level security;
alter table automation_runner_runs enable row level security;
alter table contact_memory_runner_runs enable row level security;
alter table broadcast_campaigns enable row level security;
alter table broadcast_campaign_jobs enable row level security;
alter table broadcast_campaign_runner_runs enable row level security;

create or replace function current_user_clinic_id()
returns uuid
language sql
security definer
stable
set search_path = public
as $$
  select clinic_id
  from public.users
  where id = auth.uid()
  limit 1;
$$;

create or replace function current_user_active_clinic_id()
returns uuid
language sql
security definer
stable
set search_path = public
as $$
  select clinic_id
  from public.users
  where id = auth.uid()
    and status = 'active'
  limit 1;
$$;

create or replace function current_user_can_manage_clinic(p_clinic_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.users
    where id = auth.uid()
      and clinic_id = p_clinic_id
      and status = 'active'
      and role in ('admin', 'manager')
  );
$$;

grant execute on function current_user_clinic_id() to authenticated;
grant execute on function current_user_active_clinic_id() to authenticated;
grant execute on function current_user_can_manage_clinic(uuid) to authenticated;

drop policy if exists "Users can see own clinic" on clinics;
drop policy if exists clinic_select_own on clinics;
drop policy if exists clinic_update_managed on clinics;
create policy clinic_select_own
on clinics for select
using (id = current_user_clinic_id());

create policy clinic_update_managed
on clinics for update
using (current_user_can_manage_clinic(id))
with check (current_user_can_manage_clinic(id));

drop policy if exists "Users can see staff in same clinic" on users;
drop policy if exists user_select_same_clinic on users;
drop policy if exists user_update_same_clinic on users;
create policy user_select_same_clinic
on users for select
using (
  auth.uid() = id
  or clinic_id = current_user_clinic_id()
);

create policy user_update_same_clinic
on users for update
using (
  auth.uid() = id
  or current_user_can_manage_clinic(clinic_id)
)
with check (
  clinic_id = current_user_clinic_id()
);

drop policy if exists "Users can perform all actions on clinic contacts" on contacts;
drop policy if exists contact_all_same_clinic on contacts;
create policy contact_all_same_clinic
on contacts for all
using (clinic_id = current_user_active_clinic_id())
with check (clinic_id = current_user_active_clinic_id());

drop policy if exists conversation_all_same_clinic on conversations;
create policy conversation_all_same_clinic
on conversations for all
using (clinic_id = current_user_active_clinic_id())
with check (clinic_id = current_user_active_clinic_id());

drop policy if exists "Users can perform all actions on clinic messages" on messages;
drop policy if exists message_all_same_clinic on messages;
create policy message_all_same_clinic
on messages for all
using (clinic_id = current_user_active_clinic_id())
with check (clinic_id = current_user_active_clinic_id());

drop policy if exists contact_memory_jobs_same_clinic on contact_memory_jobs;
create policy contact_memory_jobs_same_clinic
on contact_memory_jobs for all
using (clinic_id = current_user_active_clinic_id())
with check (clinic_id = current_user_active_clinic_id());

drop policy if exists "Users can perform all actions on revenue" on revenue_logs;
drop policy if exists revenue_all_same_clinic on revenue_logs;
create policy revenue_all_same_clinic
on revenue_logs for all
using (clinic_id = current_user_active_clinic_id())
with check (clinic_id = current_user_active_clinic_id());

drop policy if exists "Users can perform all actions on ai states" on ai_conversation_state;
drop policy if exists ai_state_all_same_clinic on ai_conversation_state;
create policy ai_state_all_same_clinic
on ai_conversation_state for all
using (
  contact_id in (
    select id from contacts where clinic_id = current_user_active_clinic_id()
  )
)
with check (
  contact_id in (
    select id from contacts where clinic_id = current_user_active_clinic_id()
  )
);

drop policy if exists "Users can perform all actions on clinic audit logs" on audit_logs;
drop policy if exists audit_all_same_clinic on audit_logs;
create policy audit_all_same_clinic
on audit_logs for all
using (clinic_id = current_user_active_clinic_id())
with check (clinic_id = current_user_active_clinic_id());

drop policy if exists automation_rules_same_clinic on automation_rules;
create policy automation_rules_same_clinic
on automation_rules for all
using (clinic_id = current_user_active_clinic_id())
with check (clinic_id = current_user_active_clinic_id());

drop policy if exists automation_jobs_same_clinic on automation_jobs;
create policy automation_jobs_same_clinic
on automation_jobs for all
using (clinic_id = current_user_active_clinic_id())
with check (clinic_id = current_user_active_clinic_id());

drop policy if exists automation_runner_runs_same_clinic on automation_runner_runs;
create policy automation_runner_runs_same_clinic
on automation_runner_runs for select
using (clinic_id = current_user_active_clinic_id());

drop policy if exists broadcast_campaigns_same_clinic on broadcast_campaigns;
create policy broadcast_campaigns_same_clinic
on broadcast_campaigns for all
using (clinic_id = current_user_active_clinic_id())
with check (clinic_id = current_user_active_clinic_id());

drop policy if exists broadcast_campaign_jobs_same_clinic on broadcast_campaign_jobs;
create policy broadcast_campaign_jobs_same_clinic
on broadcast_campaign_jobs for all
using (clinic_id = current_user_active_clinic_id())
with check (clinic_id = current_user_active_clinic_id());

drop policy if exists broadcast_campaign_runner_runs_same_clinic on broadcast_campaign_runner_runs;
create policy broadcast_campaign_runner_runs_same_clinic
on broadcast_campaign_runner_runs for select
using (clinic_id = current_user_active_clinic_id());

drop policy if exists contact_memory_runner_runs_same_clinic on contact_memory_runner_runs;
create policy contact_memory_runner_runs_same_clinic
on contact_memory_runner_runs for select
using (clinic_id = current_user_active_clinic_id());

drop policy if exists agency_admin_self on agency_admins;
create policy agency_admin_self
on agency_admins for select
using (id = auth.uid());

create or replace function get_average_response_time(p_clinic_id uuid)
returns numeric
language sql
security definer
set search_path = public
as $$
  with inbound_messages as (
    select contact_id, created_at
    from public.messages
    where clinic_id = p_clinic_id
      and direction = 'inbound'
  )
  select coalesce(avg(extract(epoch from (reply.created_at - inbound.created_at)) / 60.0), 0)::numeric
  from inbound_messages inbound
  join lateral (
    select created_at
    from public.messages response
    where response.clinic_id = p_clinic_id
      and response.contact_id = inbound.contact_id
      and response.direction = 'outbound'
      and response.created_at > inbound.created_at
    order by response.created_at asc
    limit 1
  ) reply on true;
$$;

create or replace function get_clinic_dashboard_stats(p_clinic_id uuid)
returns json
language sql
security definer
set search_path = public
as $$
  select json_build_object(
    'total_leads', count(*) filter (where true),
    'new_leads', count(*) filter (where current_status = 'new_lead'),
    'booked', count(*) filter (where current_status = 'booked_appointment'),
    'attended', count(*) filter (where current_status = 'attended_visit'),
    'no_show', count(*) filter (where current_status = 'no_show'),
    'no_respond', count(*) filter (where current_status = 'no_respond'),
    'patient', count(*) filter (where current_status = 'patient'),
    'unread_backlog', coalesce(sum(unread_count), 0),
    'overdue_followups', count(*) filter (
      where next_follow_up_at is not null
        and next_follow_up_at < now()
        and current_status not in ('booked_appointment', 'attended_visit', 'patient', 'trash')
    ),
    'booking_rate', case
      when count(*) > 0 then
        round(
          count(*) filter (where current_status in ('booked_appointment', 'attended_visit', 'patient'))::numeric
          / count(*)::numeric * 100,
          1
        )
      else 0
    end,
    'attendance_rate', case
      when count(*) filter (where current_status in ('booked_appointment', 'attended_visit', 'no_show', 'patient')) > 0 then
        round(
          count(*) filter (where current_status in ('attended_visit', 'patient'))::numeric
          / count(*) filter (where current_status in ('booked_appointment', 'attended_visit', 'no_show', 'patient'))::numeric * 100,
          1
        )
      else 0
    end
  )
  from public.contacts
  where clinic_id = p_clinic_id
    and current_status != 'trash';
$$;

create or replace function get_treatment_breakdown(p_clinic_id uuid)
returns table(treatment text, count bigint)
language sql
security definer
set search_path = public
as $$
  select
    coalesce(nullif(btrim(treatment_interest), ''), 'Unknown') as treatment,
    count(*) as count
  from public.contacts
  where clinic_id = p_clinic_id
    and current_status != 'trash'
  group by coalesce(nullif(btrim(treatment_interest), ''), 'Unknown')
  order by count desc, treatment asc;
$$;

grant execute on function get_clinic_dashboard_stats(uuid) to authenticated;
grant execute on function get_treatment_breakdown(uuid) to authenticated;

create or replace function bootstrap_current_user_membership(
  p_full_name text default null,
  p_clinic_name text default null,
  p_clinic_type text default null,
  p_plan_type text default null
)
returns public.users
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_email text;
  v_full_name text := nullif(btrim(p_full_name), '');
  v_clinic_name text := nullif(btrim(p_clinic_name), '');
  v_clinic_type text := nullif(btrim(p_clinic_type), '');
  v_plan_type text := nullif(btrim(p_plan_type), '');
  v_clinic_id uuid;
  v_membership public.users%rowtype;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  perform pg_advisory_xact_lock(hashtext(v_user_id::text));

  select *
  into v_membership
  from public.users
  where id = v_user_id;

  if found then
    return v_membership;
  end if;

  select
    u.email,
    coalesce(
      v_full_name,
      nullif(btrim(u.raw_user_meta_data ->> 'full_name'), ''),
      nullif(btrim(u.raw_user_meta_data ->> 'name'), ''),
      nullif(split_part(u.email, '@', 1), '')
    ),
    coalesce(
      v_clinic_name,
      nullif(btrim(u.raw_user_meta_data ->> 'clinic_name'), '')
    ),
    coalesce(
      v_clinic_type,
      nullif(btrim(u.raw_user_meta_data ->> 'clinic_type'), '')
    ),
    coalesce(
      v_plan_type,
      nullif(btrim(u.raw_user_meta_data ->> 'plan_type'), '')
    )
  into v_email, v_full_name, v_clinic_name, v_clinic_type, v_plan_type
  from auth.users u
  where u.id = v_user_id;

  if v_email is null then
    raise exception 'Authenticated user email not found';
  end if;

  if v_full_name is null then
    raise exception 'Full name is required';
  end if;

  if v_clinic_name is null then
    raise exception 'Clinic name is required';
  end if;

  if v_clinic_type is null then
    raise exception 'Clinic type is required';
  end if;

  if v_plan_type is null then
    raise exception 'Plan type is required';
  end if;

  if v_clinic_type not in ('dental', 'aesthetic', 'gp', 'functional_medicine', 'physio') then
    raise exception 'Clinic type is invalid';
  end if;

  if v_plan_type not in ('starter', 'pro') then
    raise exception 'Plan type is invalid';
  end if;

  insert into public.clinics (
    name,
    clinic_type,
    plan_type,
    subscription_status,
    payment_status,
    whatsapp_status,
    owner_name
  )
  values (
    v_clinic_name,
    v_clinic_type,
    v_plan_type,
    'active',
    'pending',
    'not_connected',
    v_full_name
  )
  returning id into v_clinic_id;

  insert into public.users (
    id,
    clinic_id,
    role,
    full_name,
    email,
    status,
    last_seen_at
  )
  values (
    v_user_id,
    v_clinic_id,
    'admin',
    v_full_name,
    v_email,
    'active',
    now()
  )
  returning * into v_membership;

  return v_membership;
end;
$$;

create or replace function activate_current_membership()
returns public.users
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_membership public.users%rowtype;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  update public.users
  set
    status = case when status = 'invited' then 'active' else status end,
    disabled_at = case when status = 'invited' then null else disabled_at end,
    last_seen_at = now()
  where id = v_user_id
    and status in ('active', 'invited')
  returning * into v_membership;

  return v_membership;
end;
$$;

grant execute on function bootstrap_current_user_membership(text, text, text, text) to authenticated;
grant execute on function activate_current_membership() to authenticated;
