import type { Metadata } from "next";
import "./globals.css";

import { ToastProvider } from "@/components/ui/Toaster";

const DEFAULT_APP_URL = "http://localhost:3000";
const APP_NAME = "Frontdesk AI";
const APP_DESCRIPTION =
  "Frontdesk AI is a WhatsApp-first CRM for clinic teams to capture leads, reply faster, and convert more visits.";

function resolveMetadataBase() {
  const candidate =
    process.env.APP_BASE_URL?.trim() ||
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    DEFAULT_APP_URL;

  try {
    return new URL(candidate);
  } catch {
    return new URL(DEFAULT_APP_URL);
  }
}

const metadataBase = resolveMetadataBase();

export const metadata: Metadata = {
  metadataBase,
  title: {
    default: APP_NAME,
    template: `%s | ${APP_NAME}`,
  },
  description: APP_DESCRIPTION,
  applicationName: APP_NAME,
  keywords: [
    "clinic crm",
    "whatsapp crm",
    "frontdesk ai",
    "lead conversion",
    "patient follow-up",
  ],
  icons: {
    icon: [{ url: "/frontdesk-ai-mark.svg", type: "image/svg+xml" }],
    shortcut: "/frontdesk-ai-mark.svg",
    apple: "/frontdesk-ai-mark.svg",
  },
  openGraph: {
    type: "website",
    url: metadataBase,
    siteName: APP_NAME,
    title: APP_NAME,
    description: APP_DESCRIPTION,
    images: [{ url: "/frontdesk-ai-logo.svg", alt: APP_NAME }],
  },
  twitter: {
    card: "summary_large_image",
    title: APP_NAME,
    description: APP_DESCRIPTION,
    images: ["/frontdesk-ai-logo.svg"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
