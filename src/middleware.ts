import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const DEFAULT_ROOT_REDIRECT_DOMAIN = "frontdesk-ai.cloud";

function parseConfiguredUrl(value?: string) {
  if (!value?.trim()) {
    return null;
  }

  try {
    return new URL(value.trim());
  } catch {
    return null;
  }
}

function normalizeHost(value?: string | null) {
  return (value ?? "")
    .split(",")[0]
    .trim()
    .toLowerCase()
    .replace(/:\d+$/, "");
}

function resolveCanonicalAppUrl() {
  return (
    parseConfiguredUrl(process.env.APP_BASE_URL) ??
    parseConfiguredUrl(process.env.NEXT_PUBLIC_APP_URL)
  );
}

function buildCanonicalHostRedirect(request: NextRequest) {
  const appUrl = resolveCanonicalAppUrl();
  if (!appUrl) {
    return null;
  }

  const requestHost = normalizeHost(
    request.headers.get("x-forwarded-host") ?? request.headers.get("host")
  );
  const appHost = normalizeHost(appUrl.host);
  const rootHost = normalizeHost(
    process.env.ROOT_REDIRECT_DOMAIN ?? DEFAULT_ROOT_REDIRECT_DOMAIN
  );

  if (
    rootHost &&
    requestHost !== appHost &&
    (requestHost === rootHost || requestHost === `www.${rootHost}`)
  ) {
    const redirectUrl = new URL(request.nextUrl.pathname, appUrl);
    redirectUrl.search = request.nextUrl.search;
    return NextResponse.redirect(redirectUrl, 308);
  }

  return null;
}

function resolveRedirectOrigin(request: NextRequest) {
  const forwardedHost = request.headers.get("x-forwarded-host")?.trim();
  const host = forwardedHost || request.headers.get("host")?.trim();
  const forwardedProto = request.headers.get("x-forwarded-proto")?.trim();
  const protocol =
    forwardedProto || request.nextUrl.protocol.replace(/:$/, "") || "http";
  const configuredBaseUrl = process.env.APP_BASE_URL?.trim();

  if (host) {
    try {
      return new URL(`${protocol}://${host}`);
    } catch {}
  }

  if (configuredBaseUrl) {
    try {
      return new URL(configuredBaseUrl);
    } catch {}
  }

  return new URL(request.url);
}

function buildRedirectUrl(
  request: NextRequest,
  pathname: string,
  search = ""
) {
  const url = new URL(pathname, resolveRedirectOrigin(request));
  url.search = search;
  return url;
}

export async function middleware(request: NextRequest) {
  const canonicalHostRedirect = buildCanonicalHostRedirect(request);
  if (canonicalHostRedirect) {
    return canonicalHostRedirect;
  }

  let supabaseResponse = NextResponse.next({
    request,
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({
            request,
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Refresh the session
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;

  // Public routes that don't require authentication
  const isPublicRoute =
    pathname.startsWith("/login") ||
    pathname.startsWith("/auth") ||
    pathname.startsWith("/api/webhook/whatsapp") ||
    pathname.startsWith("/api/webhooks/whatsapp") ||
    pathname.startsWith("/api/automation/run-due") ||
    pathname.startsWith("/api/campaigns/run-due") ||
    pathname.startsWith("/api/contact-memory/run-due");

  // If no user and not on a public route, redirect to login
  if (!user && !isPublicRoute) {
    const redirectResponse = NextResponse.redirect(
      buildRedirectUrl(request, "/login")
    );
    // Copy auth cookies from supabaseResponse to the redirect response
    supabaseResponse.cookies.getAll().forEach((cookie) => {
      redirectResponse.cookies.set(cookie.name, cookie.value);
    });
    return redirectResponse;
  }

  // If user exists and on login page WITHOUT error/message params, redirect to dashboard.
  // If there's an error or message param, the user was explicitly sent here (e.g. missing
  // clinic membership) — do NOT redirect them away or we'll create a loop.
  if (user && pathname.startsWith("/login")) {
    const errorParam = request.nextUrl.searchParams.get("error");
    const hasErrorOrMessage =
      Boolean(errorParam) ||
      request.nextUrl.searchParams.has("message");

    if (errorParam === "Missing clinic membership") {
      const redirectResponse = NextResponse.redirect(
        buildRedirectUrl(request, "/setup")
      );
      supabaseResponse.cookies.getAll().forEach((cookie) => {
        redirectResponse.cookies.set(cookie.name, cookie.value);
      });
      return redirectResponse;
    }

    if (!hasErrorOrMessage) {
      const redirectResponse = NextResponse.redirect(
        buildRedirectUrl(request, "/inbox")
      );
      supabaseResponse.cookies.getAll().forEach((cookie) => {
        redirectResponse.cookies.set(cookie.name, cookie.value);
      });
      return redirectResponse;
    }
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
