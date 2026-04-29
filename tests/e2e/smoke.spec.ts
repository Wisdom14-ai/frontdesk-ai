import { expect, test } from "@playwright/test";

const automationRunnerSecret =
  process.env.AUTOMATION_RUNNER_SECRET ?? "test-runner-secret";
const contactMemoryRunnerSecret =
  process.env.CONTACT_MEMORY_RUNNER_SECRET ?? automationRunnerSecret;
const campaignRunnerSecret =
  process.env.CAMPAIGN_RUNNER_SECRET ?? automationRunnerSecret;
const cronSecret = process.env.CRON_SECRET ?? automationRunnerSecret;

test("anonymous users are redirected to login from protected routes", async ({
  page,
}) => {
  await page.goto("/board");

  await expect(page).toHaveURL(/\/login$/);
  await expect(
    page.getByRole("heading", { name: "Welcome back" })
  ).toBeVisible();
});

test("login page exposes branded auth fields", async ({ page }) => {
  await page.goto("/login");

  await expect(page).toHaveTitle(/Frontdesk AI/);
  await expect(
    page.getByText("AI WhatsApp CRM for clinic teams").first()
  ).toBeVisible();
  await expect(page.getByLabel("Email")).toHaveAttribute(
    "autocomplete",
    "email"
  );
  await expect(page.getByLabel("Password")).toHaveAttribute(
    "autocomplete",
    "current-password"
  );
  await expect(page.getByRole("button", { name: "Sign In" })).toBeVisible();
});

test("workspace signup mode reveals bootstrap fields", async ({ page }) => {
  await page.goto("/login");
  await page
    .getByRole("button", { name: "Don't have an account? Create workspace" })
    .click();

  await expect(
    page.getByRole("heading", { name: "Create your workspace" })
  ).toBeVisible();
  await expect(page.getByLabel("Full Name")).toBeVisible();
  await expect(page.getByLabel("Clinic Name")).toBeVisible();
  await expect(page.getByLabel("Password")).toHaveAttribute(
    "autocomplete",
    "new-password"
  );
  await expect(
    page.getByRole("button", { name: "Create Workspace" })
  ).toBeVisible();
});

test("webhook rejects requests without a shared secret", async ({ request }) => {
  const response = await request.post("/api/webhooks/whatsapp", {
    data: { event: "messages.upsert" },
  });

  expect(response.status()).toBe(401);

  const payload = (await response.json()) as { error?: string };
  expect(payload.error).toContain("secret");
});

test("automation runner endpoint requires the shared secret", async ({
  request,
}) => {
  const unauthorized = await request.post("/api/automation/run-due");
  expect(unauthorized.status()).toBe(401);

  const authorized = await request.post("/api/automation/run-due", {
    headers: {
      "x-runner-secret": automationRunnerSecret,
    },
  });
  expect(authorized.status()).toBe(200);

  const payload = (await authorized.json()) as {
    jobs_scanned?: number;
    jobs_sent?: number;
    jobs_failed?: number;
    jobs_skipped?: number;
  };
  expect(payload.jobs_scanned).toBeDefined();
  expect(payload.jobs_sent).toBeDefined();
  expect(payload.jobs_failed).toBeDefined();
  expect(payload.jobs_skipped).toBeDefined();

  const unauthorizedCron = await request.get("/api/automation/run-due");
  expect(unauthorizedCron.status()).toBe(401);

  const authorizedCron = await request.get("/api/automation/run-due", {
    headers: {
      authorization: `Bearer ${cronSecret}`,
    },
  });
  expect(authorizedCron.status()).toBe(200);
});

test("contact memory runner endpoint requires the shared secret", async ({
  request,
}) => {
  const unauthorized = await request.post("/api/contact-memory/run-due");
  expect(unauthorized.status()).toBe(401);

  const authorized = await request.post("/api/contact-memory/run-due", {
    headers: {
      "x-runner-secret": contactMemoryRunnerSecret,
    },
  });
  expect(authorized.status()).toBe(200);

  const payload = (await authorized.json()) as {
    jobs_scanned?: number;
    jobs_completed?: number;
    jobs_failed?: number;
    jobs_skipped?: number;
  };
  expect(payload.jobs_scanned).toBeDefined();
  expect(payload.jobs_completed).toBeDefined();
  expect(payload.jobs_failed).toBeDefined();
  expect(payload.jobs_skipped).toBeDefined();

  const unauthorizedCron = await request.get("/api/contact-memory/run-due");
  expect(unauthorizedCron.status()).toBe(401);

  const authorizedCron = await request.get("/api/contact-memory/run-due", {
    headers: {
      authorization: `Bearer ${cronSecret}`,
    },
  });
  expect(authorizedCron.status()).toBe(200);
});

test("campaign runner endpoint requires the shared secret", async ({
  request,
}) => {
  const unauthorized = await request.post("/api/campaigns/run-due");
  expect(unauthorized.status()).toBe(401);

  const authorized = await request.post("/api/campaigns/run-due", {
    headers: {
      "x-runner-secret": campaignRunnerSecret,
    },
  });
  expect(authorized.status()).toBe(200);

  const payload = (await authorized.json()) as {
    jobs_scanned?: number;
    jobs_sent?: number;
    jobs_failed?: number;
    jobs_skipped?: number;
  };
  expect(payload.jobs_scanned).toBeDefined();
  expect(payload.jobs_sent).toBeDefined();
  expect(payload.jobs_failed).toBeDefined();
  expect(payload.jobs_skipped).toBeDefined();

  const unauthorizedCron = await request.get("/api/campaigns/run-due");
  expect(unauthorizedCron.status()).toBe(401);

  const authorizedCron = await request.get("/api/campaigns/run-due", {
    headers: {
      authorization: `Bearer ${cronSecret}`,
    },
  });
  expect(authorizedCron.status()).toBe(200);
});
