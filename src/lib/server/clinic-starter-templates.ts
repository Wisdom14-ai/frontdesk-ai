import "server-only";

/**
 * Pre-built WhatsApp message templates for Malaysian dental, aesthetic, and
 * GP clinics. Loaded once on demand via the "Load starter templates" action.
 *
 * Variables:  {{contact_name}}  {{clinic_name}}
 * Categories: reminder | promo | nurture | follow_up | custom
 */

interface StarterTemplate {
  name: string;
  body: string;
  category: "reminder" | "promo" | "nurture" | "follow_up" | "custom";
  show_as_quick_reply: boolean;
}

const DENTAL_TEMPLATES: StarterTemplate[] = [
  {
    name: "Appointment reminder (dental)",
    category: "reminder",
    show_as_quick_reply: true,
    body: "Hi {{contact_name}} 👋 Just a reminder that you have a dental appointment at {{clinic_name}} tomorrow. Please arrive 5 minutes early. Reply here if you need to reschedule.",
  },
  {
    name: "Scaling & cleaning due (6-month)",
    category: "reminder",
    show_as_quick_reply: false,
    body: "Hi {{contact_name}}, your 6-month dental scaling & cleaning is due at {{clinic_name}}! Regular cleanings prevent gum disease and keep your smile healthy 🦷 Reply here to book your slot.",
  },
  {
    name: "Annual dental check-up due",
    category: "reminder",
    show_as_quick_reply: false,
    body: "Hi {{contact_name}}, it's time for your annual dental check-up at {{clinic_name}}! Early detection keeps small problems from becoming big ones. Reply here to book 🦷",
  },
  {
    name: "Post-extraction care",
    category: "follow_up",
    show_as_quick_reply: true,
    body: "Hi {{contact_name}}, hope you're feeling well after your extraction at {{clinic_name}} today 😊 Remember: avoid hard foods, no smoking, and keep the area clean. Any concerns, reply here anytime.",
  },
  {
    name: "Braces adjustment reminder",
    category: "reminder",
    show_as_quick_reply: true,
    body: "Hi {{contact_name}}, your next braces adjustment appointment at {{clinic_name}} is coming up. Please confirm your attendance by replying YES, or let us know if you need to reschedule.",
  },
  {
    name: "Dental promotion – whitening",
    category: "promo",
    show_as_quick_reply: false,
    body: "Hi {{contact_name}} ✨ {{clinic_name}} is running a special on professional teeth whitening this month! Get a brighter smile in just one session. Reply here to find out more or to book.",
  },
  {
    name: "Missing appointment follow-up (dental)",
    category: "follow_up",
    show_as_quick_reply: true,
    body: "Hi {{contact_name}}, we noticed you missed your appointment at {{clinic_name}}. No worries — let's get you rescheduled! Reply here and we'll find the next available slot for you 😊",
  },
];

const AESTHETIC_TEMPLATES: StarterTemplate[] = [
  {
    name: "Botox touch-up due (4 months)",
    category: "reminder",
    show_as_quick_reply: false,
    body: "Hi {{contact_name}} ✨ Your botox results typically last 3–4 months — time for your touch-up at {{clinic_name}}! Reply here to book your next session and keep looking your best.",
  },
  {
    name: "Dermal filler top-up due (6 months)",
    category: "reminder",
    show_as_quick_reply: false,
    body: "Hi {{contact_name}}, your dermal filler top-up at {{clinic_name}} is due soon to maintain your results ✨ Reply here to book your appointment before your schedule fills up.",
  },
  {
    name: "Post-treatment care (aesthetic)",
    category: "follow_up",
    show_as_quick_reply: true,
    body: "Hi {{contact_name}}, thank you for visiting {{clinic_name}} today 😊 Remember to avoid touching the treated area, stay out of direct sun, and keep hydrated. Any concerns, reply here anytime!",
  },
  {
    name: "Aesthetic consultation follow-up",
    category: "follow_up",
    show_as_quick_reply: true,
    body: "Hi {{contact_name}}, great speaking with you at {{clinic_name}} today! Do you have any questions about the treatment plan we discussed? Reply here and our team is happy to help 😊",
  },
  {
    name: "Aesthetic promotion – facials",
    category: "promo",
    show_as_quick_reply: false,
    body: "Hi {{contact_name}} 🌟 {{clinic_name}} has an exclusive promotion on facial treatments this month! Spots are limited — reply here to find out more or to book your session.",
  },
  {
    name: "New treatment available",
    category: "promo",
    show_as_quick_reply: false,
    body: "Hi {{contact_name}}, exciting news from {{clinic_name}}! We now offer [treatment name]. As one of our valued patients, we'd love to share the details with you. Reply here to learn more ✨",
  },
];

