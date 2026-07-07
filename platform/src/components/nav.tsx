"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Overview" },
  { href: "/fields", label: "Fields" },
  { href: "/deadlines", label: "Deadlines" },
  { href: "/claims", label: "Claims" },
  { href: "/programs", label: "Programs" },
  { href: "/marketing", label: "Marketing" },
  { href: "/settings", label: "Farm" },
];

export function Nav({ signedIn }: { signedIn: boolean }) {
  const pathname = usePathname();
  return (
    <nav className="no-print sticky top-0 z-40 bg-cream/90 backdrop-blur border-b border-ash">
      <div className="max-w-[1200px] mx-auto px-4 sm:px-6 flex items-center gap-4 sm:gap-6 h-14 overflow-x-auto">
        <Link
          href={signedIn ? "/" : "/welcome"}
          className="font-mono text-forest font-medium whitespace-nowrap text-[15px]"
        >
          &lt;/Neumeric&gt;
        </Link>
        <div className="flex items-center gap-1 sm:gap-2 ml-auto">
          {signedIn ? (
            LINKS.map((l) => {
              const active =
                l.href === "/" ? pathname === "/" : pathname.startsWith(l.href);
              return (
                <Link
                  key={l.href}
                  href={l.href}
                  className={`label !text-[11.5px] px-2.5 sm:px-3 py-1.5 rounded-[60px] whitespace-nowrap transition-colors ${
                    active
                      ? "bg-forest !text-cream"
                      : "hover:bg-[var(--forest-tint)] hover:!text-forest-ink"
                  }`}
                >
                  {l.label}
                </Link>
              );
            })
          ) : (
            <Link href="/setup" className="pill pill--sm">
              Set up your farm
            </Link>
          )}
        </div>
      </div>
    </nav>
  );
}
