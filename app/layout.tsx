import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Repo Interview Coach — Defend your code",
  description: "A privacy-first, code-grounded interview coach for public GitHub repositories.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="bg-[#f7faf8]">
      <body className="antialiased">{children}</body>
    </html>
  );
}
