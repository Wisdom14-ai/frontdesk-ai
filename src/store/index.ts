import { create } from "zustand";
import { Lead } from "@/types";

export type BoardColumn = "New Lead" | "No Respond" | "Booked Appointment" | "Attended" | "No Show" | "Trash" | "Patient";

interface AppState {
  leads: Lead[];
  loading: boolean;
  selectedLeadId: string | null;
  sheetOpen: boolean;
  revenueDialogOpen: boolean;
  revenueDialogLeadId: string | null;
  addLeadDialogOpen: boolean;

  // Actions
  setLeads: (leads: Lead[]) => void;
  setLoading: (loading: boolean) => void;
  updateLeadStatus: (id: string, status: BoardColumn) => void;
  openSheet: (leadId: string) => void;
  closeSheet: () => void;
  openRevenueDialog: (leadId: string) => void;
  closeRevenueDialog: () => void;
  confirmRevenue: (leadId: string, amount: number, note?: string) => void;
  openAddLeadDialog: () => void;
  closeAddLeadDialog: () => void;
}

export const useAppStore = create<AppState>((set) => ({
  leads: [],
  loading: true,
  selectedLeadId: null,
  sheetOpen: false,
  revenueDialogOpen: false,
  revenueDialogLeadId: null,
  addLeadDialogOpen: false,

  setLeads: (leads) => set({ leads }),
  setLoading: (loading) => set({ loading }),
  updateLeadStatus: (id, status) =>
    set((state) => ({
      leads: state.leads.map((l) => (l.id === id ? { ...l, status } : l)),
    })),
  openSheet: (leadId) => set({ selectedLeadId: leadId, sheetOpen: true }),
  closeSheet: () => set({ selectedLeadId: null, sheetOpen: false }),
  openRevenueDialog: (leadId) => set({ revenueDialogOpen: true, revenueDialogLeadId: leadId }),
  closeRevenueDialog: () => set({ revenueDialogOpen: false, revenueDialogLeadId: null }),
  confirmRevenue: (leadId, amount, note) =>
    set((state) => ({
      leads: state.leads.map((l) =>
        l.id === leadId
          ? { ...l, status: "Attended" as BoardColumn, revenue_generated_myr: amount, revenue_note: note }
          : l
      ),
      revenueDialogOpen: false,
      revenueDialogLeadId: null,
      sheetOpen: false,
    })),
  openAddLeadDialog: () => set({ addLeadDialogOpen: true }),
  closeAddLeadDialog: () => set({ addLeadDialogOpen: false }),
}));
