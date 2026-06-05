import { NextResponse } from "next/server";

import {
  approveAutomationDraft,
  listAutomationApprovalDrafts,
  rejectAutomationDraft,
} from "@/lib/server/automation";
import { canManageStaff, requireMembership } from "@/lib/server/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET() {
  const { supabase, membership } = await requireMembership();

  try {
    const approvals = await listAutomationApprovalDrafts(
      supabase,
      membership.clinic_id
    );
    return NextResponse.json({ approvals });
  } catch {
    return NextResponse.json(
      { error: "Failed to load approval drafts." },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  const { supabase, membership } = await requireMembership();

  if (!canManageStaff(membership.role)) {
    return NextResponse.json(
      { error: "You do not have permission to approve automations." },
      { status: 403 }
    );
  }

  const body = (await req.json()) as {
    jobId?: string;
    action?: "approve" | "reject";
  };

  if (!body.jobId || (body.action !== "approve" && body.action !== "reject")) {
    return NextResponse.json(
      { error: "A jobId and valid action are required." },
      { status: 400 }
    );
  }

  try {
    if (body.action === "reject") {
      const result = await rejectAutomationDraft({
        client: supabase,
        clinicId: membership.clinic_id,
        jobId: body.jobId,
      });
      return NextResponse.json(result);
    }

    const admin = createAdminClient();
    if (!admin) {
      return NextResponse.json(
        { error: "SUPABASE_SERVICE_ROLE_KEY is required to approve drafts." },
        { status: 503 }
      );
    }

    const result = await approveAutomationDraft({
      admin,
      clinicId: membership.clinic_id,
      jobId: body.jobId,
    });

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json(result);
  } catch {
    return NextResponse.json(
      { error: "Failed to update approval draft." },
      { status: 500 }
    );
  }
}
