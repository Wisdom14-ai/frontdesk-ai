"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Lead } from "@/types";
import { useAppStore, type BoardColumn } from "@/store";
import { columnToStatus, updateContact } from "@/lib/supabase/hooks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useEffect, useState } from "react";
import { Calendar, Clock, Save, Loader2 } from "lucide-react";

const leadFormSchema = z.object({
  full_name: z.string().min(2, "Name is required"),
  phone_e164: z.string().min(5, "Valid phone is required"),
  treatment_interest: z.string().min(2, "Treatment is required"),
  source: z.string().optional(),
  campaign_name: z.string().optional(),
  status: z.string(),
  appointment_date: z.string().optional(),
  appointment_time: z.string().optional(),
});

type LeadFormValues = z.infer<typeof leadFormSchema>;

export function LeadDetailsForm({ lead }: { lead?: Lead }) {
  const setLeads = useAppStore((state) => state.setLeads);
  const leads = useAppStore((state) => state.leads);
  const openRevenueDialog = useAppStore((state) => state.openRevenueDialog);
  const [saving, setSaving] = useState(false);

  const form = useForm<LeadFormValues>({
    resolver: zodResolver(leadFormSchema),
    defaultValues: {
      full_name: lead?.full_name || "",
      phone_e164: lead?.phone_e164 || "",
      treatment_interest: lead?.treatment_interest || "",
      source: lead?.source || "",
      campaign_name: lead?.campaign_name || "",
      status: lead?.status || "New Lead",
      appointment_date: lead?.appointment_date || "",
      appointment_time: lead?.appointment_time || "",
    },
  });

  useEffect(() => {
    if (lead) {
      form.reset({
        full_name: lead.full_name,
        phone_e164: lead.phone_e164,
        treatment_interest: lead.treatment_interest,
        source: lead.source || "",
        campaign_name: lead.campaign_name || "",
        status: lead.status,
        appointment_date: lead.appointment_date || "",
        appointment_time: lead.appointment_time || "",
      });
    }
  }, [lead, form]);

  const onSubmit = async (data: LeadFormValues) => {
    if (!lead) return;

    if (data.status === "Attended" && lead.status !== "Attended") {
      openRevenueDialog(lead.id);
      return;
    }

    setSaving(true);
    const result = await updateContact(lead.id, {
      full_name: data.full_name,
      treatment_interest: data.treatment_interest,
      source: data.source || "",
      campaign_name: data.campaign_name || "",
      status: columnToStatus[data.status as BoardColumn] || "new_lead",
      appointment_date: data.appointment_date || null,
      appointment_time: data.appointment_time || null,
    });

    if (result.success && result.contact) {
      setLeads(leads.map((candidate) => candidate.id === lead.id ? result.contact! : candidate));
    }

    setSaving(false);
  };

  if (!lead) return null;

  return (
    <div className="flex flex-col h-full bg-muted/10 p-4">
      <h3 className="font-semibold text-lg mb-6 border-b border-border pb-4">Lead Details</h3>

      <div className="flex-1 overflow-y-auto pr-2">
        <form id="lead-form" onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          
          <div className="space-y-1.5">
            <Label htmlFor="full_name">Full Name</Label>
            <Input id="full_name" {...form.register("full_name")} />
            {form.formState.errors.full_name && (
              <p className="text-xs text-destructive">{form.formState.errors.full_name.message}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="phone">Phone Number</Label>
            <Input id="phone" {...form.register("phone_e164")} readOnly className="bg-muted/50 text-muted-foreground" />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="treatment">Treatment Interest</Label>
            <Input id="treatment" {...form.register("treatment_interest")} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="source">Lead Source</Label>
            <Input id="source" placeholder="Facebook Ad, Google, Referral" {...form.register("source")} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="campaign_name">Campaign</Label>
            <Input id="campaign_name" placeholder="March Braces Promo" {...form.register("campaign_name")} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="status">Pipeline Status</Label>
            <Select 
              value={form.watch("status")} 
              onValueChange={(val) => { if (val) form.setValue("status", val, { shouldDirty: true }); }}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="New Lead">New Lead</SelectItem>
                <SelectItem value="No Respond">No Respond</SelectItem>
                <SelectItem value="Booked Appointment">Booked Appointment</SelectItem>
                <SelectItem value="Attended">Attended</SelectItem>
                <SelectItem value="No Show">No Show</SelectItem>
                <SelectItem value="Patient">Patient</SelectItem>
                <SelectItem value="Trash">Trash</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="pt-4 mt-2 border-t border-border">
            <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
              <Calendar className="w-4 h-4" /> Appointment
            </h4>
            
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div className="space-y-1.5">
                <Label htmlFor="date" className="text-xs">Date</Label>
                <Input id="date" type="date" {...form.register("appointment_date")} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="time" className="text-xs text-muted-foreground flex items-center gap-1">
                  <Clock className="w-3 h-3"/> Time
                </Label>
                <Input id="time" type="time" {...form.register("appointment_time")} />
              </div>
            </div>

            {(form.watch("appointment_date") || form.watch("appointment_time")) && (
              <div className="p-3 bg-primary/10 border border-primary/20 rounded-lg text-sm flex flex-col gap-1">
                <span className="font-medium text-primary-foreground">Booking Confirmed</span>
                <span className="text-muted-foreground text-xs">
                  {form.watch("appointment_date")} @ {form.watch("appointment_time")}
                </span>
                <div className="mt-2 text-[10px] text-primary/80 uppercase font-semibold">
                  Same-day reminder ready
                </div>
              </div>
            )}
          </div>
        </form>
      </div>

      <div className="pt-4 mt-4 border-t border-border sticky bottom-0 bg-card">
        <Button 
          type="submit" 
          form="lead-form" 
          className="w-full gap-2"
          disabled={!form.formState.isDirty || saving}
        >
          {saving ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Save className="w-4 h-4" />
          )}
          {saving ? "Saving..." : "Save Changes"}
        </Button>
      </div>
    </div>
  );
}
