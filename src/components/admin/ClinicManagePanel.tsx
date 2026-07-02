"use client";

import { useActionState, useState, type ReactNode } from "react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  saveClinicCommercialAction,
  saveClinicProfileAction,
  saveClinicPromptKnowledgeAction,
  type ClinicActionState,
} from "@/app/admin/clinics/[clinicId]/actions";
import type { ClinicDrilldown } from "@/lib/server/admin-analytics";

const KNOWLEDGE_MIN_CHARS = 200;

function SaveBar({
  state,
  pending,
  label = "Save",
}: {
  state: ClinicActionState;
  pending: boolean;
  label?: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
      >
        {pending ? "Saving…" : label}
      </button>
      {state?.ok ? (
        <span className="text-sm text-emerald-600">✓ {state.message}</span>
      ) : null}
      {state && !state.ok ? (
        <span className="text-sm text-destructive">{state.message}</span>
      ) : null}
    </div>
  );
}

function PaymentToggle({ initial }: { initial: string | null }) {
  const [value, setValue] = useState<"pending" | "received">(
    initial === "received" ? "received" : "pending"
  );

  return (
    <div>
      <input type="hidden" name="payment_status" value={value} />
      <div className="inline-flex rounded-lg border border-border p-1">
        <button
          type="button"
          onClick={() => setValue("pending")}
          className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
            value === "pending"
              ? "bg-amber-500 text-white"
              : "text-muted-foreground hover:bg-muted"
          }`}
        >
          Pending
        </button>
        <button
          type="button"
          onClick={() => setValue("received")}
          className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
            value === "received"
              ? "bg-emerald-600 text-white"
              : "text-muted-foreground hover:bg-muted"
          }`}
        >
          Received
        </button>
      </div>
      <p className="mt-1.5 text-xs text-muted-foreground">
        Setting this to <strong>Received</strong> unblocks the bot and stamps the
        payment date automatically.
      </p>
    </div>
  );
}

function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
      {hint ? <span className="block text-xs text-muted-foreground">{hint}</span> : null}
    </label>
  );
}

const inputClass =
  "w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm";

function CommercialCard({ clinic }: { clinic: ClinicDrilldown["clinic"] }) {
  const [state, formAction, pending] = useActionState<ClinicActionState, FormData>(
    saveClinicCommercialAction,
    null
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Commercial &amp; billing</CardTitle>
        <CardDescription>
          Payment, subscription, plan, and per-clinic limit overrides.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="space-y-5">
          <input type="hidden" name="clinic_id" value={clinic.id} />

          <div>
            <span className="mb-2 block text-sm font-semibold">Payment status</span>
            <PaymentToggle initial={clinic.payment_status} />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Subscription status">
              <select
                name="subscription_status"
                defaultValue={clinic.subscription_status ?? "active"}
                className={inputClass}
              >
                <option value="active">active</option>
                <option value="paused">paused</option>
                <option value="cancelled">cancelled</option>
                <option value="churned">churned</option>
              </select>
            </Field>
            <Field label="Plan">
              <select
                name="plan_type"
                defaultValue={clinic.plan_type ?? "starter"}
                className={inputClass}
              >
                <option value="starter">starter</option>
                <option value="pro">pro</option>
              </select>
            </Field>
            <Field
              label="Contact limit override"
              hint="Leave blank to use the plan default."
            >
              <input
                type="number"
                name="contact_limit_override"
                defaultValue={clinic.contact_limit_override ?? ""}
                className={inputClass}
                min={0}
              />
            </Field>
            <Field
              label="Monthly message limit override"
              hint="Leave blank to use the plan default."
            >
              <input
                type="number"
                name="monthly_message_limit_override"
                defaultValue={clinic.monthly_message_limit_override ?? ""}
                className={inputClass}
                min={0}
              />
            </Field>
            <Field label="Manual monthly cost (MYR)">
              <input
                type="number"
                name="manual_monthly_cost_myr"
                defaultValue={clinic.manual_monthly_cost_myr ?? ""}
                className={inputClass}
                min={0}
                step="0.01"
              />
            </Field>
            <Field
              label="Billing cycle anchor"
              hint="Optional — defaults to the payment date."
            >
              <input
                type="date"
                name="billing_cycle_anchor"
                defaultValue={clinic.billing_cycle_anchor?.slice(0, 10) ?? ""}
                className={inputClass}
              />
            </Field>
          </div>

          <Field label="Internal notes">
            <textarea
              name="internal_notes"
              defaultValue={clinic.internal_notes ?? ""}
              rows={2}
              className={inputClass}
              placeholder="Not shown to the clinic."
            />
          </Field>

          <SaveBar state={state} pending={pending} />
        </form>
      </CardContent>
    </Card>
  );
}

