"use client";

import { useAppStore } from "@/store";
import { logRevenue } from "@/lib/supabase/hooks";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useState } from "react";
import { Loader2 } from "lucide-react";

export function RevenueDialog() {
  const { revenueDialogOpen, revenueDialogLeadId, closeRevenueDialog, confirmRevenue, leads } =
    useAppStore();

  const [revenue, setRevenue] = useState("");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);

  const activeLead = leads.find((l) => l.id === revenueDialogLeadId);

  const handleConfirm = async () => {
    if (!revenueDialogLeadId) return;
    const amount = parseFloat(revenue);
    if (isNaN(amount) || amount < 0) return;
    
    setLoading(true);
    
    // Persist to Supabase
    const result = await logRevenue(revenueDialogLeadId, amount, note || undefined);
    
    if (result.error) {
      console.error("Failed to log revenue:", result.error);
      setLoading(false);
      return;
    }

    // Optimistic update in store
    confirmRevenue(revenueDialogLeadId, amount, note);
    setLoading(false);
    setRevenue("");
    setNote("");
  };

  const handleCancel = () => {
    closeRevenueDialog();
    setRevenue("");
    setNote("");
  };

  return (
    <Dialog open={revenueDialogOpen} onOpenChange={(open) => !open && handleCancel()}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle className="text-xl">Log Visit Revenue</DialogTitle>
          <DialogDescription>
            {activeLead?.full_name} attended their visit. Please log the revenue generated strictly in MYR.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="revenue">Revenue Generated (MYR) *</Label>
            <div className="relative">
              <span className="absolute left-3 top-2.5 text-muted-foreground">RM</span>
              <Input
                id="revenue"
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                className="pl-9"
                value={revenue}
                onChange={(e) => setRevenue(e.target.value)}
              />
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="note">Optional Note</Label>
            <Textarea
              id="note"
              placeholder="e.g. Sold an additional whitening kit."
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="resize-none"
              rows={3}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={handleCancel} disabled={loading}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={!revenue || isNaN(parseFloat(revenue)) || loading} className="gap-2">
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            Confirm Entry
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
