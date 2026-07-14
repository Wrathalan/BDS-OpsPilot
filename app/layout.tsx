import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "OpsPilot RMM", template: "%s · OpsPilot RMM" },
  description: "A simulator-first remote monitoring and management control plane for modern IT operations.",
  applicationName: "OpsPilot RMM",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
