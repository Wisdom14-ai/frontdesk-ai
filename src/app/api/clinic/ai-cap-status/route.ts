import { NextResponse } from "next/server";

import { requireMembership } from "@/lib/server/auth";

const EMPTY_AI_CAP_STATUS = {
  cycle_start: null,
  cycle_end: null,
  cost_usd_used: 0,
  cap_usd: 25,
  percentage_used: 0,
  status: "active",
  paused_at: null,
  paused_reason: null,
};

export async function GET() {
  const { supabase } = await requireMembership();
  const { data, error } = await supabase.rpc("get_current_ai_usage_status");

  if (error) {
    console.warn("[ai-cap-status-api] Failed to load AI cap status.", {
      message: error.message,
      details: error.details,
      hint: error.hint,
      code: error.code,
    });

    return NextResponse.json(
      { error: "Failed to load AI cap status." },
      { status: 500 }
    );
  }

  return NextResponse.json(data ?? EMPTY_AI_CAP_STATUS);
}
