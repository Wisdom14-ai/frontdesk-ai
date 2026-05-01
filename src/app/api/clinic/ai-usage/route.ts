import { NextResponse } from "next/server";

import { requireMembership } from "@/lib/server/auth";

const EMPTY_AI_USAGE_SUMMARY = {
  month_to_date: {
    input_tokens: 0,
    output_tokens: 0,
    total_tokens: 0,
    cost_usd: 0,
    call_count: 0,
  },
  daily_last_30: [],
  by_operation_type: [],
};

export async function GET() {
  const { supabase } = await requireMembership();
  const { data, error } = await supabase.rpc("get_ai_usage_summary");

  if (error) {
    console.warn("[ai-usage-api] Failed to load AI usage summary.", {
      message: error.message,
      details: error.details,
      hint: error.hint,
      code: error.code,
    });

    return NextResponse.json(
      { error: "Failed to load AI usage summary." },
      { status: 500 }
    );
  }

  return NextResponse.json(data ?? EMPTY_AI_USAGE_SUMMARY);
}
