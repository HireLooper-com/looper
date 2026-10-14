import type { Metadata } from "next";
import { Suspense } from "react";
import { Geist, Geist_Mono } from "next/font/google";
import { NavShell } from "@/components/nav-shell";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Chieflooper",
  description: "Hire AI loopers that each own one business metric. Sign in with your ChatGPT or Grok plan.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <Suspense>
          <NavShell />
        </Suspense>
        <main className="mx-auto w-full max-w-[1360px] flex-1 px-4 pb-16 sm:px-6">
          <Suspense fallback={<div className="pt-10"><div className="h-[60vh] animate-pulse rounded-[20px] bg-well" /></div>}>{children}</Suspense>
        </main>
      </body>
    </html>
  );
}
