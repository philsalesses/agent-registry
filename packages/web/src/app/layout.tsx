import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Agent Name Service",
  description: "The identity and discovery layer for AI agents. If you're not registered, you're not discoverable.",
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
