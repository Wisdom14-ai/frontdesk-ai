import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { getAppBaseUrl, normalizeLocalPath } from "@/lib/server/app-url";

/**
 * Map a Supabase auth error to a human-readable message for the login page.
 * Supabase invite/recovery verification returns the token in `token_hash`
 * (see the email templates in Auth → Email Templates), which a server route
 * can verify directly — unlike the PKCE `?code=` flow handled by
 * `/auth/callback`.
 */
function friendlyVerifyError(code?: string | null) {
  if (code === "otp_expired" || code === "otp_disabled") {
    return "This invite link has expired — ask your admin to send a new one.";
  }
  return "We couldn't verify that link. Please ask your admin to send you a new invite.";
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = normalizeLocalPath(searchParams.get("next"));
  const appBaseUrl = getAppBaseUrl();

  if (token_hash && type) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash });
    if (!error) {
      // Session cookies are set on the response; land the user on `next`
      // (the set-password page for invites/recovery).
      return NextResponse.redirect(new URL(next, appBaseUrl));
    }

    return NextResponse.redirect(
      new URL(
        "/login?error=" + encodeURIComponent(friendlyVerifyError(error.code)),
        appBaseUrl
      )
    );
  }

  return NextResponse.redirect(
    new URL(
      "/login?error=" + encodeURIComponent(friendlyVerifyError()),
      appBaseUrl
    )
  );
}
