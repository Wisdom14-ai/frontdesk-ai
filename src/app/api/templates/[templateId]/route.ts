import { NextResponse } from "next/server";

import { requireMembership } from "@/lib/server/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import type { TemplateCategory } from "@/types/app.types";

const VALID_CATEGORIES = new Set([
  "reminder",
  "promo",
  "nurture",
  "follow_up",
  "custom",
]);

function normalizeCategory(value: unknown): TemplateCategory {
  return typeof value === "string" && VALID_CATEGORIES.has(value)
    ? (value as TemplateCategory)
    : "custom";
}

export async function PATCH(
  req: Request,
  context: { params: Promise<{ templateId: string }> }
) {
  const { supabase, membership } = await requireMembership();
  const { templateId } = await context.params;
  const body = (await req.json()) as {
    name?: string;
    body?: string;
    category?: string;
    show_as_quick_reply?: boolean;
  };

  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (typeof body.name === "string") updates.name = body.name.trim();
  if (typeof body.body === "string") updates.body = body.body.trim();
  if (typeof body.category === "string") updates.category = normalizeCategory(body.category);
  if (typeof body.show_as_quick_reply === "boolean") {
    updates.show_as_quick_reply = body.show_as_quick_reply;
  }

  const writer = createAdminClient() ?? supabase;
  const { data, error } = await writer
    .from("message_templates")
    .update(updates)
    .eq("id", templateId)
    .eq("clinic_id", membership.clinic_id)
    .select("*")
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: "Failed to update template." },
      { status: 500 }
    );
  }

  return NextResponse.json({ template: data });
}

export async function DELETE(
  _req: Request,
  context: { params: Promise<{ templateId: string }> }
) {
  const { supabase, membership } = await requireMembership();
  const { templateId } = await context.params;
  const writer = createAdminClient() ?? supabase;

  const { error } = await writer
    .from("message_templates")
    .delete()
    .eq("id", templateId)
    .eq("clinic_id", membership.clinic_id);

  if (error) {
    return NextResponse.json(
      { error: "Failed to delete template." },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true });
}
