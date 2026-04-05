import { NextResponse } from "next/server";

import {
  cancelPendingAutomationJobsForRule,
  ensureDefaultAutomationRules,
  getAutomationHealthSummary,
  getClinicAutomationRules,
  isAutomationSchemaMismatchError,
} from "@/lib/server/automation";
import { canManageStaff, requireMembership } from "@/lib/server/auth";
import { hasAutomationRunnerProtection } from "@/lib/server/runner-auth";
import { createAdminClient, hasAdminClientConfig } from "@/lib/supabase/admin";

function buildSchemaErrorMessage() {
  return "Apply the latest supabase-schema.sql to manage automation settings.";
}

export async function GET() {
  const { supabase, membership } = await requireMembership();

  try {
    const rules = await getClinicAutomationRules(supabase, membership.clinic_id);
    const health = await getAutomationHealthSummary(supabase, membership.clinic_id, {
      serviceRoleConfigured: hasAdminClientConfig(),
      runnerSecretConfigured: hasAutomationRunnerProtection(),
      canManageAutomation: canManageStaff(membership.role),
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

export async function PATCH(req: Request) {
  const { supabase, membership } = await requireMembership();

  if (!canManageStaff(membership.role)) {
    return NextResponse.json(
      { error: "You do not have permission to manage automation settings." },
      { status: 403 }
    );
  }

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

  const writer = createAdminClient() ?? supabase;

  try {
    await ensureDefaultAutomationRules(writer, membership.clinic_id);
    const rules = await getClinicAutomationRules(writer, membership.clinic_id);
    const targetRule = rules.find((rule) => rule.rule_key === body.ruleKey);

    if (!targetRule) {
      return NextResponse.json({ error: "Automation rule not found." }, { status: 404 });
    }

    const { error } = await writer.from("automation_rules").upsert(
      {
        clinic_id: membership.clinic_id,
        rule_key: targetRule.rule_key,
        name: targetRule.name,
        job_type: targetRule.job_type,
        delay_hours: Math.round(body.delayHours),
        template_key: targetRule.template_key,
        template_body: body.templateBody.trim(),
        is_enabled: body.isEnabled,
        updated_at: new Date().toISOString(),
      },
      {
        onConflict: "clinic_id,rule_key",
      }
    );

    if (error) {
      throw error;
    }

    if (!body.isEnabled) {
      await cancelPendingAutomationJobsForRule(
        writer,
        membership.clinic_id,
        body.ruleKey,
        "rule_disabled"
      );
    }

    const nextRules = await getClinicAutomationRules(writer, membership.clinic_id);
    const health = await getAutomationHealthSummary(supabase, membership.clinic_id, {
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
