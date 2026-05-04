import { NextResponse } from "next/server";

import { requireMembership } from "@/lib/server/auth";
import { seedStarterTemplates } from "@/lib/server/clinic-starter-templates";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST() {
  const { supabase, user, membership } = await requireMembership();

  const writer = createAdminClient() ?? supabase;

  try {
    const result = await seedStarterTemplates(writer, {
      clinicId: membership.clinic_id,
      createdByUserId: user.id,
    });

    return NextResponse.json(result);
  } catch (err) {
    const code =
      err && typeof err === "object" && "code" in err
        ? String((err as { code?: unknown }).code)
        : null;

    if (
      code &&
      ["42P01", "42703", "PGRST204", "PGRST205"].includes(code)
    ) {
      return NextResponse.json(
        {
          error:
            "Apply the message_templates schema before loading starter templates.",
        },
        { status: 422 }
      );
    }

    return NextResponse.json(
      { error: "Failed to seed starter templates." },
      { status: 500 }
    );
  }
}
