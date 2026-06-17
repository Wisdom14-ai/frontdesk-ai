import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";

function normalizeSecret(value?: string | null) {
  return value?.trim() || null;
}

// Constant-time secret comparison. Hashing both sides to a fixed 32-byte digest
// keeps timingSafeEqual from throwing on length mismatch and avoids leaking the
// secret length or a byte-by-byte match position via response timing.
function secretsMatch(provided: string, allowed: string[]) {
  const providedDigest = createHash("sha256").update(provided).digest();
  let matched = false;
  for (const candidate of allowed) {
    const candidateDigest = createHash("sha256").update(candidate).digest();
    if (timingSafeEqual(providedDigest, candidateDigest)) {
      matched = true;
    }
  }
  return matched;
}

function uniqueSecrets(values: Array<string | null>) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function getAuthorizationBearerToken(req: Request) {
  const authorization = req.headers.get("authorization")?.trim();

  if (!authorization) {
    return null;
  }

  const [scheme, ...rest] = authorization.split(/\s+/);
  if (!scheme || scheme.toLowerCase() !== "bearer" || rest.length === 0) {
    return null;
  }

  return rest.join(" ").trim() || null;
}

function getProvidedRunnerSecret(req: Request) {
  return normalizeSecret(
    req.headers.get("x-runner-secret") ?? getAuthorizationBearerToken(req)
  );
}

export function getAutomationRunnerSecrets() {
  return uniqueSecrets([
    normalizeSecret(process.env.AUTOMATION_RUNNER_SECRET),
    normalizeSecret(process.env.CRON_SECRET),
  ]);
}

export function getCampaignRunnerSecrets() {
  return uniqueSecrets([
    normalizeSecret(process.env.CAMPAIGN_RUNNER_SECRET),
    normalizeSecret(process.env.AUTOMATION_RUNNER_SECRET),
    normalizeSecret(process.env.CRON_SECRET),
  ]);
}

export function getContactMemoryRunnerSecrets() {
  return uniqueSecrets([
    normalizeSecret(process.env.CONTACT_MEMORY_RUNNER_SECRET),
    normalizeSecret(process.env.AUTOMATION_RUNNER_SECRET),
    normalizeSecret(process.env.CRON_SECRET),
  ]);
}

export function hasAutomationRunnerProtection() {
  return getAutomationRunnerSecrets().length > 0;
}

export function hasCampaignRunnerProtection() {
  return getCampaignRunnerSecrets().length > 0;
}

export function hasContactMemoryRunnerProtection() {
  return getContactMemoryRunnerSecrets().length > 0;
}

export function authorizeRunnerRequest(
  req: Request,
  input: {
    allowedSecrets: string[];
    missingSecretMessage: string;
    unauthorizedMessage: string;
  }
) {
  if (input.allowedSecrets.length === 0) {
    return {
      ok: false as const,
      status: 503 as const,
      error: input.missingSecretMessage,
    };
  }

  const providedSecret = getProvidedRunnerSecret(req);

  if (!providedSecret || !secretsMatch(providedSecret, input.allowedSecrets)) {
    return {
      ok: false as const,
      status: 401 as const,
      error: input.unauthorizedMessage,
    };
  }

  return {
    ok: true as const,
  };
}
