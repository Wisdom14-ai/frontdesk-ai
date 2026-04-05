import { NextResponse } from "next/server";

import { runDueContactMemoryJobs } from "@/lib/server/contact-memory";
import {
  authorizeRunnerRequest,
  getContactMemoryRunnerSecrets,
} from "@/lib/server/runner-auth";
import { createAdminClient } from "@/lib/supabase/admin";

async function handleRunDueContactMemoryJobs(req: Request) {
  const authorization = authorizeRunnerRequest(req, {
    allowedSecrets: getContactMemoryRunnerSecrets(),
    missingSecretMessage:
      "Configure CONTACT_MEMORY_RUNNER_SECRET, AUTOMATION_RUNNER_SECRET, or CRON_SECRET before running contact memory jobs.",
    unauthorizedMessage: "Unauthorized contact memory runner request.",
  });

  if (!authorization.ok) {
    return NextResponse.json(
      { error: authorization.error },
      { status: authorization.status }
    );
  }

  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json(
      { error: "Supabase service role is not configured." },
      { status: 503 }
    );
  }

  try {
    const summary = await runDueContactMemoryJobs({
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
            : "Failed to run due contact memory jobs.",
      },
      { status: 500 }
    );
  }
}

export async function GET(req: Request) {
  return handleRunDueContactMemoryJobs(req);
}

export async function POST(req: Request) {
  return handleRunDueContactMemoryJobs(req);
}
