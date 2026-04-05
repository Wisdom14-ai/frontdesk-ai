import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { requireMembership } from "@/lib/server/auth";

export async function POST(req: Request) {
  const { supabase, membership, user } = await requireMembership();
  const { action, resourceType, resourceId, details } = (await req.json()) as {
    action?: string;
    resourceType?: string;
    resourceId?: string;
    details?: Record<string, unknown>;
  };

  if (!action || !resourceType || !resourceId) {
    return NextResponse.json({ error: "Missing audit event fields." }, { status: 400 });
  }

  const writer = createAdminClient() ?? supabase;
  const { error } = await writer.from("audit_logs").insert({
    clinic_id: membership.clinic_id,
    user_id: user.id,
    action,
    resource_type: resourceType,
    resource_id: resourceId,
    details: details ?? null,
  });

  if (error) {
    return NextResponse.json({ error: "Failed to log the audit event." }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
