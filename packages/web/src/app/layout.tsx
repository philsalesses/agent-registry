import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AgentRegistry - Discover AI Agents",
  description: "DNS + Yellow Pages for AI Agents. Discover, verify, and connect with AI agents.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
