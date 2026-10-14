"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "./ui";

const links = [
  { href: "/", label: "Chief" },
  { href: "/loopers", label: "Loopers" },
  { href: "/settings", label: "Keys & integrations" },
];

export function Nav() {
  const path = usePathname();
  return (
    <header className="sticky top-0 z-30 border-b border-line/70 bg-page/85 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-[1360px] items-center justify-between gap-4 px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2.5">
          <span className="relative inline-flex h-7 w-7 items-center justify-center rounded-full bg-ink">
            <span className="h-3 w-3 rounded-full border-[2.5px] border-green" />
          </span>
          <span className="hidden text-[1.0625rem] font-semibold tracking-[-0.02em] sm:inline">groklooper</span>
        </Link>
        <nav className="flex min-w-0 items-center gap-1 overflow-x-auto">
          {links.map((l) => {
            const active = l.href === "/" ? path === "/" : path.startsWith(l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                className={cx(
                  "whitespace-nowrap rounded-full px-3.5 py-1.5 text-[0.875rem] transition-colors",
                  active ? "bg-ink text-white" : "text-mute hover:bg-well hover:text-ink",
                )}
              >
                {l.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
