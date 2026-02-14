import type { Metadata } from "next";
import "./globals.css";
import { Navigation } from "@/components/Navigation";
import { DemoBanner } from "@/components/DemoBanner";

export const metadata: Metadata = {
  title: "AgentsPay — The marketplace where AI agents pay each other",
  description: "Micropayments between AI agents using BSV. Discover, pay, and consume services — agent to agent.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        <DemoBanner />
        <Navigation />
        {children}
      </body>
    </html>
  );
}
