import { NextResponse } from "next/server";

import { getAgencyAdminState } from "@/lib/server/auth";
import {
  generateInviteActionLink,
  inviteRedirectUrl,
  isDuplicateEmailError,
} from "@/lib/server/invite-link";
import { createAdminClient } from "@/lib/supabase/admin";

async function authorize() {
  const auth = await getAgencyAdminState();
  if (!auth.isAgencyAdmin) {
    return { error: NextResponse.json({ error: "Agency admin access required." }, { status: 403 }) };
  }
  const admin = createAdminClient();
  if (!admin) {
    return {
      error: NextResponse.json(
        { error: "Supabase service role is not configured." },
        { status: 503 }
      ),
    };
  }
  return { admin };
}

export async function PATCH(
  req: Request,
  context: { params: Promise<{ clinicId: string; staffId: string }> }
) {
  const { admin, error } = await authorize();
  if (error) return error;

  const { clinicId, staffId } = await context.params;
  const body = (await req.json()) as {
    action: "resend_invite" | "disable" | "activate";
  };

  const { data: target, error: targetError } = await admin
    .from("users")
    .select("id, email, status")
    .eq("id", staffId)
    .eq("clinic_id", clinicId)
    .maybeSingle();

  if (targetError || !target) {
    return NextResponse.json({ error: "Staff member not found." }, { status: 404 });
  }

  if (body.action === "disable" || body.action === "activate") {
    const nextStatus = body.action === "disable" ? "disabled" : "active";
    const { error: updateError } = await admin
      .from("users")
      .update({
        status: nextStatus,
        disabled_at: body.action === "disable" ? new Date().toISOString() : null,
      })
      .eq("id", staffId)
      .eq("clinic_id", clinicId);

    if (updateError) {
      return NextResponse.json({ error: "Failed to update the staff status." }, { status: 500 });
    }
    return NextResponse.json({ success: true });
  }

  if (body.action === "resend_invite") {
    const email = target.email as string;
    const { error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo: inviteRedirectUrl(),
    });
    // The auth user already exists for a re-invite, so a duplicate-email error is
    // expected — the copyable link below is the reliable delivery path.
    if (inviteError && !isDuplicateEmailError(inviteError)) {
      return NextResponse.json({ error: inviteError.message }, { status: 500 });
    }

    await admin
      .from("users")
      .update({ status: "invited", invited_at: new Date().toISOString() })
      .eq("id", staffId)
      .eq("clinic_id", clinicId);

    const inviteLink = await generateInviteActionLink(admin, email);
    return NextResponse.json({ success: true, invite_link: inviteLink });
  }

  return NextResponse.json({ error: "Unsupported staff action." }, { status: 400 });
}

export async function DELETE(
  _req: Request,
  context: { params: Promise<{ clinicId: string; staffId: string }> }
) {
  const { admin, error } = await authorize();
  if (error) return error;

  const { clinicId, staffId } = await context.params;

  const { data: target, error: targetError } = await admin
    .from("users")
    .select("id")
    .eq("id", staffId)
    .eq("clinic_id", clinicId)
    .maybeSingle();

  if (targetError || !target) {
    return NextResponse.json({ error: "Staff member not found." }, { status: 404 });
  }

  const { error: deleteError } = await admin
    .from("users")
    .delete()
    .eq("id", staffId)
    .eq("clinic_id", clinicId);

  if (deleteError) {
    return NextResponse.json({ error: "Failed to remove the staff member." }, { status: 500 });
  }

  // Only remove the auth.users record when the invitee never signed in — a
  // member who has logged in may hold other data/sessions; leave their auth
  // account alone and just detach them from this clinic.
  let authDeleted = false;
  try {
    const { data: authUser } = await admin.auth.admin.getUserById(staffId);
    if (authUser?.user && !authUser.user.last_sign_in_at) {
      const { error: authDeleteError } = await admin.auth.admin.deleteUser(staffId);
      authDeleted = !authDeleteError;
    }
  } catch {
    // Best-effort: the profile row is already gone, which is what removes access.
  }

  return NextResponse.json({ success: true, auth_deleted: authDeleted });
}
