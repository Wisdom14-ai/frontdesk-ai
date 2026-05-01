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

function isTemplateSchemaError(error: unknown) {
  return (
    Boolean(error && typeof error === "object" && "code" in error) &&
    ["42P01", "42703", "PGRST204", "PGRST205"].includes(
      String((error as { code?: unknown }).code)
    )
  );
}

export async function GET() {
  const { supabase, membership } = await requireMembership();

  const { data, error } = await supabase
    .from("message_templates")
    .select("*")
    .eq("clinic_id", membership.clinic_id)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json(
      {
        error: isTemplateSchemaError(error)
          ? "Apply the message_templates schema before managing templates."
          : "Failed to load templates.",
      },
      { status: 500 }
    );
  }

  return NextResponse.json({ templates: data ?? [] });
}

export async function POST(req: Request) {
  const { supabase, user, membership } = await requireMembership();
  const body = (await req.json()) as {
    name?: string;
    body?: string;
    category?: string;
    show_as_quick_reply?: boolean;
  };

  if (!body.name?.trim() || !body.body?.trim()) {
    return NextResponse.json(
      { error: "Template name and body are required." },
      { status: 400 }
    );
  }

  const writer = createAdminClient() ?? supabase;
  const { data, error } = await writer
    .from("message_templates")
    .insert({
      clinic_id: membership.clinic_id,
      name: body.name.trim(),
      body: body.body.trim(),
      category: normalizeCategory(body.category),
      show_as_quick_reply: Boolean(body.show_as_quick_reply),
      created_by_user_id: user.id,
    })
    .select("*")
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: "Failed to create template." },
      { status: 500 }
    );
  }

  return NextResponse.json({ template: data });
}
