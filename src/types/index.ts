import { BoardColumn } from "../store";

export type StaffRole = "admin" | "manager" | "receptionist";
export type StaffStatus = "active" | "invited" | "disabled";
export type ClinicType =
  | "dental"
  | "aesthetic"
  | "gp"
  | "functional_medicine"
  | "physio";
export type PlanType = "starter" | "pro";
export type SubscriptionStatus = "active" | "paused" | "cancelled" | "churned";
export type PaymentStatus = "pending" | "received";
export type WhatsappStatus =
  | "not_connected"
  | "pending_qr"
  | "connected"
  | "disconnected";
export type WorkspaceAccessState =
  | "ready"
  | "awaiting_payment"
  | "connect_whatsapp"
  | "subscription_locked";
export type LeadQuality = "unknown" | "cold" | "warm" | "hot";
export type ContactMemoryTriggerSource =
  | "message_inbound"
  | "message_outbound_human"
  | "message_outbound_bot"
  | "contact_updated"
  | "manual_refresh"
  | "backfill";
export type ContactMemoryJobStatus =
  | "pending"
  | "processing"
  | "completed"
  | "failed"
  | "skipped";

export interface ContactMemoryRunnerIssue {
  message: string;
  updated_at: string | null;
  status: ContactMemoryJobStatus | null;
}

export interface ContactMemoryRunnerRunSummary {
  id?: string;
  clinic_id?: string;
  trigger_source: AutomationTriggerSource;
  status: AutomationRunStatus;
  jobs_scanned: number;
  jobs_completed: number;
  jobs_failed: number;
  jobs_skipped: number;
  started_at: string;
  completed_at?: string | null;
  error?: string | null;
}

export interface ContactMemoryHealthSummary {
  provider_configured: boolean;
  provider_configuration_error: string | null;
  runner_secret_configured: boolean;
  pending_jobs: number;
  overdue_jobs: number;
  failed_jobs: number;
  last_run: ContactMemoryRunnerRunSummary | null;
  latest_generated_at: string | null;
  latest_error: ContactMemoryRunnerIssue | null;
  schema_warning: string | null;
}

export interface ContactLeadMemory {
  lead_summary: string;
  conversation_summary: string;
  lead_quality: LeadQuality;
  lead_quality_reason: string;
  last_outcome: string;
  next_action: string;
  objections: string;
}

export type ContactLeadMemoryKey = keyof ContactLeadMemory;

export interface Lead {
  id: string;
  clinic_id: string;
  full_name: string;
  phone_e164: string;
  treatment_interest: string;
  status: BoardColumn;
  assigned_user_id?: string;
  source?: string;
  campaign_name?: string;
  created_at: string; // ISO date string
  updated_at: string; // ISO date string
  last_inbound_at?: string;
  last_outbound_at?: string;
  unread_count: number;
  bot_mode: "active" | "paused" | "handoff_required";
  ai_last_intent?: string;
  ai_last_confidence?: number;
  last_handoff_reason?: string;
  automation_enabled?: boolean;
  next_follow_up_at?: string;
  appointment_date?: string;
  appointment_time?: string;
  reminder_sent_at?: string;
  marketing_opt_out_at?: string | null;
  marketing_opt_out_reason?: string | null;
  marketing_opt_out_source?: string | null;
  attendance_status?: string;
  lead_memory: ContactLeadMemory;
  lead_memory_auto?: ContactLeadMemory;
  lead_memory_override?: Partial<ContactLeadMemory>;
  staff_note?: string | null;
  lead_memory_last_generated_at?: string | null;
  lead_memory_last_error?: string | null;
  revenue_generated_myr?: number;
  revenue_note?: string;
}

export type MessageDirection = "inbound" | "outbound";
export type SenderType = "lead" | "bot" | "human" | "system";
export type AutomationJobType =
  | "same_day_reminder"
  | "no_reply_follow_up"
  | "monthly_nurture";
export type AutomationTriggerSource = "scheduler" | "manual";
export type AutomationRunStatus = "completed" | "failed";
export type BroadcastCampaignStatus =
  | "scheduled"
  | "running"
  | "completed"
  | "completed_with_errors"
  | "cancelled"
  | "halted";
export type BroadcastCampaignJobStatus =
  | "pending"
  | "processing"
  | "sent"
  | "failed"
  | "skipped"
  | "cancelled";
export type BroadcastCampaignTriggerSource = "scheduler" | "manual";
export type BroadcastCampaignRunStatus = "completed" | "failed";
export type BroadcastDeliveryType = "send_now" | "scheduled";
export type BroadcastSegmentField =
  | "status"
  | "source"
  | "campaign_name"
  | "treatment_interest"
  | "assigned_user_id"
  | "bot_mode"
  | "automation_enabled"
  | "unread_state"
  | "appointment_state";