const GP_TEMPLATES: StarterTemplate[] = [
  {
    name: "Annual health screening reminder",
    category: "reminder",
    show_as_quick_reply: false,
    body: "Hi {{contact_name}}, your annual health screening at {{clinic_name}} is due 💊 Regular check-ups help catch issues early. Reply here to book your appointment.",
  },
  {
    name: "Medication refill reminder",
    category: "reminder",
    show_as_quick_reply: true,
    body: "Hi {{contact_name}}, just a reminder from {{clinic_name}} — your medication refill may be due soon. Reply here to arrange a prescription renewal without needing to queue 😊",
  },
  {
    name: "Post-consultation follow-up (GP)",
    category: "follow_up",
    show_as_quick_reply: true,
    body: "Hi {{contact_name}}, hope you're feeling better after your visit to {{clinic_name}} 😊 Please remember to complete your medication course. Any questions or concerns, don't hesitate to reply here.",
  },
  {
    name: "Vaccination reminder",
    category: "reminder",
    show_as_quick_reply: false,
    body: "Hi {{contact_name}}, {{clinic_name}} would like to remind you that your vaccination schedule is due. Staying up to date protects you and those around you 💉 Reply here to book.",
  },
  {
    name: "MC follow-up check",
    category: "follow_up",
    show_as_quick_reply: true,
    body: "Hi {{contact_name}}, checking in from {{clinic_name}} 😊 How are you feeling today after your MC? If you are not feeling better or have any concerns, please reply here and we can arrange a follow-up.",
  },
];

const GENERAL_TEMPLATES: StarterTemplate[] = [
  {
    name: "Welcome new patient",
    category: "nurture",
    show_as_quick_reply: false,
    body: "Hi {{contact_name}}, welcome to {{clinic_name}}! 🎉 We're glad you reached out. Our team is here to help — just reply here if you have any questions or would like to book an appointment.",
  },
  {
    name: "Google review request",
    category: "follow_up",
    show_as_quick_reply: true,
    body: "Hi {{contact_name}}, thank you for visiting {{clinic_name}}! 😊 If you had a great experience, we'd really appreciate a Google review — it helps other patients find us. Reply here if you have any feedback!",
  },
];

export const ALL_STARTER_TEMPLATES: StarterTemplate[] = [
  ...DENTAL_TEMPLATES,
  ...AESTHETIC_TEMPLATES,
  ...GP_TEMPLATES,
  ...GENERAL_TEMPLATES,
];

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Seed starter templates for a clinic. Skips templates whose name already
 * exists for this clinic to prevent duplicates on re-runs.
 *
 * Returns counts of { inserted, skipped }.
 */
export async function seedStarterTemplates(
  client: SupabaseClient,
  input: { clinicId: string; createdByUserId: string }
): Promise<{ inserted: number; skipped: number }> {
  // Load existing template names for this clinic
  const { data: existing } = await client
    .from("message_templates")
    .select("name")
    .eq("clinic_id", input.clinicId);

  const existingNames = new Set(
    (existing ?? []).map((row) => (row as { name: string }).name)
  );

  const toInsert = ALL_STARTER_TEMPLATES.filter(
    (t) => !existingNames.has(t.name)
  );

  if (toInsert.length === 0) {
    return { inserted: 0, skipped: ALL_STARTER_TEMPLATES.length };
  }

  const nowIso = new Date().toISOString();
  const rows = toInsert.map((t) => ({
    clinic_id: input.clinicId,
    name: t.name,
    body: t.body,
    category: t.category,
    show_as_quick_reply: t.show_as_quick_reply,
    created_by_user_id: input.createdByUserId,
    created_at: nowIso,
    updated_at: nowIso,
  }));

  const { error } = await client.from("message_templates").insert(rows);

  if (error) {
    throw error;
  }

  return {
    inserted: toInsert.length,
    skipped: ALL_STARTER_TEMPLATES.length - toInsert.length,
  };
}
