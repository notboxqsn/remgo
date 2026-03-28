import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "REM Status - Montréal",
  description: "Real-time REM train schedule and alerts",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-gray-950 text-gray-100 min-h-screen">{children}</body>
    </html>
  );
}
