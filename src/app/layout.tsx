import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Pill Price",
    template: "%s · Pill Price",
  },
  description:
    "Drug pricing reference built on RxNorm, openFDA, and NADAC acquisition-cost data.",
};

// Typed explicitly rather than via Next's generated `LayoutProps<"/">`, so
// `tsc --noEmit` is a standalone CI check that does not require a prior build.
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
