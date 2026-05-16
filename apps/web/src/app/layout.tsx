import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "NemoClaw Policy Replay Lab",
  description: "Visual execution, failure, and recovery debugger for NemoClaw agents",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
