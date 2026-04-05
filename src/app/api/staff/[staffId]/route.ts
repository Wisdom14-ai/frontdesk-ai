import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  canManageStaff,
  normalizeStaffRole,
  normalizeStaffStatus,
  requireMembership,
} from "@/lib/server/auth";
import type { StaffRole } from "@/types";

const MANAGEABLE_ROLES: StaffRole[] = ["admin", "manager", "receptionist"];

export async function PATCH(
  req: Request,
  context: { params: Promise<{ staffId: string }> }
) {
  const { supabase, membership } = await requireMembership();

  if (!canManageStaff(membership.role)) {
    return NextResponse.json({ error: "Only managers and admins can manage staff." }, { status: 403 });
  }

  const { staffId } = await context.params;
  const body = (await req.json()) as {
    action: "update_role" | "disable" | "activate" | "resend_invite";
    role?: StaffRole;
  };

  const { data: target, error: targetError } = await supabase
    .from("users")
    .select("*")
    .eq("id", staffId)
    .eq("clinic_id", membership.clinic_id)
    .single();

  if (targetError || !target) {
    return NextResponse.json({ error: "Staff member not found." }, { status: 404 });
  }

  if (target.id === membership.id && body.action === "disable") {
    return NextResponse.json({ error: "You cannot disable your own access." }, { status: 400 });
  }

  const targetRole = normalizeStaffRole((target as Record<string, unknown>).role);
  const targetStatus = normalizeStaffStatus(target as Record<string, unknown>);
  const usesLegacyIsActive = Object.prototype.hasOwnProperty.call(target, "is_active");
  const usesStatusColumn = Object.prototype.hasOwnProperty.call(target, "status");

  if (membership.role !== "admin" && (targetRole === "admin" || body.role === "admin")) {
    return NextResponse.json({ error: "Only admins can manage admin roles." }, { status: 403 });
  }

  const writer = createAdminClient() ?? supabase;

  if (body.action === "update_role") {
    if (!body.role || !MANAGEABLE_ROLES.includes(body.role)) {
      return NextResponse.json({ error: "A valid role is required." }, { status: 400 });
    }

    const { error } = await writer
      .from("users")
      .update({
        role: body.role,
      })
      .eq("id", staffId)
      .eq("clinic_id", membership.clinic_id);

    if (error) {
      return NextResponse.json({ error: "Failed to update the staff role." }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  }

  if (body.action === "disable" || body.action === "activate") {
    const nextIsActive = body.action === "activate";
    const nextStatus = body.action === "disable" ? "disabled" : "active";
    const disabledAt = body.action === "disable" ? new Date().toISOString() : null;

    if (!usesLegacyIsActive && !usesStatusColumn) {
      return NextResponse.json(
        { error: "This database schema does not support staff activation changes yet." },
        { status: 503 }
      );
    }

    const updates: Record<string, unknown> = usesLegacyIsActive
      ? {
          is_active: nextIsActive,
        }
      : {
          status: nextStatus,
          disabled_at: disabledAt,
        };

    if (usesLegacyIsActive && targetStatus === "disabled" && nextIsActive) {
      updates.updated_at = new Date().toISOString();
    }

    const { error } = await writer
      .from("users")
      .update(updates)
      .eq("id", staffId)
      .eq("clinic_id", membership.clinic_id);

    if (error) {
      return NextResponse.json({ error: "Failed to update the staff status." }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  }

  if (body.action === "resend_invite") {
    const admin = createAdminClient();
    if (!admin) {
      return NextResponse.json({ error: "Supabase service role is not configured." }, { status: 503 });
    }

    const { error } = await admin.auth.admin.inviteUserByEmail(target.email as string);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    await admin
      .from("users")
      .update({
        status: "invited",
        invited_at: new Date().toISOString(),
      })
      .eq("id", staffId);

    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: "Unsupported staff action." }, { status: 400 });
}
