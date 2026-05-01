const DEFAULT_APP_BASE_URL = "https://app.frontdesk-ai.cloud";

export function getAppBaseUrl() {
  const candidate =
    process.env.APP_BASE_URL?.trim() ||
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    DEFAULT_APP_BASE_URL;

  try {
    const url = new URL(candidate);
    return url.origin;
  } catch {
    return DEFAULT_APP_BASE_URL;
  }
}

export function buildAuthCallbackUrl(nextPath = "/inbox") {
  const url = new URL("/auth/callback", getAppBaseUrl());
  url.searchParams.set("next", normalizeLocalPath(nextPath));
  return url.toString();
}

export function normalizeLocalPath(path: string | null | undefined) {
  if (!path?.startsWith("/") || path.startsWith("//")) {
    return "/inbox";
  }

  return path;
}
