import "server-only";

import type { SupabaseAdminClient } from "@/lib/supabase/admin";

export async function insertAdminAuditLog(
  admin: SupabaseAdminClient,
  input: {
    clinicId: string;
    userId: string;
    action: string;
    resourceType?: string;
    resourceId?: string;
    details?: Record<string, unknown>;
  }
) {
  const { error } = await admin.from("audit_logs").insert({
    clinic_id: input.clinicId,
    user_id: input.userId,
    action: input.action,
    resource_type: input.resourceType ?? "clinic",
    resource_id: input.resourceId ?? input.clinicId,
    details: input.details ?? null,
  });

  if (error) {
    throw error;
  }
}
