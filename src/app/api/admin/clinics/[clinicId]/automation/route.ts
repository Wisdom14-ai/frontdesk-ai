import { NextResponse } from "next/server";

import {
  cancelPendingAutomationJobsForRule,
  ensureDefaultAutomationRules,
  getAutomationHealthSummary,
  getClinicAutomationRules,
  isAutomationSchemaMismatchError,
  upsertAutomationRule,
} from "@/lib/server/automation";
import { hasAutomationRunnerProtection } from "@/lib/server/runner-auth";
import { requireAgencyAdmin } from "@/lib/server/auth";
import { createAdminClient, hasAdminClientConfig } from "@/lib/supabase/admin";

function buildSchemaErrorMessage() {
  return "Apply the latest supabase-schema.sql to manage automation settings.";
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
    const rules = await getClinicAutomationRules(admin, clinicId);
    const health = await getAutomationHealthSummary(admin, clinicId, {
      serviceRoleConfigured: hasAdminClientConfig(),
      runnerSecretConfigured: hasAutomationRunnerProtection(),
      canManageAutomation: true,
    });

    return NextResponse.json({ rules, health });
  } catch (error) {
    return NextResponse.json(
      {
        error: isAutomationSchemaMismatchError(error)
          ? buildSchemaErrorMessage()
          : "Failed to load automation settings.",
      },
      { status: 500 }
    );
  }
}

export async function PATCH(
  req: Request,
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
  const body = (await req.json()) as {
    ruleKey?: string;
    isEnabled?: boolean;
    delayHours?: number;
    templateBody?: string;
  };

  if (!body.ruleKey) {
    return NextResponse.json({ error: "A rule key is required." }, { status: 400 });
  }

  if (
    typeof body.isEnabled !== "boolean" ||
    typeof body.delayHours !== "number" ||
    !Number.isFinite(body.delayHours) ||
    body.delayHours < 0 ||
    !body.templateBody?.trim()
  ) {
    return NextResponse.json(
      { error: "Enabled state, delay hours, and a non-empty template are required." },
      { status: 400 }
    );
  }

  try {
    await ensureDefaultAutomationRules(admin, clinicId);
    const rules = await getClinicAutomationRules(admin, clinicId);
    const targetRule = rules.find((rule) => rule.rule_key === body.ruleKey);

    if (!targetRule) {
      return NextResponse.json({ error: "Automation rule not found." }, { status: 404 });
    }

    await upsertAutomationRule(admin, {
        clinic_id: clinicId,
        rule_key: targetRule.rule_key,
        name: targetRule.name,
        job_type: targetRule.job_type,
        delay_hours: Math.round(body.delayHours),
        template_key: targetRule.template_key,
        template_body: body.templateBody.trim(),
        is_enabled: body.isEnabled,
        updated_at: new Date().toISOString(),
      });

    if (!body.isEnabled) {
      await cancelPendingAutomationJobsForRule(
        admin,
        clinicId,
        body.ruleKey,
        "rule_disabled"
      );
    }

    const nextRules = await getClinicAutomationRules(admin, clinicId);
    const health = await getAutomationHealthSummary(admin, clinicId, {
      serviceRoleConfigured: hasAdminClientConfig(),
      runnerSecretConfigured: hasAutomationRunnerProtection(),
      canManageAutomation: true,
    });

    return NextResponse.json({ rules: nextRules, health });
  } catch (error) {
    return NextResponse.json(
      {
        error: isAutomationSchemaMismatchError(error)
          ? buildSchemaErrorMessage()
          : "Failed to save automation settings.",
      },
      { status: 500 }
    );
  }
}
