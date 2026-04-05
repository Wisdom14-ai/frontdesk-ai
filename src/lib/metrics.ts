import type { PromptCard, WeeklyDigest } from "@/types";

export interface MetricMessageRow {
  contact_id: string;
  direction: "inbound" | "outbound";
  sender_type: "lead" | "bot" | "human" | "system";
  created_at: string;
}

export interface MetricContactRow {
  id: string;
  full_name: string;
  current_status: string;
  bot_mode?: string | null;
  unread_count?: number | null;
  created_at: string;
}

export interface MetricRevenueRow {
  contact_id: string;
  amount: number;
  created_at: string;
}

export interface MetricAutomationJobRow {
  contact_id: string;
  status: string;
  scheduled_for: string;
}

export function calculateAverageResponseTime(messages: MetricMessageRow[]) {
  const grouped = new Map<string, MetricMessageRow[]>();

  for (const message of messages) {
    const bucket = grouped.get(message.contact_id) ?? [];
    bucket.push(message);
    grouped.set(message.contact_id, bucket);
  }

  const responseTimes: number[] = [];

  for (const conversation of grouped.values()) {
    conversation.sort((left, right) => new Date(left.created_at).getTime() - new Date(right.created_at).getTime());

    for (let index = 0; index < conversation.length; index += 1) {
      const message = conversation[index];
      if (message.direction !== "inbound") {
        continue;
      }

      const reply = conversation.slice(index + 1).find((candidate) => candidate.direction === "outbound");
      if (!reply) {
        continue;
      }

      const diffMs = new Date(reply.created_at).getTime() - new Date(message.created_at).getTime();
      if (diffMs >= 0) {
        responseTimes.push(diffMs / 60000);
      }
    }
  }

  if (responseTimes.length === 0) {
    return 0;
  }

  return responseTimes.reduce((sum, value) => sum + value, 0) / responseTimes.length;
}

export function calculateBotHandledRate(messages: MetricMessageRow[], contacts: MetricContactRow[]) {
  const botConversationIds = new Set(
    messages.filter((message) => message.sender_type === "bot").map((message) => message.contact_id)
  );

  if (botConversationIds.size === 0) {
    return 0;
  }

  const handoffIds = new Set(
    contacts.filter((contact) => contact.bot_mode === "handoff_required").map((contact) => contact.id)
  );

  let botHandled = 0;
  for (const contactId of botConversationIds) {
    if (!handoffIds.has(contactId)) {
      botHandled += 1;
    }
  }

  return (botHandled / botConversationIds.size) * 100;
}

export function countHumanHandoffs(contacts: MetricContactRow[]) {
  return contacts.filter((contact) => contact.bot_mode === "handoff_required").length;
}

export function buildCloseoutPrompts(input: {
  unreadBacklog: number;
  overdueFollowUps: number;
  bookedMissingOutcome: number;
  attendedMissingRevenue: number;
}): PromptCard[] {
  return [
    {
      id: "awaiting_reply",
      label: "Unread conversations",
      description: "Leads waiting for the team to open the thread.",
      count: input.unreadBacklog,
    },
    {
      id: "follow_up_due",
      label: "Overdue follow-ups",
      description: "Automation jobs that are already due and still pending.",
      count: input.overdueFollowUps,
    },
    {
      id: "booked_missing_outcome",
      label: "Booked visits missing outcome",
      description: "Appointments that still need attended/no-show confirmation.",
      count: input.bookedMissingOutcome,
    },
    {
      id: "attended_missing_revenue",
      label: "Attended visits missing revenue",
      description: "Completed visits that still need revenue logged.",
      count: input.attendedMissingRevenue,
    },
  ];
}

export function buildWeeklyDigest(input: {
  totalLeads: number;
  booked: number;
  attended: number;
  totalRevenue: number;
  avgResponseTime: number;
  overdueFollowUps: number;
  handoffCount: number;
}): WeeklyDigest {
  const bookingRate = input.totalLeads > 0 ? (input.booked / input.totalLeads) * 100 : 0;
  const attendanceRate = input.booked > 0 ? (input.attended / input.booked) * 100 : 0;
  const flags: string[] = [];

  if (input.avgResponseTime > 15) {
    flags.push("Average reply time is above 15 minutes.");
  }
  if (input.overdueFollowUps > 0) {
    flags.push(`${input.overdueFollowUps} follow-up jobs are overdue.`);
  }
  if (input.handoffCount > 5) {
    flags.push("Human handoff volume is high. Review bot prompts or escalation rules.");
  }
  if (flags.length === 0) {
    flags.push("No critical retention risks were detected this week.");
  }

  return {
    headline: `${input.attended} attended visits from ${input.totalLeads} tracked leads`,
    summary: `Booking rate ${bookingRate.toFixed(1)}%, attendance rate ${attendanceRate.toFixed(1)}%, revenue MYR ${input.totalRevenue.toFixed(2)}.`,
    flags,
  };
}