function ProfileCard({ clinic }: { clinic: ClinicDrilldown["clinic"] }) {
  const [state, formAction, pending] = useActionState<ClinicActionState, FormData>(
    saveClinicProfileAction,
    null
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Clinic profile</CardTitle>
        <CardDescription>Name, type, and owner contact.</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="space-y-4">
          <input type="hidden" name="clinic_id" value={clinic.id} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Clinic name">
              <input
                name="name"
                defaultValue={clinic.name}
                className={inputClass}
                required
              />
            </Field>
            <Field label="Clinic type">
              <select
                name="clinic_type"
                defaultValue={clinic.clinic_type ?? "dental"}
                className={inputClass}
              >
                <option value="dental">dental</option>
                <option value="aesthetic">aesthetic</option>
                <option value="gp">gp</option>
                <option value="functional_medicine">functional_medicine</option>
                <option value="physio">physio</option>
              </select>
            </Field>
            <Field label="Owner name">
              <input
                name="owner_name"
                defaultValue={clinic.owner_name ?? ""}
                className={inputClass}
              />
            </Field>
            <Field label="Owner phone">
              <input
                name="owner_phone"
                defaultValue={clinic.owner_phone ?? ""}
                className={inputClass}
              />
            </Field>
          </div>
          <SaveBar state={state} pending={pending} />
        </form>
      </CardContent>
    </Card>
  );
}

function PromptKnowledgeCard({ clinic }: { clinic: ClinicDrilldown["clinic"] }) {
  const [state, formAction, pending] = useActionState<ClinicActionState, FormData>(
    saveClinicPromptKnowledgeAction,
    null
  );
  const [promptLen, setPromptLen] = useState(clinic.clinic_prompt?.length ?? 0);
  const [knowledgeLen, setKnowledgeLen] = useState(
    clinic.clinic_knowledge?.length ?? 0
  );

  const knowledgeWarn = knowledgeLen < KNOWLEDGE_MIN_CHARS;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Prompt &amp; knowledge</CardTitle>
        <CardDescription>
          Clinic knowledge is the #1 driver of reply quality. Keep it detailed.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="space-y-4">
          <input type="hidden" name="clinic_id" value={clinic.id} />

          <Field label={`Clinic prompt (${promptLen} chars)`}>
            <textarea
              name="clinic_prompt"
              defaultValue={clinic.clinic_prompt ?? ""}
              onChange={(e) => setPromptLen(e.target.value.length)}
              rows={5}
              className={inputClass}
              placeholder="Extra instructions for the assistant's tone and behaviour."
            />
          </Field>

          <div>
            <label className="block space-y-1">
              <span className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">
                  Clinic knowledge ({knowledgeLen} chars)
                </span>
                {knowledgeWarn ? (
                  <span className="text-xs font-semibold text-destructive">
                    ⚠ {knowledgeLen === 0 ? "Empty" : `Under ${KNOWLEDGE_MIN_CHARS} chars`}
                  </span>
                ) : (
                  <span className="text-xs text-emerald-600">✓ Looks good</span>
                )}
              </span>
              <textarea
                name="clinic_knowledge"
                defaultValue={clinic.clinic_knowledge ?? ""}
                onChange={(e) => setKnowledgeLen(e.target.value.length)}
                rows={10}
                className={`w-full rounded-md border bg-background px-3 py-1.5 text-sm ${
                  knowledgeWarn ? "border-destructive" : "border-border"
                }`}
                placeholder="Services, prices, hours, address, promotions, FAQs — everything the bot should know."
              />
            </label>
            {knowledgeWarn ? (
              <p className="mt-1 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
                The bot will give generic, low-quality answers until this is
                filled with real clinic details (aim for well over{" "}
                {KNOWLEDGE_MIN_CHARS} characters).
              </p>
            ) : null}
          </div>

          <SaveBar state={state} pending={pending} />
        </form>
      </CardContent>
    </Card>
  );
}

export function ClinicManagePanel({
  clinic,
}: {
  clinic: ClinicDrilldown["clinic"];
}) {
  return (
    <div className="space-y-6">
      <CommercialCard clinic={clinic} />
      <ProfileCard clinic={clinic} />
      <PromptKnowledgeCard clinic={clinic} />
    </div>
  );
}
