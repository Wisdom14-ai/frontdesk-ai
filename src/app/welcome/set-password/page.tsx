"use client";

import { ArrowRight, Loader2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  FrontdeskLogo,
  FRONTDESK_AI_TAGLINE,
} from "@/components/brand/FrontdeskLogo";
import { createClient } from "@/lib/supabase/client";

export default function SetPasswordPage() {
  const clientRef = useRef<SupabaseClient | null>(null);
  const [checking, setChecking] = useState(true);
  const [hasSession, setHasSession] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    clientRef.current = supabase;
    let cancelled = false;

    // Cookie session (server-verified via /auth/confirm) resolves immediately;
    // the implicit-flow copy link arrives with tokens in the URL hash, which
    // the browser client parses asynchronously and reports via the auth event.
    const { data: subscription } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        if (cancelled) return;
        if (session?.user) {
          setUserEmail(session.user.email ?? null);
          setHasSession(true);
          setChecking(false);
        }
      }
    );

    void supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      if (data.session?.user) {
        setUserEmail(data.session.user.email ?? null);
        setHasSession(true);
      }
      setChecking(false);
    });

    const timer = setTimeout(() => {
      if (!cancelled) setChecking(false);
    }, 3000);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      subscription.subscription.unsubscribe();
    };
  }, []);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setError("The passwords do not match.");
      return;
    }

    const supabase = clientRef.current;
    if (!supabase) return;

    setIsSaving(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError) {
      setError(updateError.message);
      setIsSaving(false);
      return;
    }

    // Membership activation (invited → active) runs server-side in
    // getCurrentMembership when the dashboard loads. Full navigation ensures
    // the refreshed session cookies are sent with the request.
    window.location.assign("/inbox");
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-8 bg-background">
      <div className="w-full max-w-md">
        <FrontdeskLogo
          className="mb-10"
          markClassName="h-11 w-11"
          nameClassName="text-xl font-bold text-foreground"
          showTagline
          tagline={FRONTDESK_AI_TAGLINE}
        />

        {checking ? (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-sm">Verifying your invite…</span>
          </div>
        ) : !hasSession ? (
          <>
            <h1 className="text-2xl font-bold text-foreground mb-1">
              This link isn&apos;t valid
            </h1>
            <p className="text-muted-foreground mb-8">
              Your invite link may have expired or already been used. Ask your
              clinic admin to send you a new one.
            </p>
            <Link
              href="/login"
              className="text-sm text-emerald-600 hover:text-emerald-700 transition-colors"
            >
              Back to sign in
            </Link>
          </>
        ) : (
          <>
            <h1 className="text-2xl font-bold text-foreground mb-1">
              Set your password
            </h1>
            <p className="text-muted-foreground mb-8">
              {userEmail
                ? `Choose a password for ${userEmail} to finish setting up your account.`
                : "Choose a password to finish setting up your account."}
            </p>

            {error ? (
              <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-600 text-sm">
                {error}
              </div>
            ) : null}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label
                  htmlFor="password"
                  className="block text-sm font-medium text-foreground mb-1.5"
                >
                  New password
                </label>
                <input
                  id="password"
                  name="password"
                  type="password"
                  required
                  minLength={6}
                  autoComplete="new-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Minimum 6 characters"
                  className="w-full h-11 px-4 rounded-lg border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all"
                />
              </div>

              <div>
                <label
                  htmlFor="confirmPassword"
                  className="block text-sm font-medium text-foreground mb-1.5"
                >
                  Confirm password
                </label>
                <input
                  id="confirmPassword"
                  name="confirmPassword"
                  type="password"
                  required
                  minLength={6}
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  placeholder="Re-enter your password"
                  className="w-full h-11 px-4 rounded-lg border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all"
                />
              </div>

              <button
                type="submit"
                disabled={isSaving}
                className="w-full h-11 bg-emerald-500 hover:bg-emerald-600 text-white font-medium rounded-lg flex items-center justify-center gap-2 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {isSaving ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <>
                    Save password and continue
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
