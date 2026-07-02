import { NextResponse } from "next/server";

import { getAgencyAdminState, normalizeStaffRole, normalizeStaffStatus } from "@/lib/server/auth";
import {
  DUPLICATE_EMAIL_MESSAGE,
  generateInviteActionLink,
  inviteRedirectUrl,
  isDuplicateEmailError,
} from "@/lib/server/invite-link";
import { createAdminClient } from "@/lib/supabase/admin";
import type { StaffRole } from "@/types";

const ROLES: StaffRole[] = ["admin", "manager", "receptionist"];

export async function GET(
  _req: Request,
  context: { params: Promise<{ clinicId: string }> }
) {
  const auth = await getAgencyAdminState();
  if (!auth.isAgencyAdmin) {
    return NextResponse.json({ error: "Agency admin access required." }, { status: 403 });
  }

  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Supabase service role is not configured." }, { status: 503 });
  }

  const { clinicId } = await context.params;

  const { data, error } = await admin
    .from("users")
    .select("*")
    .eq("clinic_id", clinicId)
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: "Failed to load staff." }, { status: 500 });
  }

  return NextResponse.json({
    staff: (data ?? []).map((member) => {
      const row = member as Record<string, unknown>;
      return {
        id: row.id as string,
        clinic_id: row.clinic_id as string,
        full_name: (row.full_name as string) ?? "",
        email: (row.email as string) ?? "",
        role: normalizeStaffRole(row.role),
        status: normalizeStaffStatus(row),
        invited_at: (row.invited_at as string | null | undefined) ?? null,
        disabled_at: (row.disabled_at as string | null | undefined) ?? null,
        created_at: row.created_at as string,
      };
    }),
  });
}

export async function POST(
  req: Request,
  context: { params: Promise<{ clinicId: string }> }
) {
  const auth = await getAgencyAdminState();
  if (!auth.isAgencyAdmin) {
    return NextResponse.json({ error: "Agency admin access required." }, { status: 403 });
  }

  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Supabase service role is not configured." }, { status: 503 });
  }

  const { clinicId } = await context.params;
  const { email, full_name, role } = (await req.json()) as {
    email?: string;
    full_name?: string;
    role?: StaffRole;
  };

  if (!email?.trim() || !full_name?.trim() || !role || !ROLES.includes(role)) {
    return NextResponse.json({ error: "Missing or invalid fields." }, { status: 400 });
  }

  // A person may legitimately staff multiple clinics with different emails, but
  // the same email cannot appear twice on the SAME clinic.
  const { data: existing } = await admin
    .from("users")
    .select("id")
    .eq("clinic_id", clinicId)
    .eq("email", email.trim())
    .maybeSingle();

  if (existing) {
    return NextResponse.json({ error: "That email is already on this clinic's team." }, { status: 409 });
  }

  const { data: inviteData, error: inviteError } = await admin.auth.admin.inviteUserByEmail(
    email.trim(),
    { redirectTo: inviteRedirectUrl() }
  );

  if (inviteError || !inviteData?.user) {
    if (isDuplicateEmailError(inviteError)) {
      return NextResponse.json({ error: DUPLICATE_EMAIL_MESSAGE }, { status: 409 });
    }
    return NextResponse.json(
      { error: inviteError?.message ?? "Failed to create the invite." },
      { status: 500 }
    );
  }

  const { error: profileError } = await admin.from("users").insert({
    id: inviteData.user.id,
    email: email.trim(),
    full_name: full_name.trim(),
    role,
    clinic_id: clinicId,
    status: "invited",
    invited_at: new Date().toISOString(),
  });

  if (profileError) {
    return NextResponse.json({ error: profileError.message }, { status: 500 });
  }

  const inviteLink = await generateInviteActionLink(admin, email.trim());

  return NextResponse.json({ success: true, user_id: inviteData.user.id, invite_link: inviteLink });
}
