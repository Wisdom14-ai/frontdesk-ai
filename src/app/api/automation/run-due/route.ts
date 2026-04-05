import { NextResponse } from "next/server";

import { runDueAutomationJobs } from "@/lib/server/automation";
import {
  authorizeRunnerRequest,
  getAutomationRunnerSecrets,
} from "@/lib/server/runner-auth";
import { createAdminClient } from "@/lib/supabase/admin";

async function handleRunDueAutomationJobs(req: Request) {
  const authorization = authorizeRunnerRequest(req, {
    allowedSecrets: getAutomationRunnerSecrets(),
    missingSecretMessage:
      "Configure AUTOMATION_RUNNER_SECRET or CRON_SECRET before running automation jobs.",
    unauthorizedMessage: "Unauthorized automation runner request.",
  });

  if (!authorization.ok) {
    return NextResponse.json({ error: authorization.error }, { status: authorization.status });
  }

  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Supabase service role is not configured." }, { status: 503 });
  }

  try {
    const summary = await runDueAutomationJobs({
      admin,
      triggerSource: "scheduler",
    });

    return NextResponse.json(summary);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to load due automation jobs.",
      },
      { status: 500 }
    );
  }
}

export async function GET(req: Request) {
  return handleRunDueAutomationJobs(req);
}

export async function POST(req: Request) {
  return handleRunDueAutomationJobs(req);
}
