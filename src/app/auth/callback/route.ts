import { createClient } from "@/lib/supabase/server";
import { getAppBaseUrl, normalizeLocalPath } from "@/lib/server/app-url";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const next = normalizeLocalPath(searchParams.get("next"));
  const appBaseUrl = getAppBaseUrl();

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(new URL(next, appBaseUrl));
    }
  }

  // Return the user to an error page if code exchange fails
  return NextResponse.redirect(
    new URL("/login?error=auth_callback_failed", appBaseUrl)
  );
}
