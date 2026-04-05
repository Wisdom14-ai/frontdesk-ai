import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { canManageStaff, requireMembership } from "@/lib/server/auth";
import type { StaffRole } from "@/types";

export async function POST(req: Request) {
  try {
    const { supabase, membership } = await requireMembership();
    if (!canManageStaff(membership.role)) {
      return NextResponse.json({ error: "Only admins or managers can invite staff." }, { status: 403 });
    }

    const { email, full_name, role } = (await req.json()) as {
      email?: string;
      full_name?: string;
      role?: StaffRole;
    };

    if (!email?.trim() || !full_name?.trim() || !role) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    if (membership.role !== "admin" && role === "admin") {
      return NextResponse.json({ error: "Only admins can invite another admin." }, { status: 403 });
    }

    const { data: existingUser } = await supabase
      .from("users")
      .select("id")
      .eq("clinic_id", membership.clinic_id)
      .eq("email", email.trim())
      .maybeSingle();

    if (existingUser) {
      return NextResponse.json({ error: "That email is already on the team." }, { status: 409 });
    }

    const supabaseAdmin = createAdminClient();
    if (!supabaseAdmin) {
      return NextResponse.json({ error: "Supabase service role is not configured." }, { status: 503 });
    }

    const { data: inviteData, error: inviteError } = await supabaseAdmin.auth.admin.inviteUserByEmail(
      email.trim()
    );

    if (inviteError) {
      return NextResponse.json({ error: inviteError.message }, { status: 500 });
    }

    const newUserId = inviteData.user.id;

    const { error: profileError } = await supabaseAdmin
      .from("users")
      .insert({
        id: newUserId,
        email: email.trim(),
        full_name: full_name.trim(),
        role,
        clinic_id: membership.clinic_id,
        status: "invited",
        invited_at: new Date().toISOString(),
      });

    if (profileError) {
      return NextResponse.json({ error: profileError.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, user_id: newUserId });
  } catch {
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
