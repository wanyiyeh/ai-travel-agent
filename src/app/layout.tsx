import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import AccountBar from "@/components/AccountBar";
import SiteFooter from "@/components/SiteFooter";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "AI Travel Agent",
  description: "AI-powered travel itinerary generator",
  // Low-key launch (PLAN-001 #214): kept out of search results while the
  // site is checked in production; #215 removes this when it goes public.
  robots: { index: false, follow: false },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-TW">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <AccountBar />
        {children}
        <SiteFooter />
      </body>
    </html>
  );
}
