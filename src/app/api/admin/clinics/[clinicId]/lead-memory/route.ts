import { NextResponse } from "next/server";

import {
  getContactMemoryHealthSummary,
  isContactMemorySchemaMismatchError,
} from "@/lib/server/contact-memory";
import { hasContactMemoryRunnerProtection } from "@/lib/server/runner-auth";
import { requireAgencyAdmin } from "@/lib/server/auth";
import { createAdminClient } from "@/lib/supabase/admin";

function buildSchemaErrorMessage() {
  return "Apply the latest supabase-schema.sql to manage lead memory.";
}

export async function GET(
  _req: Request,
  context: { params: Promise<{ clinicId: string }> }
) {
  const auth = await requireAgencyAdmin();
  if (!auth.isAgencyAdmin) {
    return NextResponse.json({ error: "Agency admin access required." }, { status: 403 });
  }

  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json(
      { error: "SUPABASE_SERVICE_ROLE_KEY is required for super admin actions." },
      { status: 503 }
    );
  }

  const { clinicId } = await context.params;

  try {
    const health = await getContactMemoryHealthSummary(admin, clinicId, {
      runnerSecretConfigured: hasContactMemoryRunnerProtection(),
    });

    return NextResponse.json({ health });
  } catch (error) {
    return NextResponse.json(
      {
        error: isContactMemorySchemaMismatchError(error)
          ? buildSchemaErrorMessage()
          : "Failed to load lead memory health.",
      },
      { status: 500 }
    );
  }
}

export async function PATCH() {
  return NextResponse.json(
    {
      error:
        "Lead memory webhook configuration has been retired. Configure OPENAI_API_KEY and LEAD_MEMORY_MODEL in the server environment instead.",
    },
    { status: 410 }
  );
}
