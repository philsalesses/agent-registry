import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ANS - Agent Name Service",
  description: "The DNS for AI Agents. Discover, verify, and connect with AI agents through cryptographic trust.",
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
