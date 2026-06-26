import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Research Desk — AI Investment Memo Agent",
  description: "Give it a company name. It researches and renders an investment verdict.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-paper-texture min-h-screen">{children}</body>
    </html>
  );
}
