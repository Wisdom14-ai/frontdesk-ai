import "server-only";

function normalizeSecret(value?: string | null) {
  return value?.trim() || null;
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

  if (!providedSecret || !input.allowedSecrets.includes(providedSecret)) {
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
