-- Fix: "Database error saving new user" on signup (supabase.auth.signUp).
--
-- Root cause: an orphaned trigger on auth.users (typically named
-- on_auth_user_created -> public.handle_new_user()) left over from an early
-- Supabase quickstart scaffold. It tries to INSERT a row into public.users,
-- but this app's public.users requires clinic_id (NOT NULL FK) and full_name
-- (NOT NULL). The trigger's insert violates those constraints, so the whole
-- auth.users insert transaction aborts and GoTrue returns the generic
-- "Database error saving new user".
--
-- This app does NOT need any auth.users trigger: membership rows are created
-- in app code after login via the SECURITY DEFINER RPC
-- bootstrap_current_user_membership(). So dropping the vestigial trigger is
-- the correct fix and is safe.
--
-- Run this in the Supabase SQL editor for the PRODUCTION project.

-- ============================================================
-- STEP 1 — DIAGNOSE. Run this first and read the output.
-- Expect to see a trigger (often on_auth_user_created / handle_new_user).
-- ============================================================
select
  t.tgname                              as trigger_name,
  p.proname                             as function_name,
  pg_get_triggerdef(t.oid)              as definition
from pg_trigger t
join pg_class c     on c.oid = t.tgrelid
join pg_namespace n on n.oid = c.relnamespace
join pg_proc p      on p.oid = t.tgfoid
where n.nspname = 'auth'
  and c.relname = 'users'
  and not t.tgisinternal;

-- ============================================================
-- STEP 2 — FIX. Drops the known-common vestigial triggers on auth.users.
-- If STEP 1 revealed a DIFFERENT trigger name, add a matching line for it.
-- Safe to run multiple times.
-- ============================================================
drop trigger if exists on_auth_user_created on auth.users;
drop trigger if exists on_auth_user_created_bootstrap on auth.users;
drop trigger if exists handle_new_user on auth.users;

-- Remove the now-unused function (harmless if it was never there).
drop function if exists public.handle_new_user() cascade;

-- ============================================================
-- STEP 3 — VERIFY. Re-run STEP 1; it should now return zero rows.
-- Then try signing up a brand-new email in the app.
-- ============================================================
