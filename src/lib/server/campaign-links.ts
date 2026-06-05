import "server-only";

import { randomInt } from "crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

const URL_REGEX = /https?:\/\/[^\s<>"']+/g;
const SHORT_CODE_CHARS = "abcdefghijkmnpqrstuvwxyz23456789";
const SHORT_CODE_LENGTH = 7;

/**
 * Generate a random alphanumeric short code.
 * Uses an unambiguous character set (no 0/O/1/l confusion).
 */
function generateShortCode(): string {
  let code = "";
  for (let i = 0; i < SHORT_CODE_LENGTH; i++) {
    code += SHORT_CODE_CHARS[randomInt(SHORT_CODE_CHARS.length)];
  }
  return code;
}

/**
 * Generate a unique short code that doesn't already exist in the DB.
 * Tries up to 10 times before throwing.
 */
async function generateUniqueShortCode(client: SupabaseClient): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = generateShortCode();
    const { data } = await client
      .from("campaign_links")
      .select("id")
      .eq("short_code", code)
      .maybeSingle();

    if (!data) {
      return code;
    }
  }
  throw new Error("Could not generate a unique campaign link short code after 10 attempts.");
}

/**
 * Given a campaign message template, find all URLs and replace them with
 * tracked short URLs. Creates `campaign_links` rows for each unique URL.
 *
 * Returns:
 *  - rewrittenMessage: message text with original URLs replaced by short URLs
 *  - linkIds: array of created campaign_link IDs (for reference if needed)
 *
 * The short URL format is:
 *   https://<appDomain>/c/<shortCode>?cid=<contactId>&jid=<jobId>
 * where cid/jid are injected at send-time by the caller, not here.
 *
 * If the `campaign_links` table doesn't exist yet (schema not migrated),
 * the original message is returned unchanged.
 */
export async function rewriteCampaignLinks(
  client: SupabaseClient,
  input: {
    message: string;
    campaignId: string;
    clinicId: string;
    appBaseUrl: string;
  }
): Promise<{ rewrittenMessage: string; linkMap: Map<string, string> }> {
  const urls = [...new Set(input.message.match(URL_REGEX) ?? [])];

  // Filter out any URLs that are already pointing to our own domain or are
  // clearly internal (no point shortening those).
  const externalUrls = urls.filter((url) => {
    try {
      const parsed = new URL(url);
      const appHost = new URL(input.appBaseUrl).hostname;
      return parsed.hostname !== appHost;
    } catch {
      return false;
    }
  });

  if (externalUrls.length === 0) {
    return { rewrittenMessage: input.message, linkMap: new Map() };
  }

  // linkMap: originalUrl → shortUrl
  const linkMap = new Map<string, string>();

  for (const targetUrl of externalUrls) {
    // Check if we already created a link for this URL + campaign
    const { data: existing } = await client
      .from("campaign_links")
      .select("id, short_code")
      .eq("campaign_id", input.campaignId)
      .eq("clinic_id", input.clinicId)
      .eq("target_url", targetUrl)
      .maybeSingle();

    let shortCode: string;

    if (existing) {
      shortCode = (existing as Record<string, unknown>).short_code as string;
    } else {
      try {
        shortCode = await generateUniqueShortCode(client);
      } catch {
        // Can't generate short code — skip this URL
        continue;
      }

      const { error: insertError } = await client.from("campaign_links").insert({
        clinic_id: input.clinicId,
        campaign_id: input.campaignId,
        short_code: shortCode,
        target_url: targetUrl,
        total_clicks: 0,
        unique_clicks: 0,
      });

      if (insertError) {
        // Schema not migrated or insert failed — skip silently
        if (
          insertError.code === "42P01" ||
          insertError.code === "42703" ||
          insertError.code === "PGRST204" ||
          insertError.code === "PGRST205"
        ) {
          return { rewrittenMessage: input.message, linkMap: new Map() };
        }
        continue;
      }
    }

    // Short URL base — cid/jid query params added at send-time
    const shortUrl = `${input.appBaseUrl}/c/${shortCode}`;
    linkMap.set(targetUrl, shortUrl);
  }

  if (linkMap.size === 0) {
    return { rewrittenMessage: input.message, linkMap };
  }

  // Replace all occurrences of each original URL in the message
  let rewrittenMessage = input.message;
  for (const [originalUrl, shortUrl] of linkMap) {
    rewrittenMessage = rewrittenMessage.split(originalUrl).join(shortUrl);
  }

  return { rewrittenMessage, linkMap };
}

/**
 * Given a short URL produced by rewriteCampaignLinks, append the contact and
 * job ID query parameters so clicks can be attributed to a specific recipient.
 *
 * Call this at send-time, not at message-creation time, so the short URL base
 * is shared across all recipients while attribution is personalised.
 */
export function appendCampaignLinkParams(
  shortUrl: string,
  input: { contactId: string; jobId: string }
): string {
  const url = new URL(shortUrl);
  url.searchParams.set("cid", input.contactId);
  url.searchParams.set("jid", input.jobId);
  return url.toString();
}
