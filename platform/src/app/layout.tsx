import type { Metadata, Viewport } from "next";
import { Playfair_Display, Inter, IBM_Plex_Mono } from "next/font/google";
import Link from "next/link";
import { Nav } from "@/components/nav";
import { currentOperation } from "@/lib/current-op";
import "./globals.css";

const playfair = Playfair_Display({
  variable: "--font-playfair",
  subsets: ["latin"],
  weight: ["500", "600"],
  style: ["normal", "italic"],
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "Neumeric — Farm platform",
  description:
    "Verified ground truth for the financial decisions on your farm: claims evidence, deadlines, and program money.",
};

export const viewport: Viewport = {
  themeColor: "#fff8f1",
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const op = await currentOperation();
  return (
    <html
      lang="en"
      className={`${playfair.variable} ${inter.variable} ${plexMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {op?.isDemo && (
          <div className="no-print bg-[var(--forest-tint)] border-b border-ash px-4 py-1.5 text-center">
            <span className="label !text-forest-ink">
              Demo workspace — all data on these screens is fictional sample data ·{" "}
              <Link href="/setup" className="underline">set up your real farm</Link>
            </span>
          </div>
        )}
        <Nav signedIn={!!op} />
        <main className="w-full max-w-[1200px] mx-auto px-4 sm:px-6 pb-24 flex-1">
          {children}
        </main>
        <footer className="no-print border-t border-ash py-6">
          <div className="max-w-[1200px] mx-auto px-4 sm:px-6 flex flex-wrap items-center justify-between gap-3">
            <span className="font-mono text-forest text-sm">&lt;/Neumeric&gt;</span>
            <span className="label">
              Decision support & documentation — not insurance, legal, or trading advice
            </span>
            <Link href="https://neumeric.xyz" className="label hover:text-forest">
              neumeric.xyz
            </Link>
          </div>
        </footer>
      </body>
    </html>
  );
}
