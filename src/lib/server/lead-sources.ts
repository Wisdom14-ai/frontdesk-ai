import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

export interface LeadSource {
  id: string;
  clinic_id: string;
  label: string;
  match_phrase: string;
  created_at?: string | null;
}

function normalize(value: string) {
  return value.trim().toLowerCase();
}

/**
 * Attribute a brand-new contact's first message to a marketing channel by
 * matching it against the clinic's configured wasap.my pre-filled phrases
 * (e.g. Google Ads, GMB, Referral). Only called when a contact is first
 * created — the phrase only appears in the opening message. Best-effort:
 * any failure (including the table not existing yet) just skips attribution
 * rather than blocking the webhook.
 */
export async function matchLeadSource(
  admin: SupabaseClient,
  clinicId: string,
  message: string
): Promise<string | null> {
  try {
    const { data, error } = await admin
      .from("lead_sources")
      .select("label, match_phrase")
      .eq("clinic_id", clinicId);

    if (error || !data || data.length === 0) {
      return null;
    }

    const normalizedMessage = normalize(message);
    for (const row of data as Array<{ label: string; match_phrase: string }>) {
      const phrase = normalize(row.match_phrase);
      if (phrase && normalizedMessage.includes(phrase)) {
        return row.label;
      }
    }

    return null;
  } catch {
    return null;
  }
}
