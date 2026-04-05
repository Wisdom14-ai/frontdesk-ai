import { NextResponse } from "next/server";

import { runDueBroadcastCampaignJobs } from "@/lib/server/campaigns";
import {
  authorizeRunnerRequest,
  getCampaignRunnerSecrets,
} from "@/lib/server/runner-auth";
import { createAdminClient } from "@/lib/supabase/admin";

async function handleRunDueCampaigns(req: Request) {
  const authorization = authorizeRunnerRequest(req, {
    allowedSecrets: getCampaignRunnerSecrets(),
    missingSecretMessage:
      "Configure CAMPAIGN_RUNNER_SECRET, AUTOMATION_RUNNER_SECRET, or CRON_SECRET before running broadcast campaigns.",
    unauthorizedMessage: "Unauthorized broadcast campaign runner request.",
  });

  if (!authorization.ok) {
    return NextResponse.json({ error: authorization.error }, { status: authorization.status });
  }

  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json(
      { error: "Supabase service role is not configured." },
      { status: 503 }
    );
  }

  try {
    const summary = await runDueBroadcastCampaignJobs({
      client: admin,
      triggerSource: "scheduler",
    });

    return NextResponse.json(summary);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to load due broadcast campaign jobs.",
      },
      { status: 500 }
    );
  }
}

export async function GET(req: Request) {
  return handleRunDueCampaigns(req);
}

export async function POST(req: Request) {
  return handleRunDueCampaigns(req);
}
