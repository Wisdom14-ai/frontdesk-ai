import "server-only";

import type { SupabaseAdminClient } from "@/lib/supabase/admin";
import { getAppBaseUrl } from "@/lib/server/app-url";

export const SET_PASSWORD_PATH = "/welcome/set-password";

export const DUPLICATE_EMAIL_MESSAGE =
  "This email already has a Frontdesk account (each clinic needs its own email). Use a different email address.";

/** Where invite/recovery links land the user to choose a password. */
export function inviteRedirectUrl() {
  return new URL(SET_PASSWORD_PATH, getAppBaseUrl()).toString();
}

/**
 * Mint a copyable invite link the admin can hand over on WhatsApp when the
 * best-effort Supabase invite email doesn't arrive.
 *
 * Uses a magic-link token so it does NOT rotate the invite-email token (they
 * are independent token types), which keeps both the emailed link and this
 * copied link valid at once. We route the link through our own `/auth/confirm`
 * (token-hash verification) rather than returning Supabase's raw implicit-flow
 * `action_link`, so the copied link sets the session server-side exactly like
 * the emailed link — deterministic and free of hash-fragment fragility.
 *
 * Returns null if the service role can't mint a link — the email invite still
 * went out, so the caller should not treat this as a hard failure.
 */
export async function generateInviteActionLink(
  admin: SupabaseAdminClient,
  email: string
): Promise<string | null> {
  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
    options: { redirectTo: inviteRedirectUrl() },
  });

  const properties = data?.properties;
  if (error || !properties) {
    return null;
  }

  if (properties.hashed_token) {
    const url = new URL("/auth/confirm", getAppBaseUrl());
    url.searchParams.set("token_hash", properties.hashed_token);
    url.searchParams.set("type", properties.verification_type);
    url.searchParams.set("next", SET_PASSWORD_PATH);
    return url.toString();
  }

  return properties.action_link ?? null;
}

const DUPLICATE_CODES = new Set(["email_exists", "user_already_exists"]);

/** True when an auth error means the email is already registered in auth.users. */
export function isDuplicateEmailError(
  error: { code?: string | undefined; message?: string } | null | undefined
) {
  if (!error) return false;
  if (error.code && DUPLICATE_CODES.has(error.code)) return true;

  const message = error.message?.toLowerCase() ?? "";
  return (
    message.includes("already been registered") ||
    message.includes("already registered") ||
    message.includes("already exists")
  );
}
