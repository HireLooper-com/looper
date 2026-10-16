"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { signOutApp } from "@/app/actions";
import { LogoMark, Wordmark } from "./brand";
import { Bot, cx } from "./ui";

const APPS = [
  { href: "/chief", label: "Chief", tone: "bg-gradient-to-b from-[#3a3a3c] to-[#0b0b0c]", glyph: "chief" },
  { href: "/loopers", label: "Loopers", tone: "bg-gradient-to-b from-[#4fa8ff] to-[#0a7cff]", glyph: "◎" },
  { href: "/settings", label: "Settings", tone: "bg-gradient-to-b from-[#a1a1a6] to-[#6e6e73]", glyph: "⚙︎" },
];

function usePopover() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  return [open, setOpen, ref] as const;
}

/** iCloud-style top bar: logo and app name on the left, app launcher and account on the right. */
export function Nav({ email, plan }: { email?: string; plan?: string }) {
  const path = usePathname();
  const router = useRouter();
  const [appsOpen, setAppsOpen, appsRef] = usePopover();
  const [accountOpen, setAccountOpen, accountRef] = usePopover();
  const signedIn = path !== "/login" && (email !== undefined || plan !== undefined);
  const current = APPS.find((a) => path.startsWith(a.href));

  useEffect(() => {
    setAppsOpen(false);
    setAccountOpen(false);
  }, [path, setAppsOpen, setAccountOpen]);

  return (
    <header className="sticky top-0 z-30 border-b border-black/[0.06] bg-[rgba(251,251,253,0.8)] backdrop-blur-xl backdrop-saturate-150">
      <div className="mx-auto flex h-12 max-w-[1360px] items-center justify-between gap-4 px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2">
          <LogoMark size={24} />
          <Wordmark className="text-[1rem]" />
          {current && <span className="hidden text-[1rem] font-normal text-faint sm:inline">{current.label}</span>}
        </Link>
        {signedIn && (
          <div className="flex items-center gap-1">
            <div className="relative" ref={appsRef}>
              <button
                onClick={() => setAppsOpen((o) => !o)}
                className="flex h-8 w-8 items-center justify-center rounded-full text-ink-2 hover:bg-black/[0.05]"
                aria-label="Apps"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
                  {[2, 8, 14].flatMap((y) => [2, 8, 14].map((x) => <circle key={`${x}${y}`} cx={x} cy={y} r="1.6" />))}
                </svg>
              </button>
              {appsOpen && (
                <div className="absolute right-0 top-10 grid w-[264px] grid-cols-3 gap-1 rounded-[18px] border border-black/[0.06] bg-white/95 p-3 shadow-[0_12px_40px_rgba(0,0,0,0.12)] backdrop-blur-xl">
                  {[{ href: "/", label: "Home", tone: "bg-gradient-to-b from-[#ff9f0a] to-[#ff7a00]", glyph: "⌂" }, ...APPS].map((a) => (
                    <Link key={a.href} href={a.href} className="flex flex-col items-center gap-1.5 rounded-[12px] p-2 hover:bg-black/[0.04]">
                      {a.glyph === "chief" ? (
                        <Bot dark size={48} seed="chief" />
                      ) : (
                        <span className={cx("app-icon flex h-12 w-12 items-center justify-center text-[1.25rem] text-white", a.tone)}>{a.glyph}</span>
                      )}
                      <span className="text-[0.75rem] text-ink-2">{a.label}</span>
                    </Link>
                  ))}
                </div>
              )}
            </div>
            <div className="relative" ref={accountRef}>
              <button
                onClick={() => setAccountOpen((o) => !o)}
                className="ml-1 flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-b from-[#a1a1a6] to-[#6e6e73] text-[0.8125rem] font-semibold uppercase text-white"
                aria-label="Account"
              >
                {(email || "?").slice(0, 1)}
              </button>
              {accountOpen && (
                <div className="absolute right-0 top-10 w-64 rounded-[14px] border border-black/[0.06] bg-white/95 p-1.5 shadow-[0_12px_40px_rgba(0,0,0,0.12)] backdrop-blur-xl">
                  <div className="px-3 py-2.5">
                    <div className="truncate text-[0.9375rem] font-semibold">{email || "Signed in"}</div>
                    {plan && <div className="text-[0.8125rem] text-mute">Using your {plan} plan</div>}
                  </div>
                  <div className="my-1 h-px bg-line" />
                  <Link href="/settings" className="block rounded-[8px] px-3 py-2 text-[0.875rem] hover:bg-black/[0.04]">
                    Settings
                  </Link>
                  <button
                    onClick={async () => {
                      await signOutApp();
                      router.push("/login");
                      router.refresh();
                    }}
                    className="w-full rounded-[8px] px-3 py-2 text-left text-[0.875rem] hover:bg-black/[0.04]"
                  >
                    Sign out
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </header>
  );
}
