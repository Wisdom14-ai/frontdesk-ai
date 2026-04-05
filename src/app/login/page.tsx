"use client";

import { Suspense, useState } from "react";
import { ArrowRight, Loader2 } from "lucide-react";
import { useSearchParams } from "next/navigation";

import {
  FrontdeskLogo,
  FRONTDESK_AI_TAGLINE,
} from "@/components/brand/FrontdeskLogo";
import { CLINIC_TYPE_LABELS, PLAN_DEFINITIONS } from "@/lib/plans";

import { login, signup } from "./actions";

const marketingHighlights = [
  "Shared WhatsApp inbox for your team",
  "Drag-and-drop lead pipeline",
  "AI-powered follow-up and booking",
  "Revenue tracking per attended visit",
];

export default function LoginPage() {
  const [isSignUp, setIsSignUp] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  return (
    <div className="min-h-screen flex">
      {/* Left panel - branding */}
      <div className="hidden lg:flex lg:w-1/2 relative overflow-hidden bg-gradient-to-br from-emerald-600 via-emerald-500 to-teal-400">
        <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHZpZXdCb3g9IjAgMCA2MCA2MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZyBmaWxsPSJub25lIiBmaWxsLXJ1bGU9ImV2ZW5vZGQiPjxnIGZpbGw9IiNmZmYiIGZpbGwtb3BhY2l0eT0iMC4wNSI+PHBhdGggZD0iTTM2IDM0djItSDI0di0yaDEyem0wLTMwVjBoLTJ2NEgwdjJoMzR6Ii8+PC9nPjwvZz48L3N2Zz4=')] opacity-50" />
        <div className="relative z-10 flex flex-col justify-center px-16">
          <FrontdeskLogo
            className="mb-8"
            markClassName="h-14 w-14"
            nameClassName="text-2xl font-bold text-white"
            badgeClassName="border-white/20 bg-white/15 text-white"
            taglineClassName="text-sm text-emerald-100"
            showTagline
            tagline={FRONTDESK_AI_TAGLINE}
          />

          <h1 className="text-4xl font-bold text-white leading-tight mb-6">
            Stop leaking
            <br />
            WhatsApp leads.
            <br />
            <span className="text-emerald-100">Convert more visits.</span>
          </h1>

          <div className="space-y-4 mt-4">
            {marketingHighlights.map((feature) => (
              <div key={feature} className="flex items-center gap-3 text-white/90">
                <div className="w-6 h-6 rounded-full bg-white/20 flex items-center justify-center flex-shrink-0">
                  <ArrowRight className="w-3 h-3" />
                </div>
                <span className="text-sm">{feature}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Right panel - form */}
      <div className="flex-1 flex items-center justify-center p-8 bg-background">
        <div className="w-full max-w-md">
          {/* Mobile logo */}
          <FrontdeskLogo
            className="mb-10 lg:hidden"
            markClassName="h-11 w-11"
            nameClassName="text-xl font-bold text-foreground"
            showTagline
            tagline={FRONTDESK_AI_TAGLINE}
          />

          <h1 className="text-2xl font-bold text-foreground mb-1">
            {isSignUp ? "Create your workspace" : "Welcome back"}
          </h1>
          <p className="text-muted-foreground mb-8">
            {isSignUp
              ? "Set up your clinic workspace in under a minute"
              : "Sign in to your clinic workspace"}
          </p>

          <Suspense fallback={null}>
            <ErrorBanner />
            <SuccessBanner />
          </Suspense>

          <form
            action={async (formData) => {
              setIsLoading(true);
              try {
                if (isSignUp) {
                  await signup(formData);
                } else {
                  await login(formData);
                }
              } catch {
                setIsLoading(false);
              }
            }}
            className="space-y-4"
          >
            {isSignUp && (
              <>
                <div>
                  <label htmlFor="fullName" className="block text-sm font-medium text-foreground mb-1.5">
                    Full Name
                  </label>
                  <input
                    id="fullName"
                    name="fullName"
                    type="text"
                    required
                    autoComplete="name"
                    placeholder="Dr. Sarah Jenkins"
                    className="w-full h-11 px-4 rounded-lg border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all"
                  />
                </div>
                <div>
                  <label htmlFor="clinicName" className="block text-sm font-medium text-foreground mb-1.5">
                    Clinic Name
                  </label>
                  <input
                    id="clinicName"
                    name="clinicName"
                    type="text"
                    required
                    autoComplete="organization"
                    placeholder="Bright Smile Dental"
                    className="w-full h-11 px-4 rounded-lg border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all"
                  />
                </div>
                <div>
                  <label htmlFor="clinicType" className="block text-sm font-medium text-foreground mb-1.5">
                    Clinic Type
                  </label>
                  <select
                    id="clinicType"
                    name="clinicType"
                    defaultValue="dental"
                    className="w-full h-11 px-4 rounded-lg border border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all"
                  >
                    {Object.entries(CLINIC_TYPE_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <span className="block text-sm font-medium text-foreground">
                    Plan
                  </span>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {Object.entries(PLAN_DEFINITIONS).map(([value, plan], index) => (
                      <label
                        key={value}
                        className="flex cursor-pointer flex-col rounded-2xl border border-border bg-card p-4 transition-colors hover:border-emerald-500/40"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold text-foreground">{plan.label}</p>
                            <p className="mt-1 text-xs text-muted-foreground">RM {plan.priceMyr} / month</p>
                          </div>
                          <input
                            type="radio"
                            name="planType"
                            value={value}
                            defaultChecked={index === 0}
                            className="mt-1 h-4 w-4 accent-emerald-500"
                          />
                        </div>
                        <div className="mt-4 space-y-1 text-xs text-muted-foreground">
                          <p>{plan.contactLimit.toLocaleString()} contacts</p>
                          <p>{plan.monthlyMessageLimit.toLocaleString()} sent messages / month</p>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>
              </>
            )}

            <div>
              <label htmlFor="email" className="block text-sm font-medium text-foreground mb-1.5">
                Email
              </label>
              <input
                id="email"
                name="email"
                type="email"
                required
                autoComplete="email"
                autoCapitalize="none"
                inputMode="email"
                placeholder="you@clinic.com"
                className="w-full h-11 px-4 rounded-lg border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all"
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-foreground mb-1.5">
                Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                required
                minLength={6}
                autoComplete={isSignUp ? "new-password" : "current-password"}
                placeholder={isSignUp ? "Minimum 6 characters" : "Enter your password"}
                className="w-full h-11 px-4 rounded-lg border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all"
              />
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full h-11 bg-emerald-500 hover:bg-emerald-600 text-white font-medium rounded-lg flex items-center justify-center gap-2 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {isLoading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <>
                  {isSignUp ? "Create Workspace" : "Sign In"}
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>

          <div className="mt-6 text-center">
            <button
              type="button"
              onClick={() => setIsSignUp(!isSignUp)}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              {isSignUp
                ? "Already have an account? Sign in"
                : "Don't have an account? Create workspace"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ErrorBanner() {
  const params = useSearchParams();
  const error = params?.get("error");
  if (!error) return null;

  return (
    <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-600 text-sm">
      {decodeURIComponent(error)}
    </div>
  );
}

function SuccessBanner() {
  const params = useSearchParams();
  const message = params?.get("message");
  if (!message) return null;

  return (
    <div className="mb-4 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 text-sm">
      {decodeURIComponent(message)}
    </div>
  );
}
