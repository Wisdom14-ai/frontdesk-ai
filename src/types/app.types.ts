export type BotMode = "active" | "paused" | "handoff_required";

export type ContactStatus =
  | "new_lead"
  | "contacted"
  | "appointment_set"
  | "attended"
  | "no_show"
  | "converted";

export type AttendanceStatus = "pending" | "attended" | "no_show" | "cancelled";

export type MessageDirection = "inbound" | "outbound";

export type SenderType = "lead" | "bot" | "human" | "system";

export type TemplateCategory =
  | "reminder"
  | "promo"
  | "nurture"
  | "follow_up"
  | "custom";

export type TreatmentCategory = "dental" | "aesthetic" | "gp" | "other";

export interface AppContact {
  id: string;
  clinic_id: string;
  full_name: string;
  phone_e164: string;
  treatment_interest: string | null;
  current_status: ContactStatus | string;
  assigned_user_id: string | null;
  source: string | null;
  campaign_name: string | null;
  treatment_category: TreatmentCategory | string | null;
  unread_count: number;
  bot_mode: BotMode;
  last_inbound_at: string | null;
  last_outbound_at: string | null;
  appointment_date: string | null;
  appointment_time: string | null;
  reminder_sent_at: string | null;
  staff_note: string | null;
  attendance_status: AttendanceStatus | string | null;
  revenue_generated_myr: number | null;
  automation_enabled?: boolean;
  ai_last_intent?: string | null;
  ai_last_confidence?: number | null;
  last_handoff_reason?: string | null;
  next_follow_up_at?: string | null;
  lead_memory_auto?: Record<string, unknown> | null;
  lead_memory_override?: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
  last_message_preview?: string;
  last_message_at?: string | null;
  assigned_user_name?: string | null;
}

export interface RevenueLogEntry {
  id: string;
  contact_id: string;
  amount: number;
  note: string | null;
  created_at: string;
}

export interface AppMessage {
  id: string;
  clinic_id?: string;
  contact_id: string;
  provider_message_id?: string | null;
  direction: MessageDirection;
  sender_type: SenderType;
  content: string;
  ai_generated?: boolean | null;
  created_at: string;
}

export interface MessageTemplate {
  id: string;
  clinic_id: string;
  name: string;
  body: string;
  category: TemplateCategory;
  show_as_quick_reply: boolean;
  created_by_user_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface StaffUser {
  id: string;
  clinic_id: string;
  full_name: string;
  email: string;
  role: "admin" | "manager" | "receptionist";
  status: "active" | "invited" | "disabled";
  created_at: string;
}
