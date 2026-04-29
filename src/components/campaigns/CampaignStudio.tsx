"use client";

import { useMemo, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import {
  DndContext,
  PointerSensor,
  closestCorners,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  Activity,
  CalendarClock,
  Clock3,
  GripVertical,
  Loader2,
  Megaphone,
  Play,
  ShieldAlert,
  ShieldCheck,
  TriangleAlert,
  UserPlus,
  X,
} from "lucide-react";

import {
  APPOINTMENT_STATE_OPTIONS,
  AUTOMATION_STATE_OPTIONS,
  BOT_MODE_OPTIONS,
  CONTACT_STATUS_OPTIONS,
  UNASSIGNED_SEGMENT_VALUE,
  UNREAD_STATE_OPTIONS,
  buildBroadcastTemplateMessage,
  buildCampaignFieldGroups,
  doesRecordMatchBroadcastFilters,
  getContactStatusLabel,
  getDynamicSegmentLabel,
  getBroadcastSegmentFieldLabel,
  normalizeDynamicSegmentValue,
  toRawContactStatus,
} from "@/lib/campaigns";
import {
  cancelCampaign,
  createCampaign,
  runCampaignsNow,
  useCampaigns,
  useContacts,
  useStaff,
} from "@/lib/supabase/hooks";
import { useAppStore } from "@/store";
import type {
  BroadcastCampaign,
  BroadcastManualRecipientInput,
  BroadcastSegmentFilter,
  BroadcastSegmentOption,
  Lead,
  StaffMember,
} from "@/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

interface SegmentGroup {
  field: BroadcastSegmentFilter["field"];
  label: string;
  description: string;
  options: BroadcastSegmentOption[];
}

function getRelativeTimeLabel(value?: string | null) {
  if (!value) {
    return "No runner activity yet";
  }

  return formatDistanceToNow(new Date(value), { addSuffix: true });
}

function formatSchedule(value: string) {
  return new Intl.DateTimeFormat("en-MY", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function normalizeManualPhoneInput(input: string) {
  let digitsOnly = input.replace(/\D/g, "");
  if (!digitsOnly) {
    return "";
  }

  if (digitsOnly.startsWith("00")) {
    digitsOnly = digitsOnly.slice(2);
  }

  if (digitsOnly.startsWith("60")) {
    return `+${digitsOnly}`;
  }

  if (digitsOnly.startsWith("0")) {
    return `+60${digitsOnly.slice(1)}`;
  }

  return `+${digitsOnly}`;
}

function cleanOptionalManualValue(value?: string) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function parseManualRecipients(value: string): {
  recipients: BroadcastManualRecipientInput[];
  invalidLines: string[];
} {
  const recipientsByPhone = new Map<string, BroadcastManualRecipientInput>();
  const invalidLines: string[] = [];

  value.split(/\r?\n/).forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (!line) {
      return;
    }

    const [phonePart = "", namePart, treatmentPart] = line
      .split(",")
      .map((part) => part.trim());
    const phone = normalizeManualPhoneInput(phonePart);
    const digits = phone.replace(/\D/g, "");

    if (digits.length < 8 || digits.length > 15) {
      invalidLines.push(`Line ${index + 1}: ${line}`);
      return;
    }

    const existing = recipientsByPhone.get(phone);
    recipientsByPhone.set(phone, {
      phone_e164: phone,
      full_name: existing?.full_name ?? cleanOptionalManualValue(namePart),
      treatment_interest:
        existing?.treatment_interest ?? cleanOptionalManualValue(treatmentPart),
    });
  });

  return {
    recipients: [...recipientsByPhone.values()],
    invalidLines,
  };
}

function getStatusTone(status: BroadcastCampaign["status"]) {
  switch (status) {
    case "completed":
      return "bg-emerald-500/10 text-emerald-700 border-emerald-500/20";
    case "completed_with_errors":
      return "bg-amber-500/10 text-amber-700 border-amber-500/20";
    case "halted":
      return "bg-rose-500/10 text-rose-700 border-rose-500/20";
    case "cancelled":
      return "bg-slate-500/10 text-slate-700 border-slate-500/20";
    case "running":
      return "bg-sky-500/10 text-sky-700 border-sky-500/20";
    case "scheduled":
    default:
      return "bg-violet-500/10 text-violet-700 border-violet-500/20";
  }
}

function getCampaignStatusLabel(status: BroadcastCampaign["status"]) {
  switch (status) {
    case "completed_with_errors":
      return "Completed w/ Errors";
    case "halted":
      return "Halted";
    case "scheduled":
      return "Scheduled";
    case "running":
      return "Running";
    case "completed":
      return "Completed";
    case "cancelled":
      return "Cancelled";
    default:
      return status;
  }
}

function toLeadRecord(lead: Lead) {
  return {
    current_status: toRawContactStatus(lead.status),
    source: lead.source ?? null,
    campaign_name: lead.campaign_name ?? null,
    treatment_interest: lead.treatment_interest ?? null,
    assigned_user_id: lead.assigned_user_id ?? null,
    bot_mode: lead.bot_mode ?? null,
    automation_enabled: lead.automation_enabled ?? true,
    unread_count: lead.unread_count,
    appointment_date: lead.appointment_date ?? null,
  };
}

function buildSegmentGroups(leads: Lead[], staff: StaffMember[]): SegmentGroup[] {
  const countMatches = (predicate: (lead: Lead) => boolean) =>
    leads.reduce((count, lead) => count + (predicate(lead) ? 1 : 0), 0);

  const sourceCounts = new Map<string, number>();
  const campaignCounts = new Map<string, number>();
  const treatmentCounts = new Map<string, number>();

  for (const lead of leads) {
    const sourceValue = normalizeDynamicSegmentValue(lead.source ?? null);
    sourceCounts.set(sourceValue, (sourceCounts.get(sourceValue) ?? 0) + 1);

    const campaignValue = normalizeDynamicSegmentValue(lead.campaign_name ?? null);
    campaignCounts.set(campaignValue, (campaignCounts.get(campaignValue) ?? 0) + 1);

    const treatmentValue = normalizeDynamicSegmentValue(
      lead.treatment_interest ?? null
    );
    treatmentCounts.set(treatmentValue, (treatmentCounts.get(treatmentValue) ?? 0) + 1);
  }

  return buildCampaignFieldGroups([
    {
      field: "status",
      label: "Pipeline Status",
      description: "Target leads by their CRM stage.",
      options: CONTACT_STATUS_OPTIONS.map((option) => ({
        value: option.value,
        label: option.label,
        count: countMatches((lead) => toRawContactStatus(lead.status) === option.value),
      })).filter((option) => option.count > 0),
    },
    {
      field: "source",
      label: "Lead Source",
      description: "Target Facebook, referral, Google, and other sources.",
      options: [...sourceCounts.entries()]
        .map(([value, count]) => ({
          value,
          label: getDynamicSegmentLabel(value, "No Source"),
          count,
        }))
        .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label)),
    },
    {
      field: "campaign_name",
      label: "Campaign",
      description: "Reuse the campaign names already stored on leads.",
      options: [...campaignCounts.entries()]
        .map(([value, count]) => ({
          value,
          label: getDynamicSegmentLabel(value, "No Campaign"),
          count,
        }))
        .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label)),
    },
    {
      field: "treatment_interest",
      label: "Treatment Interest",
      description: "Group by braces, whitening, skin treatment, and more.",
      options: [...treatmentCounts.entries()]
        .map(([value, count]) => ({
          value,
          label: getDynamicSegmentLabel(value, "No Treatment"),
          count,
        }))
        .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label)),
    },
    {
      field: "assigned_user_id",
      label: "Assigned Staff",
      description: "Target leads owned by a specific staff member.",
      options: [
        ...staff.map((member) => ({
          value: member.id,
          label: member.full_name,
          count: countMatches((lead) => lead.assigned_user_id === member.id),
        })),
        {
          value: UNASSIGNED_SEGMENT_VALUE,
          label: "Unassigned",
          count: countMatches((lead) => !lead.assigned_user_id),
        },
      ].filter((option) => option.count > 0),
    },
    {
      field: "bot_mode",
      label: "Bot Mode",
      description: "Target active, paused, or handoff-required leads.",
      options: BOT_MODE_OPTIONS.map((option) => ({
        value: option.value,
        label: option.label,
        count: countMatches((lead) => lead.bot_mode === option.value),
      })).filter((option) => option.count > 0),
    },
    {
      field: "automation_enabled",
      label: "Automation State",
      description: "Split between automation-enabled and disabled leads.",
      options: AUTOMATION_STATE_OPTIONS.map((option) => ({
        value: option.value,
        label: option.label,
        count: countMatches((lead) =>
          option.value === "enabled"
            ? lead.automation_enabled !== false
            : lead.automation_enabled === false
        ),
      })).filter((option) => option.count > 0),
    },
    {
      field: "unread_state",
      label: "Unread State",
      description: "Broadcast only to read or unread conversations.",
      options: UNREAD_STATE_OPTIONS.map((option) => ({
        value: option.value,
        label: option.label,
        count: countMatches((lead) =>
          option.value === "unread" ? lead.unread_count > 0 : lead.unread_count <= 0
        ),
      })).filter((option) => option.count > 0),
    },
    {
      field: "appointment_state",
      label: "Appointment State",
      description: "Target contacts with or without an appointment.",
      options: APPOINTMENT_STATE_OPTIONS.map((option) => ({
        value: option.value,
        label: option.label,
        count: countMatches((lead) =>
          option.value === "has_appointment"
            ? Boolean(lead.appointment_date)
            : !lead.appointment_date
        ),
      })).filter((option) => option.count > 0),
    },
  ]);
}

