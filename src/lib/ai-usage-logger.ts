import "server-only";

import { calculateCost } from "@/lib/ai-pricing";
import { createAdminClient } from "@/lib/supabase/admin";

export type AiUsageStatus = "success" | "error" | "blocked";

export interface LogAiUsageParams {
  clinicId: string;
  contactId?: string | null;
  operationType: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs?: number;
  status?: AiUsageStatus;
  errorMessage?: string;
  requestId?: string;
}

export async function logAiUsage(params: LogAiUsageParams): Promise<void> {
  try {
    const admin = createAdminClient();

    if (!admin) {
      console.warn("[ai-usage] SUPABASE_SERVICE_ROLE_KEY is not configured.");
      return;
    }

    const { error } = await admin.from("ai_usage_logs").insert({
      clinic_id: params.clinicId,
      contact_id: params.contactId ?? null,
      operation_type: params.operationType,
      model: params.model,
      input_tokens: Math.max(0, Math.round(params.inputTokens)),
      output_tokens: Math.max(0, Math.round(params.outputTokens)),
      cost_usd: calculateCost(
        params.model,
        params.inputTokens,
        params.outputTokens
      ),
      latency_ms:
        typeof params.latencyMs === "number"
          ? Math.max(0, Math.round(params.latencyMs))
          : null,
      status: params.status ?? "success",
      error_message: params.errorMessage ?? null,
      request_id: params.requestId ?? null,
    });

    if (error) {
      console.warn("[ai-usage] Failed to insert AI usage log.", {
        message: error.message,
        details: error.details,
        hint: error.hint,
        code: error.code,
      });
    }
  } catch (error) {
    console.warn(
      "[ai-usage] Unexpected failure while inserting AI usage log.",
      error
    );
  }
}