export interface BroadcastSegmentFilter {
  id: string;
  field: BroadcastSegmentField;
  values: string[];
}

export interface BroadcastManualRecipientInput {
  phone_e164: string;
  full_name?: string;
  treatment_interest?: string;
}

export interface BroadcastSegmentOption {
  value: string;
  label: string;
  count: number;
}

export interface BroadcastSegmentFieldOptionGroup {
  field: BroadcastSegmentField;
  label: string;
  description: string;
  options: BroadcastSegmentOption[];
}

export interface Message {
  id: string;
  contact_id: string;
  conversation_id?: string | null;
  provider_message_id?: string | null;
  direction: MessageDirection;
  sender_type: SenderType;
  content: string;
  created_at: string;
  ai_generated: boolean;
  ai_confidence?: number;
}

export interface StaffMember {
  id: string;
  clinic_id: string;
  full_name: string;
  email: string;
  role: StaffRole;
  status: StaffStatus;
  invited_at?: string | null;
  disabled_at?: string | null;
  created_at: string;
}

export interface ClinicUsageSummary {
  active_contacts: number;
  contact_limit: number;
  contact_limit_reached: boolean;
  contact_utilization_pct: number;
  monthly_outbound_messages: number;
  monthly_message_limit: number;
  monthly_message_limit_reached: boolean;
  monthly_message_utilization_pct: number;
  billing_cycle_start: string | null;
  billing_cycle_end: string | null;
}

export interface ClinicSettings {
  id: string;
  name: string;
  clinic_type: ClinicType;
  plan_type: PlanType;
  subscription_status: SubscriptionStatus;
  payment_status: PaymentStatus;
  whatsapp_status: WhatsappStatus;
  whatsapp_number: string;
  owner_name?: string | null;
  owner_phone?: string | null;
  clinic_prompt?: string | null;
  payment_received_at?: string | null;
  billing_cycle_anchor?: string | null;
  whatsapp_connected_at?: string | null;
  onboarding_completed_at?: string | null;
  evolution_api_url?: string | null;
  evolution_api_key?: string | null;
  evolution_instance_name?: string | null;
  n8n_webhook_url?: string | null;
  webhook_secret?: string | null;
  support_whatsapp_number?: string | null;
  can_manage_workspace?: boolean;
  usage: ClinicUsageSummary;
}

export type LaunchStatusCardState =
  | "complete"
  | "warning"
  | "blocked"
  | "unavailable";

export interface LaunchStatusCard {
  id: string;
  label: string;
  description: string;
  state: LaunchStatusCardState;
  detail: string;
}

export interface LaunchStatusGroup {
  id: string;
  title: string;
  cards: LaunchStatusCard[];
}

export interface LaunchStatusAction {
  label: string;
  href: string;
}

export interface LaunchStatus {
  groups: LaunchStatusGroup[];
  primaryAction: LaunchStatusAction | null;
  canManage: boolean;
  readOnlyHint: string | null;
  completedCount: number;
  totalCount: number;
  summary: string;
}

export interface PromptCard {
  id: string;
  label: string;
  description: string;
  count: number;
}

export interface WeeklyDigest {
  headline: string;
  summary: string;
  flags: string[];
}

export interface WhatsappConnectionState {
  clinic_id: string;
  whatsapp_status: WhatsappStatus;
  whatsapp_number?: string | null;
  instance_name?: string | null;
  is_connected: boolean;
  qr_code_data_url?: string | null;
  pairing_code?: string | null;
  last_synced_at?: string | null;
  connected_at?: string | null;
  error?: string | null;
}

export interface CsvLeadInput {
  full_name: string;
  phone_e164: string;
  treatment_interest?: string;
  source?: string;
  campaign_name?: string;
}

export interface CsvImportSummary {
  imported: number;
  deduped: number;
  invalid: number;
  blocked?: number;
}

export interface AutomationRuleConfig {
  id?: string;
  clinic_id?: string;
  rule_key: string;
  name: string;
  description: string;
  job_type: AutomationJobType;
  delay_hours: number;
  template_key?: string | null;
  template_body: string;
  is_enabled: boolean;
}

export interface AutomationRunnerRunSummary {
  id?: string;
  clinic_id?: string;
  trigger_source: AutomationTriggerSource;
  status: AutomationRunStatus;
  jobs_scanned: number;
  jobs_sent: number;
  jobs_failed: number;
  jobs_skipped: number;
  started_at: string;
  completed_at?: string | null;
  error?: string | null;
}

export interface AutomationHealthSummary {
  service_role_configured: boolean;
  runner_secret_configured: boolean;
  can_manage_automation: boolean;
  pending_jobs: number;
  overdue_jobs: number;
  failed_jobs: number;
  last_run: AutomationRunnerRunSummary | null;
  schema_warning?: string | null;
}

