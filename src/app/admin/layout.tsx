import { Inter } from "next/font/google";

import { FrontdeskLogo } from "@/components/brand/FrontdeskLogo";

const inter = Inter({ subsets: ["latin"] });

export const metadata = {
  title: "Super Admin | Frontdesk AI",
  description: "Global dashboard for Frontdesk AI",
};

export default function AdminLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className={`${inter.className} min-h-screen bg-background flex flex-col`}>
      <header className="h-16 bg-card border-b border-border flex items-center px-8">
        <div className="flex items-center gap-3">
          <FrontdeskLogo
            showTagline={false}
            markClassName="h-8 w-8"
            nameClassName="text-lg font-semibold text-foreground"
          />
          <span className="inline-flex items-center rounded-full border border-border bg-background px-3 py-1 text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
            Super Admin
          </span>
        </div>
      </header>
      <main className="flex-1 overflow-auto bg-muted/30">
        {children}
      </main>
    </div>
  );
}