function PaletteItem({
  group,
  onAdd,
}: {
  group: SegmentGroup;
  onAdd: (field: BroadcastSegmentFilter["field"]) => void;
}) {
  const isSelectable = group.options.length > 0;
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `palette:${group.field}`,
    disabled: !isSelectable,
  });

  return (
    <button
      ref={setNodeRef}
      type="button"
      {...listeners}
      {...attributes}
      disabled={!isSelectable}
      onClick={() => onAdd(group.field)}
      aria-label={`Add ${group.label} segment`}
      className={`flex w-full items-start gap-3 rounded-xl border px-4 py-3 text-left transition-colors ${
        !isSelectable
          ? "cursor-not-allowed border-border/50 bg-muted/20 text-muted-foreground"
          : "cursor-grab border-border/60 bg-card hover:border-emerald-500/40 hover:bg-emerald-500/5 active:cursor-grabbing"
      } ${isDragging ? "opacity-60" : ""}`}
    >
      <GripVertical className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      <div>
        <p className="text-sm font-medium text-foreground">{group.label}</p>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          {group.description}
        </p>
        <p className="mt-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-600">
          {group.options.length} selectable values
        </p>
      </div>
    </button>
  );
}

function SelectedFilterCard({
  filter,
  group,
  onToggleValue,
  onRemove,
}: {
  filter: BroadcastSegmentFilter;
  group: SegmentGroup;
  onToggleValue: (field: BroadcastSegmentFilter["field"], value: string) => void;
  onRemove: (field: BroadcastSegmentFilter["field"]) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({
    id: `selected:${filter.field}`,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="rounded-2xl border border-border/60 bg-card p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <button
            type="button"
            {...listeners}
            {...attributes}
            className="mt-0.5 rounded-lg border border-border/60 p-1.5 text-muted-foreground"
          >
            <GripVertical className="h-4 w-4" />
          </button>
          <div>
            <p className="text-sm font-semibold text-foreground">{group.label}</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              {group.description}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => onRemove(filter.field)}
          className="rounded-lg border border-border/60 p-1.5 text-muted-foreground transition-colors hover:border-rose-500/30 hover:bg-rose-500/10 hover:text-rose-600"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        {group.options.map((option) => {
          const checked = filter.values.includes(option.value);
          return (
            <label
              key={option.value}
              className={`flex items-center justify-between gap-3 rounded-xl border px-3 py-2 text-sm transition-colors ${
                checked
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700"
                  : "border-border/60 bg-background text-foreground"
              }`}
            >
              <span className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => onToggleValue(filter.field, option.value)}
                  className="h-4 w-4 rounded border-border accent-emerald-500"
                />
                <span>{option.label}</span>
              </span>
              <span className="text-xs text-muted-foreground">{option.count}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

export function CampaignStudio() {
  const leads = useAppStore((state) => state.leads);
  useContacts();
  const { staff } = useStaff();
  const { campaigns, analytics, health, loading, error, fetchCampaigns } = useCampaigns();

  const [campaignName, setCampaignName] = useState("");
  const [messageTemplate, setMessageTemplate] = useState(
    "Hi {{contact_name}}, we are reaching out about {{treatment_interest}}. Reply here if you would like our team to help."
  );
  const [deliveryType, setDeliveryType] = useState<"send_now" | "scheduled">("send_now");
  const [scheduledForLocal, setScheduledForLocal] = useState("");
  const [dailySendCap, setDailySendCap] = useState(100);
  const [selectedFilters, setSelectedFilters] = useState<BroadcastSegmentFilter[]>([]);
  const [manualRecipientsText, setManualRecipientsText] = useState("");
  const [feedback, setFeedback] = useState<{
    type: "success" | "error" | "info";
    message: string;
  } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [runningDue, setRunningDue] = useState(false);

  const segmentGroups = useMemo(() => buildSegmentGroups(leads, staff), [leads, staff]);
  const segmentGroupMap = useMemo(
    () => new Map(segmentGroups.map((group) => [group.field, group])),
    [segmentGroups]
  );
  const previewLeads = useMemo(
    () =>
      selectedFilters.length > 0
        ? leads.filter((lead) =>
            doesRecordMatchBroadcastFilters(toLeadRecord(lead), selectedFilters)
          )
        : [],
    [leads, selectedFilters]
  );
  const manualRecipientPreview = useMemo(
    () => parseManualRecipients(manualRecipientsText),
    [manualRecipientsText]
  );
  const manualRecipients = manualRecipientPreview.recipients;
  const totalAudienceCount = previewLeads.length + manualRecipients.length;
  const previewMessage = useMemo(
    () =>
      buildBroadcastTemplateMessage({
        template: messageTemplate,
        contactName: previewLeads[0]?.full_name ?? manualRecipients[0]?.full_name,
        treatmentInterest:
          previewLeads[0]?.treatment_interest ?? manualRecipients[0]?.treatment_interest,
      }),
    [manualRecipients, messageTemplate, previewLeads]
  );
  const paletteGroups = segmentGroups.filter(
    (group) => !selectedFilters.some((filter) => filter.field === group.field)
  );
  const builderDays = Math.max(
    1,
    Math.ceil(totalAudienceCount / Math.max(1, dailySendCap))
  );

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    })
  );
  const { setNodeRef: setBuilderDropRef, isOver } = useDroppable({
    id: "builder-dropzone",
  });

  const addFilter = (field: BroadcastSegmentFilter["field"]) => {
    const group = segmentGroupMap.get(field);
    if (!group || group.options.length === 0) {
      return;
    }

    setSelectedFilters((current) => {
      if (current.some((filter) => filter.field === field)) {
        return current;
      }

      return [...current, { id: `segment-${field}`, field, values: [group.options[0].value] }];
    });
  };

  const removeFilter = (field: BroadcastSegmentFilter["field"]) => {
    setSelectedFilters((current) => current.filter((filter) => filter.field !== field));
  };

  const toggleFilterValue = (field: BroadcastSegmentFilter["field"], value: string) => {
    setSelectedFilters((current) =>
      current.map((filter) =>
        filter.field !== field
          ? filter
          : {
              ...filter,
              values: filter.values.includes(value)
                ? filter.values.filter((entry) => entry !== value)
                : [...filter.values, value],
            }
      )
    );
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const activeId = String(event.active.id);
    const overId = event.over ? String(event.over.id) : null;

    if (activeId.startsWith("palette:")) {
      const field = activeId.replace("palette:", "") as BroadcastSegmentFilter["field"];
      if (overId === "builder-dropzone" || overId?.startsWith("selected:")) {
        addFilter(field);
      }
      return;
    }

    if (
      activeId.startsWith("selected:") &&
      overId?.startsWith("selected:") &&
      activeId !== overId
    ) {
      const activeField = activeId.replace("selected:", "");
      const overField = overId.replace("selected:", "");
      const activeIndex = selectedFilters.findIndex((filter) => filter.field === activeField);
      const overIndex = selectedFilters.findIndex((filter) => filter.field === overField);

      if (activeIndex >= 0 && overIndex >= 0) {
        setSelectedFilters((current) => arrayMove(current, activeIndex, overIndex));
      }
    }
  };

  const handleCreateCampaign = async () => {
    if (!campaignName.trim()) {
      setFeedback({ type: "error", message: "Campaign name is required." });
      return;
    }

    if (!messageTemplate.trim()) {
      setFeedback({ type: "error", message: "Broadcast message is required." });
      return;
    }

    if (selectedFilters.some((filter) => filter.values.length === 0)) {
      setFeedback({ type: "error", message: "Every selected CRM segment needs at least one value." });
      return;
    }

    if (manualRecipientPreview.invalidLines.length > 0) {
      setFeedback({
        type: "error",
        message: `Fix invalid manual numbers first: ${manualRecipientPreview.invalidLines
          .slice(0, 3)
          .join("; ")}`,
      });
      return;
    }

    if (selectedFilters.length === 0 && manualRecipients.length === 0) {
      setFeedback({ type: "error", message: "Add at least one CRM segment or manual WhatsApp number." });
      return;
    }

    if (previewLeads.length === 0 && manualRecipients.length === 0) {
      setFeedback({ type: "error", message: "No contacts match the selected segments." });
      return;
    }

    if (deliveryType === "scheduled" && !scheduledForLocal) {
      setFeedback({ type: "error", message: "Pick a scheduled date and time." });
      return;
    }

    setSubmitting(true);
    setFeedback(null);

    const result = await createCampaign({
      name: campaignName.trim(),
      delivery_type: deliveryType,
      message_template: messageTemplate.trim(),
      segment_filters: selectedFilters,
      manual_recipients: manualRecipients,
      scheduled_for:
        deliveryType === "scheduled" ? new Date(scheduledForLocal).toISOString() : null,
      daily_send_cap: Math.max(1, Math.round(dailySendCap || 1)),
      stop_on_invalid_number: true,
    });

    if ("error" in result) {
      setFeedback({ type: "error", message: result.error || "Failed to create the campaign." });
    } else {
      setCampaignName("");
      setSelectedFilters([]);
      setManualRecipientsText("");
      setScheduledForLocal("");
      setFeedback({
        type: "success",
        message:
          deliveryType === "send_now"
            ? `Campaign created. ${result.summary?.jobs_sent ?? 0} messages were sent immediately.`
            : "Campaign scheduled successfully.",
      });
      await fetchCampaigns();
    }

    setSubmitting(false);
  };

  const handleCancelCampaign = async (campaignId: string) => {
    if (!window.confirm("Cancel this campaign and stop its pending recipients?")) {
      return;
    }

    const result = await cancelCampaign(campaignId);
    if ("error" in result) {
      setFeedback({ type: "error", message: result.error || "Failed to cancel the campaign." });
      return;
    }

    setFeedback({ type: "success", message: "Campaign cancelled." });
    await fetchCampaigns();
  };

  const handleRunDueCampaigns = async () => {
    setRunningDue(true);
    setFeedback(null);
    const result = await runCampaignsNow();

    if ("error" in result) {
      setFeedback({ type: "error", message: result.error || "Failed to process due campaigns." });
    } else {
      setFeedback({
        type: "success",
        message: `Runner checked ${result.jobs_scanned} due jobs and sent ${result.jobs_sent} messages.`,
      });
      await fetchCampaigns();
    }

    setRunningDue(false);
  };

  return (
    <div className="flex-1 overflow-auto">
      <div className="px-8 pt-6 pb-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Campaigns</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Build segmented broadcasts, preview the audience, and track delivery analytics from one place.
            </p>
          </div>

          <Button
            onClick={handleRunDueCampaigns}
            disabled={runningDue}
            className="gap-2 bg-emerald-500 text-white hover:bg-emerald-600"
          >
            {runningDue ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            Process Due Campaigns
          </Button>
        </div>
      </div>

      <div className="space-y-6 px-8 pb-8">
        {feedback ? (
          <div
            className={`rounded-2xl border px-4 py-3 text-sm ${
              feedback.type === "success"
                ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-700"
                : feedback.type === "error"
                  ? "border-rose-500/20 bg-rose-500/10 text-rose-700"
                  : "border-border/60 bg-muted/30 text-muted-foreground"
            }`}
          >
            {feedback.message}
          </div>
        ) : null}

        {error ? (
          <div className="rounded-2xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-700">
            {error}
          </div>
        ) : null}

        {health && !health.service_role_configured ? (
          <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-700">
            `SUPABASE_SERVICE_ROLE_KEY` is required for VPS-scheduled campaign delivery.
          </div>
        ) : null}

        {health && !health.runner_secret_configured ? (
          <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-700">
            Configure `CAMPAIGN_RUNNER_SECRET`, `AUTOMATION_RUNNER_SECRET`, or `CRON_SECRET` before exposing the runner endpoint.
          </div>
        ) : null}

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
          <div className="rounded-2xl border border-border/60 bg-card p-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Megaphone className="h-4 w-4 text-emerald-500" />
              Campaigns
            </div>
            <p className="mt-2 text-2xl font-semibold text-foreground">{loading ? "..." : analytics?.total_campaigns ?? 0}</p>
          </div>
          <div className="rounded-2xl border border-border/60 bg-card p-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <CalendarClock className="h-4 w-4 text-violet-500" />
              Scheduled
            </div>
            <p className="mt-2 text-2xl font-semibold text-foreground">{loading ? "..." : analytics?.scheduled_campaigns ?? 0}</p>
          </div>
          <div className="rounded-2xl border border-border/60 bg-card p-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Activity className="h-4 w-4 text-sky-500" />
              Sent
            </div>
            <p className="mt-2 text-2xl font-semibold text-foreground">{loading ? "..." : analytics?.total_sent ?? 0}</p>
          </div>
          <div className="rounded-2xl border border-border/60 bg-card p-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Activity className="h-4 w-4 text-emerald-500" />
              Replies
            </div>
            <p className="mt-2 text-2xl font-semibold text-foreground">{loading ? "..." : analytics?.total_replies ?? 0}</p>
          </div>
          <div className="rounded-2xl border border-border/60 bg-card p-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <TriangleAlert className="h-4 w-4 text-amber-500" />
              Failed/Skipped
            </div>
            <p className="mt-2 text-2xl font-semibold text-foreground">
              {loading ? "..." : (analytics?.total_failed ?? 0) + (analytics?.total_skipped ?? 0)}
            </p>
          </div>
          <div className="rounded-2xl border border-border/60 bg-card p-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <ShieldAlert className="h-4 w-4 text-rose-500" />
              Invalid
            </div>
            <p className="mt-2 text-2xl font-semibold text-foreground">{loading ? "..." : analytics?.total_invalid ?? 0}</p>
          </div>
        </section>

        <section className="grid gap-6 xl:grid-cols-[1.08fr_0.92fr]">
          <div className="rounded-2xl border border-border/40 bg-card p-6">
            <h2 className="font-semibold text-foreground">Broadcast Builder</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Drag CRM segments into the builder, choose values, then send now or schedule later.
            </p>

            <div className="mt-6 grid gap-4 md:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground">Campaign name</label>
                <Input value={campaignName} onChange={(event) => setCampaignName(event.target.value)} placeholder="April Whitening Follow-up" />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground">Daily send cap</label>
                <Input type="number" min={1} value={dailySendCap} onChange={(event) => setDailySendCap(Math.max(1, Number(event.target.value || 1)))} />
              </div>
            </div>

            <DndContext sensors={sensors} collisionDetection={closestCorners} onDragEnd={handleDragEnd}>
              <div className="mt-6 grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
                <div className="space-y-3">
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">Segment Palette</h3>
                    <p className="mt-1 text-xs text-muted-foreground">Drag or click a segment to add it.</p>
                  </div>
                  {paletteGroups.map((group) => (
                    <PaletteItem key={group.field} group={group} onAdd={addFilter} />
                  ))}
                </div>

                <div>
                  <h3 className="text-sm font-semibold text-foreground">Selected Segments</h3>
                  <div
                    ref={setBuilderDropRef}
                    className={`mt-3 rounded-2xl border border-dashed p-4 transition-colors ${
                      isOver ? "border-emerald-500/50 bg-emerald-500/5" : "border-border/60 bg-muted/10"
                    }`}
                  >
                    {selectedFilters.length === 0 ? (
                      <div className="rounded-xl bg-background/70 px-4 py-8 text-center text-sm text-muted-foreground">
                        Drag a segment here to start building your recipient group.
                      </div>
                    ) : (
                      <SortableContext
                        items={selectedFilters.map((filter) => `selected:${filter.field}`)}
                        strategy={verticalListSortingStrategy}
                      >
                        <div className="space-y-3">
                          {selectedFilters.map((filter) => {
                            const group = segmentGroupMap.get(filter.field);
                            return group ? (
                              <SelectedFilterCard
                                key={filter.field}
                                filter={filter}
                                group={group}
                                onToggleValue={toggleFilterValue}
                                onRemove={removeFilter}
                              />
                            ) : null;
                          })}
                        </div>
                      </SortableContext>
                    )}
                  </div>
                </div>
              </div>
            </DndContext>

            <div className="mt-6 rounded-2xl border border-border/60 bg-muted/10 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <UserPlus className="h-4 w-4 text-emerald-600" />
                    <h3 className="text-sm font-semibold text-foreground">Extra WhatsApp Numbers</h3>
                  </div>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    Add one recipient per line. Format: phone, name, treatment.
                  </p>
                </div>
                <div className="rounded-full border border-border/60 bg-background px-3 py-1 text-xs text-muted-foreground">
                  {manualRecipients.length} parsed
                </div>
              </div>
              <Textarea
                rows={4}
                value={manualRecipientsText}
                onChange={(event) => setManualRecipientsText(event.target.value)}
                placeholder={"+60123456789, Aina, Whitening\n0123456789, Farid, Braces"}
                className="mt-3"
              />
              {manualRecipientPreview.invalidLines.length > 0 ? (
                <div className="mt-3 rounded-xl border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-xs text-rose-700">
                  Invalid numbers: {manualRecipientPreview.invalidLines.slice(0, 3).join("; ")}
                </div>
              ) : (
                <p className="mt-3 text-xs leading-5 text-muted-foreground">
                  Manual recipients are saved into CRM as new leads when they do not already exist, then included in the same campaign tracking.
                </p>
              )}
            </div>

            <div className="mt-6">
              <label className="mb-1.5 block text-sm font-medium text-foreground">Broadcast message</label>
              <Textarea rows={6} value={messageTemplate} onChange={(event) => setMessageTemplate(event.target.value)} placeholder="Hi {{contact_name}}, ..." />
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span>Tokens:</span>
                <button type="button" onClick={() => setMessageTemplate((current) => current.includes("{{contact_name}}") ? current : `${current} {{contact_name}}`.trim())} className="rounded-full border border-border px-3 py-1 hover:bg-muted/50">{`{{contact_name}}`}</button>
                <button type="button" onClick={() => setMessageTemplate((current) => current.includes("{{treatment_interest}}") ? current : `${current} {{treatment_interest}}`.trim())} className="rounded-full border border-border px-3 py-1 hover:bg-muted/50">{`{{treatment_interest}}`}</button>
              </div>
            </div>

            <div className="mt-6 grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
              <div className="rounded-2xl border border-border/60 bg-muted/10 p-4">
                <h3 className="text-sm font-semibold text-foreground">Delivery</h3>
                <div className="mt-3 space-y-3">
                  <label className="flex items-start gap-3 rounded-xl border border-border/60 bg-background px-4 py-3 text-sm">
                    <input type="radio" name="deliveryType" checked={deliveryType === "send_now"} onChange={() => setDeliveryType("send_now")} className="mt-0.5 h-4 w-4 accent-emerald-500" />
                    <span>
                      <span className="block font-medium text-foreground">Send now</span>
                      <span className="mt-1 block text-xs leading-5 text-muted-foreground">Queue this campaign immediately and send the current day's capped batch right away.</span>
                    </span>
                  </label>
                  <label className="flex items-start gap-3 rounded-xl border border-border/60 bg-background px-4 py-3 text-sm">
                    <input type="radio" name="deliveryType" checked={deliveryType === "scheduled"} onChange={() => setDeliveryType("scheduled")} className="mt-0.5 h-4 w-4 accent-emerald-500" />
                    <span className="w-full">
                      <span className="block font-medium text-foreground">Schedule for later</span>
                      <span className="mt-1 block text-xs leading-5 text-muted-foreground">Use your local browser time. The VPS runner will deliver due batches automatically.</span>
                      {deliveryType === "scheduled" ? <Input type="datetime-local" value={scheduledForLocal} onChange={(event) => setScheduledForLocal(event.target.value)} className="mt-3" /> : null}
                    </span>
                  </label>
                </div>
                <div className="mt-4 rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-700">
                  Invalid-number protection is always on. One invalid WhatsApp recipient halts the remaining queued recipients in that campaign.
                </div>
                <div className="mt-3 rounded-xl border border-border/60 bg-background px-4 py-3 text-sm text-muted-foreground">
                  Opted-out and trash contacts are skipped before sending.
                </div>
              </div>

              <div className="rounded-2xl border border-border/60 bg-card p-4">
                <h3 className="text-sm font-semibold text-foreground">Audience Preview</h3>
                <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <div className="rounded-xl border border-border/60 bg-muted/10 p-4"><p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">CRM leads</p><p className="mt-2 text-2xl font-semibold text-foreground">{previewLeads.length}</p></div>
                  <div className="rounded-xl border border-border/60 bg-muted/10 p-4"><p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Manual</p><p className="mt-2 text-2xl font-semibold text-foreground">{manualRecipients.length}</p></div>
                  <div className="rounded-xl border border-border/60 bg-muted/10 p-4"><p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Total</p><p className="mt-2 text-2xl font-semibold text-foreground">{totalAudienceCount}</p></div>
                  <div className="rounded-xl border border-border/60 bg-muted/10 p-4"><p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Span</p><p className="mt-2 text-2xl font-semibold text-foreground">{builderDays} {builderDays === 1 ? "day" : "days"}</p><p className="mt-1 text-xs text-muted-foreground">{Math.max(1, dailySendCap)}/day</p></div>
                </div>
                <div className="mt-4 rounded-xl border border-border/60 bg-muted/10 p-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Sample message preview</p>
                  <p className="mt-3 text-sm leading-6 text-foreground">{previewMessage || "Your message preview will appear here."}</p>
                  {previewLeads[0] ? (
                    <p className="mt-3 text-xs text-muted-foreground">Previewing against {previewLeads[0].full_name} in {getContactStatusLabel(toRawContactStatus(previewLeads[0].status))}.</p>
                  ) : manualRecipients[0] ? (
                    <p className="mt-3 text-xs text-muted-foreground">Previewing manual recipient {manualRecipients[0].full_name ?? manualRecipients[0].phone_e164}.</p>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-border/40 pt-4">
              <p className="text-sm text-muted-foreground">
                Selected segments: {selectedFilters.length > 0 ? selectedFilters.map((filter) => getBroadcastSegmentFieldLabel(filter.field)).join(", ") : "None"} - Manual: {manualRecipients.length}
              </p>
              <Button onClick={handleCreateCampaign} disabled={submitting} className="gap-2 bg-emerald-500 text-white hover:bg-emerald-600">
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Megaphone className="h-4 w-4" />}
                {deliveryType === "send_now" ? "Create & Send" : "Schedule Campaign"}
              </Button>
            </div>
          </div>

          <div className="space-y-6">
            <div className="rounded-2xl border border-border/40 bg-card p-6">
              <h2 className="font-semibold text-foreground">Runner Health</h2>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <div className="rounded-xl border border-border/60 p-4"><div className="flex items-center gap-2 text-sm text-muted-foreground"><Clock3 className="h-4 w-4 text-sky-500" />Pending jobs</div><p className="mt-2 text-2xl font-semibold text-foreground">{health?.pending_jobs ?? 0}</p></div>
                <div className="rounded-xl border border-border/60 p-4"><div className="flex items-center gap-2 text-sm text-muted-foreground"><TriangleAlert className="h-4 w-4 text-amber-500" />Overdue now</div><p className="mt-2 text-2xl font-semibold text-foreground">{health?.overdue_jobs ?? 0}</p></div>
              </div>
              <div className="mt-4 rounded-xl border border-border/60 bg-muted/10 p-4">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">{health?.runner_secret_configured ? <ShieldCheck className="h-4 w-4 text-emerald-500" /> : <ShieldAlert className="h-4 w-4 text-rose-500" />}Last runner activity</div>
                <p className="mt-2 text-sm font-medium text-foreground">{getRelativeTimeLabel(health?.last_run?.completed_at ?? health?.last_run?.started_at)}</p>
                {health?.last_run ? <p className="mt-2 text-xs text-muted-foreground">{health.last_run.trigger_source === "manual" ? "Manual" : "Scheduler"} run, sent {health.last_run.jobs_sent}, failed {health.last_run.jobs_failed}, skipped {health.last_run.jobs_skipped}, cancelled {health.last_run.jobs_cancelled}.</p> : null}
              </div>
            </div>

            <div className="rounded-2xl border border-border/40 bg-card p-6">
              <h2 className="font-semibold text-foreground">Recent Campaigns</h2>
              <div className="mt-4 space-y-4">
                {campaigns.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-border/60 px-4 py-8 text-center text-sm text-muted-foreground">
                    No campaigns yet. Build your first broadcast from the panel on the left.
                  </div>
                ) : (
                  campaigns.map((campaign) => (
                    <div key={campaign.id} className="rounded-2xl border border-border/60 bg-muted/10 p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="text-sm font-semibold text-foreground">{campaign.name}</h3>
                            <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] ${getStatusTone(campaign.status)}`}>{getCampaignStatusLabel(campaign.status)}</span>
                          </div>
                          <p className="mt-2 text-xs text-muted-foreground">{campaign.delivery_type === "scheduled" ? "Scheduled" : "Send now"} for {formatSchedule(campaign.scheduled_for)}{campaign.created_by_name ? ` by ${campaign.created_by_name}` : ""}</p>
                        </div>
                        {(campaign.status === "scheduled" || campaign.status === "running") ? <Button variant="outline" onClick={() => void handleCancelCampaign(campaign.id)} className="border-rose-500/20 text-rose-600 hover:bg-rose-500/10 hover:text-rose-700">Cancel</Button> : null}
                      </div>
                      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
                        <div className="rounded-xl border border-border/60 bg-background p-3"><p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Recipients</p><p className="mt-2 text-lg font-semibold text-foreground">{campaign.total_recipients}</p></div>
                        <div className="rounded-xl border border-border/60 bg-background p-3"><p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Sent</p><p className="mt-2 text-lg font-semibold text-foreground">{campaign.sent_count}</p></div>
                        <div className="rounded-xl border border-border/60 bg-background p-3"><p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Replies</p><p className="mt-2 text-lg font-semibold text-foreground">{campaign.replied_count}</p></div>
                        <div className="rounded-xl border border-border/60 bg-background p-3"><p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Pending</p><p className="mt-2 text-lg font-semibold text-foreground">{campaign.pending_count}</p></div>
                        <div className="rounded-xl border border-border/60 bg-background p-3"><p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Failed</p><p className="mt-2 text-lg font-semibold text-foreground">{campaign.failed_count}</p></div>
                        <div className="rounded-xl border border-border/60 bg-background p-3"><p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Cancelled</p><p className="mt-2 text-lg font-semibold text-foreground">{campaign.cancelled_count}</p></div>
                      </div>
                      <div className="mt-4 flex flex-wrap gap-2">
                        {campaign.segment_filters.length > 0 ? (
                          campaign.segment_filters.map((filter) => (
                            <span key={`${campaign.id}-${filter.field}`} className="inline-flex items-center rounded-full border border-border/60 bg-background px-3 py-1 text-xs text-muted-foreground">
                              {getBroadcastSegmentFieldLabel(filter.field)}: {filter.values.length}
                            </span>
                          ))
                        ) : (
                          <span className="inline-flex items-center rounded-full border border-border/60 bg-background px-3 py-1 text-xs text-muted-foreground">
                            Manual numbers only
                          </span>
                        )}
                      </div>
                      {campaign.last_error ? <div className="mt-4 rounded-xl border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-xs text-rose-700">{campaign.last_error}</div> : null}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