export interface AutomationSettingsPayload {
  rules: AutomationRuleConfig[];
  health: AutomationHealthSummary;
}

export interface AutomationRunNowSummary {
  processed: number;
  jobs_scanned: number;
  jobs_sent: number;
  jobs_failed: number;
  jobs_skipped: number;
}

export interface BroadcastCampaign {
  id: string;
  clinic_id: string;
  name: string;
  status: BroadcastCampaignStatus;
  delivery_type: BroadcastDeliveryType;
  message_template: string;
  segment_filters: BroadcastSegmentFilter[];
  scheduled_for: string;
  daily_send_cap: number;
  stop_on_invalid_number: boolean;
  total_recipients: number;
  pending_count: number;
  sent_count: number;
  failed_count: number;
  skipped_count: number;
  cancelled_count: number;
  invalid_count: number;
  replied_count: number;
  delivered_count: number;
  read_count: number;
  clicked_count: number;
  opted_out_count: number;
  created_by_user_id?: string | null;
  created_by_name?: string | null;
  last_error?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface BroadcastCampaignAnalytics {
  total_campaigns: number;
  scheduled_campaigns: number;
  running_campaigns: number;
  completed_campaigns: number;
  halted_campaigns: number;
  total_recipients: number;
  total_sent: number;
  total_failed: number;
  total_skipped: number;
  total_cancelled: number;
  total_invalid: number;
  total_replies: number;
  total_delivered: number;
  total_read: number;
  total_clicked: number;
  total_opted_out: number;
}

export interface BroadcastCampaignFunnel {
  total_recipients: number;
  sent: number;
  delivered: number;
  read: number;
  replied: number;
  clicked: number;
  opted_out: number;
  failed: number;
  skipped: number;
  cancelled: number;
  invalid: number;
  delivery_rate: number;
  read_rate: number;
  reply_rate: number;
  click_through_rate: number;
  opt_out_rate: number;
}

export interface BroadcastCampaignRecipientRow {
  job_id: string;
  contact_id: string;
  contact_name: string | null;
  contact_phone: string | null;
  status: BroadcastCampaignJobStatus;
  scheduled_for: string | null;
  sent_at: string | null;
  delivered_at: string | null;
  read_at: string | null;
  first_reply_at: string | null;
  reply_count: number;
  click_count: number;
  last_clicked_at: string | null;
  opted_out_at: string | null;
  failure_code: string | null;
  last_error: string | null;
}

export interface BroadcastCampaignDetailPayload {
  campaign: BroadcastCampaign;
  funnel: BroadcastCampaignFunnel;
  recipients: BroadcastCampaignRecipientRow[];
  links: Array<{
    id: string;
    short_code: string;
    target_url: string;
    total_clicks: number;
    unique_clicks: number;
  }>;
}

export interface BroadcastCampaignRunnerRunSummary {
  id?: string;
  clinic_id?: string;
  trigger_source: BroadcastCampaignTriggerSource;
  status: BroadcastCampaignRunStatus;
  jobs_scanned: number;
  jobs_sent: number;
  jobs_failed: number;
  jobs_skipped: number;
  jobs_cancelled: number;
  started_at: string;
  completed_at?: string | null;
  error?: string | null;
}

export interface BroadcastCampaignHealthSummary {
  service_role_configured: boolean;
  runner_secret_configured: boolean;
  can_manage_campaigns: boolean;
  pending_jobs: number;
  overdue_jobs: number;
  failed_jobs: number;
  last_run: BroadcastCampaignRunnerRunSummary | null;
  schema_warning?: string | null;
}

export interface BroadcastCampaignListPayload {
  campaigns: BroadcastCampaign[];
  analytics: BroadcastCampaignAnalytics;
  health: BroadcastCampaignHealthSummary;
}

export interface BroadcastCampaignCreatePayload {
  name: string;
  delivery_type: BroadcastDeliveryType;
  message_template: string;
  segment_filters: BroadcastSegmentFilter[];
  manual_recipients?: BroadcastManualRecipientInput[];
  scheduled_for?: string | null;
  daily_send_cap: number;
  stop_on_invalid_number: boolean;
}

export interface BroadcastCampaignRunNowSummary {
  processed: number;
  jobs_scanned: number;
  jobs_sent: number;
  jobs_failed: number;
  jobs_skipped: number;
  jobs_cancelled: number;
}

export interface ContactMemoryRunSummary {
  processed: number;
  jobs_scanned: number;
  jobs_completed: number;
  jobs_failed: number;
  jobs_skipped: number;
}

export interface ContactMemoryBackfillSummary {
  queued: number;
  skipped: number;
}
