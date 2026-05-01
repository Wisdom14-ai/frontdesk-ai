"use client";

import { useEffect, useState } from "react";

interface ClinicInfo {
  id: string;
  name: string;
  clinic_type: string;
  owner_name?: string | null;
  owner_phone?: string | null;
  plan_type: string;
}

interface ClinicInfoTabProps {
  clinic: ClinicInfo | null;
  onReload: () => void;
}

export function ClinicInfoTab({ clinic, onReload }: ClinicInfoTabProps) {
  const [name, setName] = useState("");
  const [clinicType, setClinicType] = useState("dental");
  const [ownerName, setOwnerName] = useState("");
  const [ownerPhone, setOwnerPhone] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setName(clinic?.name ?? "");
    setClinicType(clinic?.clinic_type ?? "dental");
    setOwnerName(clinic?.owner_name ?? "");
    setOwnerPhone(clinic?.owner_phone ?? "");
  }, [clinic]);

  async function save() {
    setSaving(true);
    await fetch("/api/clinic", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        clinic_type: clinicType,
        owner_name: ownerName,
        owner_phone: ownerPhone,
      }),
    });
    setSaving(false);
    onReload();
  }

  return (
    <section className="max-w-[520px] space-y-3">
      <Field label="Clinic name">
        <input value={name} onChange={(event) => setName(event.target.value)} className="fd-input" />
      </Field>
      <Field label="Clinic type">
        <select value={clinicType} onChange={(event) => setClinicType(event.target.value)} className="fd-input">
          <option value="dental">Dental</option>
          <option value="aesthetic">Aesthetic</option>
          <option value="gp">GP</option>
          <option value="functional_medicine">Functional medicine</option>
          <option value="physio">Physio</option>
        </select>
      </Field>
      <Field label="Owner name">
        <input value={ownerName} onChange={(event) => setOwnerName(event.target.value)} className="fd-input" />
      </Field>
      <Field label="Owner phone">
        <input value={ownerPhone} onChange={(event) => setOwnerPhone(event.target.value)} className="fd-input" />
      </Field>
      <Field label="Plan">
        <div className="flex h-8 items-center rounded-[6px] border border-[var(--border-default)] bg-[var(--surface-subtle)] px-2 text-[11px] capitalize">
          {clinic?.plan_type ?? "starter"}
        </div>
      </Field>
      <button
        type="button"
        onClick={() => void save()}
        disabled={saving || !name.trim()}
        className="rounded-[6px] bg-[var(--brand-gold)] px-3 py-1.5 text-[11px] font-medium text-white disabled:opacity-50"
      >
        Save changes
      </button>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-[11px] font-medium text-[var(--text-secondary)]">
      {label}
      <div className="mt-1">{children}</div>
    </label>
  );
}
