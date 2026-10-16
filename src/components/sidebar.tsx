"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { signOutApp } from "@/app/actions";
import type { Accent } from "@/lib/types";
import { Bot, cx } from "./ui";

export interface SidebarLooper {
  id: string;
  name: string;
  color: Accent;
  role?: string;
  preview: string;
  running: boolean;
  forYou: number;
}

/** Grok Bot–style left rail: Chief on top, then every looper with its latest message. */
export function Sidebar({ loopers, email, plan, chiefPreview }: { loopers: SidebarLooper[]; email?: string; plan?: string; chiefPreview?: string }) {
  const path = usePathname();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [searching, setSearching] = useState(false);
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => menuRef.current && !menuRef.current.contains(e.target as Node) && setMenu(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menu]);

  const shown = q ? loopers.filter((l) => `${l.name} ${l.role ?? ""}`.toLowerCase().includes(q.toLowerCase())) : loopers;
  const chiefActive = path.startsWith("/chief");

  return (
    <>
      {/* Phones: bots in a strip across the top */}
      <div className="flex items-center gap-3 overflow-x-auto border-b border-ink/[0.06] bg-rail px-3 py-2 lg:hidden">
        <Link href="/chief" aria-label="Chief">
          <Bot dark seed="chief" size={38} className={cx(chiefActive && "drop-shadow-[0_0_0_2px_#0071e3]")} />
        </Link>
        {loopers.map((l) => (
          <Link key={l.id} href={`/loopers/${l.id}`} aria-label={l.name} className="relative">
            <Bot color={l.color} seed={l.id} size={38} />
            {l.forYou > 0 && <span className="absolute -right-1 -top-1 h-3.5 min-w-3.5 rounded-full bg-blue px-1 text-[0.625rem] font-semibold leading-[14px] text-white">{l.forYou}</span>}
          </Link>
        ))}
        <Link href="/settings" className="ml-auto shrink-0 rounded-full bg-ink/[0.05] px-3 py-1.5 text-[0.8125rem]">
          Apps
        </Link>
      </div>

      <aside className="hidden h-dvh w-[300px] shrink-0 flex-col border-r border-ink/[0.06] bg-rail lg:flex">
        <div className="flex items-center justify-end gap-1.5 px-4 pb-1 pt-4">
          <button onClick={() => setSearching((s) => !s)} aria-label="Search loopers" className="flex h-9 w-9 items-center justify-center rounded-full bg-ink/[0.05] text-ink-2 hover:bg-ink/[0.08]">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
              <circle cx="7" cy="7" r="4.5" />
              <path d="m10.5 10.5 3 3" />
            </svg>
          </button>
          <Link href="/chief?hire=1" aria-label="Hire a looper with Chief" title="Hire a looper" className="flex h-9 w-9 items-center justify-center rounded-full bg-ink/[0.05] text-[1.25rem] leading-none text-ink-2 hover:bg-ink/[0.08]">
            +
          </Link>
        </div>



        {searching && (
          <div className="px-4 pt-2">
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search loopers" className="h-9 w-full rounded-[10px] bg-ink/[0.05] px-3 text-[0.875rem] outline-none" />
          </div>
        )}

        <nav className="mt-2 min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          {/* Chief sits in the list like a looper; its page is the hiring and management chat. */}
          {(!q || "chief".includes(q.toLowerCase())) && (
            <Link href="/chief" className={cx("flex items-center gap-3 rounded-[14px] px-2.5 py-2.5", chiefActive ? "bg-ink/[0.06]" : "hover:bg-ink/[0.03]")}>
              <Bot dark seed="chief" size={44} />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="truncate text-[0.9375rem] font-medium">Chief</span>
                  <span className="shrink-0 rounded-[5px] bg-ink/[0.05] px-1.5 text-[0.6875rem] text-mute">Hires & manages</span>
                </span>
                <span className="block truncate text-[0.8125rem] text-mute">{chiefPreview || "Tell me what number to move"}</span>
              </span>
            </Link>
          )}
          {shown.map((l) => {
            const active = path.startsWith(`/loopers/${l.id}`);
            return (
              <Link key={l.id} href={`/loopers/${l.id}`} className={cx("flex items-center gap-3 rounded-[14px] px-2.5 py-2.5", active ? "bg-ink/[0.06]" : "hover:bg-ink/[0.03]")}>
                <span className="relative">
                  <Bot color={l.color} seed={l.id} size={44} />
                  {l.running && <span className="pulse-dot absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full bg-green ring-2 ring-rail" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-[0.9375rem] font-medium">{l.name}</span>
                    {l.role && <span className="shrink-0 rounded-[5px] bg-ink/[0.05] px-1.5 text-[0.6875rem] text-mute">{l.role}</span>}
                    {l.forYou > 0 && <span className="ml-auto shrink-0 rounded-full bg-blue px-1.5 text-[0.6875rem] font-semibold text-white">{l.forYou}</span>}
                  </span>
                  <span className="block truncate text-[0.8125rem] text-mute">{l.preview || "No messages yet"}</span>
                </span>
              </Link>
            );
          })}
          {loopers.length === 0 && <p className="px-3 py-4 text-[0.8125rem] text-mute">No loopers yet. Ask Chief to hire one.</p>}
        </nav>

        <div className="flex items-center gap-2 border-t border-ink/[0.06] p-3">
          <div className="relative" ref={menuRef}>
            <button onClick={() => setMenu((m) => !m)} aria-label="Account" className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-b from-[#a1a1a6] to-[#6e6e73] text-[0.9375rem] font-semibold uppercase text-white">
              {(email || "?").slice(0, 1)}
            </button>
            {menu && (
              <div className="absolute bottom-12 left-0 z-50 w-64 rounded-[14px] border border-ink/[0.06] bg-panel p-1.5 shadow-[0_12px_40px_rgba(0,0,0,0.14)]">
                <div className="px-3 py-2">
                  <div className="truncate text-[0.9375rem] font-semibold">{email || "Signed in"}</div>
                  {plan && <div className="text-[0.8125rem] text-mute">Using your {plan} plan</div>}
                </div>
                <div className="my-1 h-px bg-line" />
                <Link href="/settings" onClick={() => setMenu(false)} className="block rounded-[8px] px-3 py-2 text-[0.875rem] hover:bg-ink/[0.04]">
                  Settings
                </Link>
                <button
                  onClick={async () => {
                    await signOutApp();
                    router.push("/login");
                    router.refresh();
                  }}
                  className="w-full rounded-[8px] px-3 py-2 text-left text-[0.875rem] hover:bg-ink/[0.04]"
                >
                  Sign out
                </button>
              </div>
            )}
          </div>
          <Link href="/settings" className="flex h-10 flex-1 items-center justify-center rounded-full bg-ink/[0.05] text-[0.9375rem] font-medium hover:bg-ink/[0.08]">
            Connect apps
          </Link>
        </div>
      </aside>
    </>
  );
}
