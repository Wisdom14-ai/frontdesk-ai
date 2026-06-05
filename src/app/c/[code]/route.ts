import { NextResponse } from "next/server";

import { recordCampaignLinkClick } from "@/lib/server/campaigns";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Campaign link redirect handler.
 *
 * Short URLs embedded in broadcast messages look like:
 *   https://app.frontdesk-ai.cloud/c/abc123?cid=<contactId>&jid=<jobId>
 *
 * The handler:
 *  1. Looks up the short code in campaign_links.
 *  2. Records a click (increments counters, inserts click row).
 *  3. Redirects the recipient to the original target URL.
 *
 * Query params (all optional — used to attribute the click to the right
 * campaign job when the message sender embeds them):
 *  - cid  contact_id
 *  - jid  broadcast_campaign_job_id
 */
export async function GET(
  req: Request,
  context: { params: Promise<{ code: string }> }
) {
  const { code } = await context.params;
  const url = new URL(req.url);
  const contactId = url.searchParams.get("cid");
  const jobId = url.searchParams.get("jid");
  const userAgent = req.headers.get("user-agent");
  const referrer = req.headers.get("referer");

  const admin = createAdminClient();

  // Fallback: if admin client is not configured, just redirect to homepage.
  if (!admin) {
    return NextResponse.redirect(
      new URL("/", url.origin),
      { status: 302 }
    );
  }

  const { data: linkRow, error } = await admin
    .from("campaign_links")
    .select("id, campaign_id, clinic_id, target_url")
    .eq("short_code", code)
    .maybeSingle();

  if (error || !linkRow) {
    // Unknown short code — redirect to app root rather than showing a 404.
    return NextResponse.redirect(new URL("/", url.origin), { status: 302 });
  }

  const link = linkRow as {
    id: string;
    campaign_id: string;
    clinic_id: string;
    target_url: string;
  };

  // Fire-and-forget click recording — don't let analytics errors block the
  // redirect.
  void recordCampaignLinkClick(admin, {
    linkId: link.id,
    campaignId: link.campaign_id,
    clinicId: link.clinic_id,
    contactId: contactId ?? null,
    jobId: jobId ?? null,
    userAgent: userAgent ?? null,
    referrer: referrer ?? null,
  }).catch((err: unknown) => {
    console.warn("[campaign-link] Failed to record click", {
      code,
      message: err instanceof Error ? err.message : String(err),
    });
  });

  // Validate that the target URL uses a safe scheme before redirecting.
  // Reject javascript:, data:, and other non-HTTP(S) protocols to prevent
  // open redirect abuse and phishing via crafted campaign links.
  let safeTargetUrl: string;
  try {
    const parsed = new URL(link.target_url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return NextResponse.redirect(new URL("/", url.origin), { status: 302 });
    }
    safeTargetUrl = parsed.toString();
  } catch {
    return NextResponse.redirect(new URL("/", url.origin), { status: 302 });
  }

  return NextResponse.redirect(safeTargetUrl, { status: 302 });
}
