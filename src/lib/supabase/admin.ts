import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type SupabaseAdminClient = SupabaseClient;

export function getSupabaseAdminConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    return null;
  }

  return { url, serviceRoleKey };
}

export function createAdminClient(): SupabaseAdminClient | null {
  const config = getSupabaseAdminConfig();

  if (!config) {
    return null;
  }

  return createClient(config.url, config.serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

export function hasAdminClientConfig() {
  return getSupabaseAdminConfig() !== null;
}
