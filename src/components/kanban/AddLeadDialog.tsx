"use client";

import { useRef, useState } from "react";
import { Loader2, Upload, UserPlus } from "lucide-react";

import { parseCsv, guessColumn } from "@/lib/csv";
import { createContact, importContacts } from "@/lib/supabase/hooks";
import { useAppStore } from "@/store";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type DialogMode = "manual" | "csv";

export function AddLeadDialog() {
  const { addLeadDialogOpen, closeAddLeadDialog } = useAppStore();
  const [mode, setMode] = useState<DialogMode>("manual");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [summary, setSummary] = useState("");

  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [treatment, setTreatment] = useState("");
  const [source, setSource] = useState("");
  const [campaign, setCampaign] = useState("");

  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [csvRows, setCsvRows] = useState<string[][]>([]);
  const [nameColumn, setNameColumn] = useState("");
  const [phoneColumn, setPhoneColumn] = useState("");
  const [treatmentColumn, setTreatmentColumn] = useState("");
  const [sourceColumn, setSourceColumn] = useState("");
  const [campaignColumn, setCampaignColumn] = useState("");
  const [defaultSource, setDefaultSource] = useState("");
  const [defaultCampaign, setDefaultCampaign] = useState("");

  const fileInputRef = useRef<HTMLInputElement>(null);

  const resetForm = () => {
    setMode("manual");
    setFullName("");
    setPhone("");
    setTreatment("");
    setSource("");
    setCampaign("");
    setCsvHeaders([]);
    setCsvRows([]);
    setNameColumn("");
    setPhoneColumn("");
    setTreatmentColumn("");
    setSourceColumn("");
    setCampaignColumn("");
    setDefaultSource("");
    setDefaultCampaign("");
    setSummary("");
    setError("");
  };

  const handleSubmit = async () => {
    if (!fullName.trim() || !phone.trim()) {
      setError("Name and phone number are required.");
      return;
    }

    setLoading(true);
    setError("");
    setSummary("");

    const result = await createContact({
      full_name: fullName.trim(),
      phone_e164: phone.trim(),
      treatment_interest: treatment.trim() || undefined,
      source: source.trim() || undefined,
      campaign_name: campaign.trim() || undefined,
    });

    setLoading(false);

    if (result.error) {
      setError(result.error);
      return;
    }

    resetForm();
    closeAddLeadDialog();
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setError("");
    setSummary("");

    try {
      const text = await file.text();
      const parsed = parseCsv(text);
      setCsvHeaders(parsed.headers);
      setCsvRows(parsed.rows);
      setMode("csv");
      setNameColumn(guessColumn(parsed.headers, /name/i));
      setPhoneColumn(guessColumn(parsed.headers, /phone|mobile/i));
      setTreatmentColumn(guessColumn(parsed.headers, /treatment|service/i));
      setSourceColumn(guessColumn(parsed.headers, /source/i));
      setCampaignColumn(guessColumn(parsed.headers, /campaign/i));
    } catch {
      setError("Failed to parse CSV file.");
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const handleImportCsv = async () => {
    if (!nameColumn || !phoneColumn || csvRows.length === 0) {
      setError("Name and phone mappings are required for CSV import.");
      return;
    }

    const headerIndex = new Map(csvHeaders.map((header, index) => [header, index]));
    const leads = csvRows.map((row) => ({
      full_name: row[headerIndex.get(nameColumn) ?? -1] ?? "",
      phone_e164: row[headerIndex.get(phoneColumn) ?? -1] ?? "",
      treatment_interest: treatmentColumn ? row[headerIndex.get(treatmentColumn) ?? -1] ?? "" : "",
      source: sourceColumn ? row[headerIndex.get(sourceColumn) ?? -1] ?? "" : defaultSource,
      campaign_name: campaignColumn ? row[headerIndex.get(campaignColumn) ?? -1] ?? "" : defaultCampaign,
    }));

    setLoading(true);
    setError("");
    setSummary("");

    const result = await importContacts(leads);
    setLoading(false);

    if (result.error) {
      setError(result.error);
      return;
    }

    if (!result.summary) {
      setError("Import finished without a summary.");
      return;
    }

    setSummary(
      `Imported ${result.summary.imported}, deduped ${result.summary.deduped}, invalid ${result.summary.invalid}${
        result.summary.blocked ? `, blocked by plan limit ${result.summary.blocked}` : ""
      }.`
    );
  };

  const handleClose = () => {
    resetForm();
    closeAddLeadDialog();
  };

  const previewRows = csvRows.slice(0, 3);

  return (
    <Dialog open={addLeadDialogOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="sm:max-w-[720px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl">
            <UserPlus className="w-5 h-5 text-emerald-500" />
            Add Leads
          </DialogTitle>
          <DialogDescription>
            Add one lead manually or import a CSV with source and campaign tracking intact.
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-2">
          <button
            className={`px-3 py-2 rounded-lg text-sm font-medium border ${mode === "manual" ? "bg-emerald-500 text-white border-emerald-500" : "border-border text-muted-foreground"}`}
            onClick={() => setMode("manual")}
            type="button"
          >
            Manual
          </button>
          <button
            className={`px-3 py-2 rounded-lg text-sm font-medium border ${mode === "csv" ? "bg-emerald-500 text-white border-emerald-500" : "border-border text-muted-foreground"}`}
            onClick={() => setMode("csv")}
            type="button"
          >
            CSV Import
          </button>
        </div>

        {error && (
          <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-600 text-sm">
            {error}
          </div>
        )}

        {summary && (
          <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 text-sm">
            {summary}
          </div>
        )}

        {mode === "manual" ? (
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label htmlFor="add-name">Full Name *</Label>
              <Input id="add-name" placeholder="Sarah Jenkins" value={fullName} onChange={(event) => setFullName(event.target.value)} />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="add-phone">Phone Number *</Label>
              <Input id="add-phone" placeholder="+60123456789" value={phone} onChange={(event) => setPhone(event.target.value)} />
            </div>

            <div className="grid gap-2 md:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="add-treatment">Treatment Interest</Label>
                <Input
                  id="add-treatment"
                  placeholder="Invisalign, Implants, Whitening"
                  value={treatment}
                  onChange={(event) => setTreatment(event.target.value)}
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="add-source">Lead Source</Label>
                <Input
                  id="add-source"
                  placeholder="Facebook Ad, Google"
                  value={source}
                  onChange={(event) => setSource(event.target.value)}
                />
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="add-campaign">Campaign</Label>
              <Input
                id="add-campaign"
                placeholder="March Braces Promo"
                value={campaign}
                onChange={(event) => setCampaign(event.target.value)}
              />
            </div>
          </div>
        ) : (
          <div className="grid gap-4 py-2">
            <div className="flex flex-wrap items-center gap-3">
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                className="hidden"
                onChange={handleFileUpload}
              />
              <Button type="button" variant="outline" onClick={() => fileInputRef.current?.click()} className="gap-2">
                <Upload className="w-4 h-4" />
                Choose CSV
              </Button>
              <p className="text-sm text-muted-foreground">
                Expected columns: name, phone, optional treatment, source, campaign.
              </p>
            </div>

            {csvHeaders.length > 0 && (
              <>
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="grid gap-2">
                    <Label>Name column *</Label>
                    <select value={nameColumn} onChange={(event) => setNameColumn(event.target.value)} className="h-10 rounded-lg border border-border bg-background px-3">
                      <option value="">Select column</option>
                      {csvHeaders.map((header) => (
                        <option key={header} value={header}>{header}</option>
                      ))}
                    </select>
                  </div>
                  <div className="grid gap-2">
                    <Label>Phone column *</Label>
                    <select value={phoneColumn} onChange={(event) => setPhoneColumn(event.target.value)} className="h-10 rounded-lg border border-border bg-background px-3">
                      <option value="">Select column</option>
                      {csvHeaders.map((header) => (
                        <option key={header} value={header}>{header}</option>
                      ))}
                    </select>
                  </div>
                  <div className="grid gap-2">
                    <Label>Treatment column</Label>
                    <select value={treatmentColumn} onChange={(event) => setTreatmentColumn(event.target.value)} className="h-10 rounded-lg border border-border bg-background px-3">
                      <option value="">Not mapped</option>
                      {csvHeaders.map((header) => (
                        <option key={header} value={header}>{header}</option>
                      ))}
                    </select>
                  </div>
                  <div className="grid gap-2">
                    <Label>Source column</Label>
                    <select value={sourceColumn} onChange={(event) => setSourceColumn(event.target.value)} className="h-10 rounded-lg border border-border bg-background px-3">
                      <option value="">Use default source</option>
                      {csvHeaders.map((header) => (
                        <option key={header} value={header}>{header}</option>
                      ))}
                    </select>
                  </div>
                  <div className="grid gap-2">
                    <Label>Campaign column</Label>
                    <select value={campaignColumn} onChange={(event) => setCampaignColumn(event.target.value)} className="h-10 rounded-lg border border-border bg-background px-3">
                      <option value="">Use default campaign</option>
                      {csvHeaders.map((header) => (
                        <option key={header} value={header}>{header}</option>
                      ))}
                    </select>
                  </div>
                  <div className="grid gap-2">
                    <Label>Default source</Label>
                    <Input value={defaultSource} onChange={(event) => setDefaultSource(event.target.value)} placeholder="Facebook Ads" />
                  </div>
                  <div className="grid gap-2 md:col-span-2">
                    <Label>Default campaign</Label>
                    <Input value={defaultCampaign} onChange={(event) => setDefaultCampaign(event.target.value)} placeholder="April Retargeting" />
                  </div>
                </div>

                <div className="border border-border rounded-lg overflow-hidden">
                  <div className="px-4 py-3 border-b border-border bg-muted/40 text-sm font-medium">
                    Preview ({csvRows.length} rows)
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/30">
                        <tr>
                          {csvHeaders.map((header) => (
                            <th key={header} className="px-4 py-2 text-left font-medium text-muted-foreground">{header}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {previewRows.map((row, index) => (
                          <tr key={`${row.join("-")}-${index}`} className="border-t border-border">
                            {csvHeaders.map((header, headerIndex) => (
                              <td key={`${header}-${index}`} className="px-4 py-2">{row[headerIndex] || "—"}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        <DialogFooter className="flex-col sm:flex-row gap-2 sm:justify-between items-center w-full">
          <div className="text-xs text-muted-foreground">
            {mode === "csv"
              ? "Server-side dedupe prevents duplicate phone numbers for this clinic."
              : "Manual adds land in the New Lead column immediately."}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={handleClose} disabled={loading}>
              Cancel
            </Button>
            {mode === "manual" ? (
              <Button onClick={() => void handleSubmit()} disabled={loading} className="gap-2">
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
                Add Lead
              </Button>
            ) : (
              <Button onClick={() => void handleImportCsv()} disabled={loading || csvHeaders.length === 0} className="gap-2">
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                Import CSV
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
