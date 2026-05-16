import type { Metadata } from "next";
import { Inter, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

// Two-typeface system:
//   • Inter (sans)        — UI surfaces, headings, labels, body
//   • IBM Plex Mono       — code, IDs, JSON, terminal output, anywhere a
//                           uniform cell width carries meaning
//
// Mono is selectively applied per component (className="font-mono") rather
// than globally, so the UI gets real typographic hierarchy.
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  weight: ["400", "500", "600"],
  subsets: ["latin"],
  variable: "--font-plex-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "NemoCognition",
  description: "Visual execution, failure, and recovery debugger for AI agents",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`dark ${inter.variable} ${plexMono.variable}`}>
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
