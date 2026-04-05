import { useId } from "react";

import { cn } from "@/lib/utils";

export const FRONTDESK_AI_NAME = "Frontdesk AI";
export const FRONTDESK_AI_TAGLINE = "AI WhatsApp CRM for clinic teams";

interface FrontdeskMarkProps {
  className?: string;
  title?: string;
}

export function FrontdeskMark({
  className,
  title = `${FRONTDESK_AI_NAME} logo`,
}: FrontdeskMarkProps) {
  const id = useId().replace(/:/g, "");
  const surfaceGradientId = `${id}-surface`;
  const strokeGradientId = `${id}-stroke`;
  const accentGradientId = `${id}-accent`;
  const titleId = `${id}-title`;

  return (
    <svg
      viewBox="0 0 64 64"
      role="img"
      aria-labelledby={titleId}
      className={cn("shrink-0", className)}
      xmlns="http://www.w3.org/2000/svg"
    >
      <title id={titleId}>{title}</title>
      <defs>
        <linearGradient
          id={surfaceGradientId}
          x1="10"
          y1="8"
          x2="54"
          y2="58"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#FFFFFF" />
          <stop offset="1" stopColor="#F0FDFA" />
        </linearGradient>
        <linearGradient
          id={strokeGradientId}
          x1="18"
          y1="18"
          x2="45"
          y2="45"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#0F766E" />
          <stop offset="1" stopColor="#14B8A6" />
        </linearGradient>
        <linearGradient
          id={accentGradientId}
          x1="43"
          y1="16"
          x2="50"
          y2="23"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#34D399" />
          <stop offset="1" stopColor="#0F766E" />
        </linearGradient>
      </defs>
      <rect
        x="4"
        y="4"
        width="56"
        height="56"
        rx="18"
        fill={`url(#${surfaceGradientId})`}
      />
      <rect
        x="5"
        y="5"
        width="54"
        height="54"
        rx="17"
        stroke="#14B8A6"
        strokeOpacity="0.14"
      />
      <path
        d="M21 18V46"
        stroke={`url(#${strokeGradientId})`}
        strokeWidth="5.5"
        strokeLinecap="round"
      />
      <path
        d="M21 18H39"
        stroke={`url(#${strokeGradientId})`}
        strokeWidth="5.5"
        strokeLinecap="round"
      />
      <path
        d="M21 31H33.5"
        stroke={`url(#${strokeGradientId})`}
        strokeWidth="5.5"
        strokeLinecap="round"
      />
      <path
        d="M33 18H36.5C44.508 18 51 24.492 51 32.5C51 40.508 44.508 47 36.5 47H33"
        stroke={`url(#${strokeGradientId})`}
        strokeWidth="5.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle
        cx="46.5"
        cy="18.5"
        r="4.5"
        fill={`url(#${accentGradientId})`}
      />
      <path
        d="M14 50H50"
        stroke="#14B8A6"
        strokeOpacity="0.18"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

interface FrontdeskLogoProps {
  className?: string;
  markClassName?: string;
  nameClassName?: string;
  badgeClassName?: string;
  taglineClassName?: string;
  showTagline?: boolean;
  tagline?: string;
}

export function FrontdeskLogo({
  className,
  markClassName,
  nameClassName,
  badgeClassName,
  taglineClassName,
  showTagline = false,
  tagline = FRONTDESK_AI_TAGLINE,
}: FrontdeskLogoProps) {
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <FrontdeskMark className={cn("h-11 w-11", markClassName)} />
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "truncate text-lg font-semibold tracking-tight text-teal-700",
              nameClassName
            )}
          >
            Frontdesk
          </span>
          <span
            className={cn(
              "inline-flex h-6 items-center rounded-full border border-teal-500/20 bg-white px-2.5 text-[0.65rem] font-semibold uppercase tracking-[0.22em] text-teal-700",
              badgeClassName
            )}
          >
            AI
          </span>
        </div>
        {showTagline ? (
          <p className={cn("text-xs text-muted-foreground", taglineClassName)}>
            {tagline}
          </p>
        ) : null}
      </div>
    </div>
  );
}
