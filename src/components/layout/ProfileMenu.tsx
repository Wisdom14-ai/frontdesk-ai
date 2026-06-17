"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { LogOut, Users, UserCircle2, Building2, Check } from "lucide-react";

import { signOut } from "@/app/login/actions";

interface ProfileMenuProps {
  fullName: string | null;
  email: string;
  role: string;
  clinicName: string | null;
  canManageTeam: boolean;
}

function getInitials(name: string | null, email: string) {
  const source = (name ?? "").trim() || email;
  const parts = source.split(/\s+/).filter(Boolean);

  if (parts.length === 0) {
    return "?";
  }

  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }

  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function formatRole(role: string) {
  if (!role) {
    return "Member";
  }

  return role.charAt(0).toUpperCase() + role.slice(1);
}

export function ProfileMenu({
  fullName,
  email,
  role,
  clinicName,
  canManageTeam,
}: ProfileMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, []);

  const initials = getInitials(fullName, email);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setIsOpen((current) => !current)}
        aria-label="Account menu"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--brand-gold)] text-[11px] font-semibold text-white transition-opacity hover:opacity-90"
      >
        {initials}
      </button>

      {isOpen ? (
        <div
          role="menu"
          className="absolute right-0 top-9 z-50 w-[260px] overflow-hidden rounded-[8px] border border-[var(--border-default)] bg-[var(--surface-raised)] shadow-xl"
        >
          <div className="flex items-center gap-3 border-b border-[var(--border-subtle)] px-3 py-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--brand-gold)] text-[12px] font-semibold text-white">
              {initials}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[12px] font-semibold text-[var(--text-primary)]">
                {fullName?.trim() || email}
              </p>
              <p className="truncate text-[11px] text-[var(--text-secondary)]">
                {email}
              </p>
            </div>
          </div>

          <div className="border-b border-[var(--border-subtle)] px-3 py-2">
            {clinicName ? (
              <div className="flex items-center gap-2 text-[11px] text-[var(--text-secondary)]">
                <Building2 className="h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]" />
                <span className="truncate">{clinicName}</span>
              </div>
            ) : null}
            <div className="mt-1.5 flex items-center gap-2 text-[11px] text-[var(--text-secondary)]">
              <UserCircle2 className="h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]" />
              <span className="inline-flex items-center gap-1">
                <Check className="h-3 w-3 text-[var(--wa-connected)]" />
                {formatRole(role)}
              </span>
            </div>
          </div>

          <div className="py-1">
            {canManageTeam ? (
              <Link
                href="/settings?tab=team"
                role="menuitem"
                onClick={() => setIsOpen(false)}
                className="flex items-center gap-2 px-3 py-2 text-[12px] text-[var(--text-primary)] hover:bg-[var(--surface-subtle)]"
              >
                <Users className="h-4 w-4 text-[var(--text-muted)]" />
                Team &amp; users
              </Link>
            ) : null}

            <form action={signOut}>
              <button
                type="submit"
                role="menuitem"
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-[var(--danger)] hover:bg-[var(--surface-subtle)]"
              >
                <LogOut className="h-4 w-4" />
                Sign out
              </button>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
