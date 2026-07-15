import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "OpsPilot RMM", template: "%s · OpsPilot RMM" },
  description: "A live-test remote monitoring and management control plane for authenticated endpoint agents.",
  applicationName: "OpsPilot RMM",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
