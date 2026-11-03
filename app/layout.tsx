import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Repo Inspector — Understand and defend your code",
  description: "A privacy-first, code-grounded repository inspector for public GitHub projects.",
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
