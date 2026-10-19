"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { searchEverything, startSkill, type Hit } from "@/app/team-actions";
import type { Accent } from "@/lib/types";
import { Bot, cx } from "./ui";

const EVENT = "chieflooper:palette";
export const openPalette = () => window.dispatchEvent(new Event(EVENT));

type Entry = { id: string; primary?: boolean; section: "Go to" | "Do" | "Found"; label: string; hint?: string; bot?: { color?: Accent; seed: string; dark?: boolean }; run: () => void | Promise<void> };

const SECTIONS = [
  ["chat", "Chat"],
  ["board", "Kanban"],
  ["calendar", "Calendar"],
  ["metric", "Metric"],
  ["retro", "Retros"],
  ["database", "Database"],
  ["canvas", "Canvas"],
  ["skills", "Skills"],
  ["apps", "Apps"],
] as const;

/** ⌘K: jump anywhere, run a skill, hire, or search what the loopers know. */
export function CommandPalette({ loopers }: { loopers: { id: string; name: string; color: Accent; skills: { id: string; name: string }[] }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [active, setActive] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    const onOpen = () => setOpen(true);
    document.addEventListener("keydown", onKey);
    window.addEventListener(EVENT, onOpen);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.removeEventListener(EVENT, onOpen);
    };
  }, []);

  // Search contents as you type, a beat after the last key.
  useEffect(() => {
    if (!open || q.trim().length < 2) return;
    let alive = true;
    const t = setTimeout(() => {
      searchEverything(q)
        .then((h) => alive && setHits(h))
        .catch(() => undefined);
    }, 180);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q, open]);

  const close = () => {
    setOpen(false);
    setQ("");
    setHits([]);
    setActive(0);
  };
  const go = (href: string) => () => {
    close();
    router.push(href);
  };

  const entries = useMemo(() => {
    const query = q.trim().toLowerCase();
    const match = (s: string) => !query || s.toLowerCase().includes(query) || query.split(/\s+/).every((w) => s.toLowerCase().includes(w));
    const out: Entry[] = [
      { id: "inbox", primary: true, section: "Go to", label: "Needs you", hint: "Inbox", run: go("/inbox") },
      { id: "chief", primary: true, section: "Go to", label: "Chief", hint: "Daily brief", bot: { seed: "chief", dark: true }, run: go("/chief") },
    ];
    for (const l of loopers) {
      out.push({ id: `l-${l.id}`, primary: true, section: "Go to", label: l.name, bot: { color: l.color, seed: l.id }, run: go(`/loopers/${l.id}`) });
      for (const [tab, label] of SECTIONS) out.push({ id: `l-${l.id}-${tab}`, section: "Go to", label: `${l.name} › ${label}`, bot: { color: l.color, seed: l.id }, run: go(`/loopers/${l.id}?tab=${tab}`) });
    }
    out.push({ id: "hire", primary: true, section: "Do", label: "Hire a looper", run: go("/hire") });
    for (const l of loopers)
      for (const s of l.skills)
        out.push({
          id: `run-${s.id}`,
          section: "Do",
          label: `Run ${s.name}`,
          hint: l.name,
          bot: { color: l.color, seed: l.id },
          run: async () => {
            const r = await startSkill(l.id, s.id);
            close();
            if (r.ok) router.push(`/loopers/${l.id}?tab=chat`);
            else setToast(r.error);
          },
        });
    out.push({ id: "apps", primary: true, section: "Do", label: "Connect apps", run: go("/settings") }, { id: "settings", primary: true, section: "Do", label: "Settings", run: go("/settings") });

    // Without a query, keep the list short: places first, a few actions.
    const filtered = query ? out.filter((e) => match(`${e.label} ${e.hint ?? ""}`)) : out.filter((e) => e.primary);
    const found: Entry[] = query.length >= 2 ? hits.map((h, i) => ({ id: `hit-${i}`, section: "Found", label: h.title, hint: h.detail, run: go(h.href) })) : [];
    return [...filtered.slice(0, query ? 14 : 20), ...found];
  }, [q, hits, loopers]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    list.current?.querySelector(`[data-i="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!open)
    return toast ? (
      <div className="fixed bottom-6 left-1/2 z-[60] -translate-x-1/2 rounded-full bg-ink px-4 py-2 text-[0.8125rem] text-page" onClick={() => setToast(null)}>
        {toast}
      </div>
    ) : null;

  let last = "";
  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center bg-black/25 px-4 pt-[12vh] backdrop-blur-[2px] fade-in" onMouseDown={close}>
      <div className="w-full max-w-[600px] overflow-hidden rounded-[18px] bg-panel shadow-[0_24px_80px_rgba(0,0,0,0.28)] pop-in" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 border-b border-line px-4">
          <svg width="17" height="17" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="text-mute" aria-hidden>
            <circle cx="7" cy="7" r="4.5" />
            <path d="m10.5 10.5 3 3" />
          </svg>
          <input
            autoFocus
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setActive(0);
              if (e.target.value.trim().length < 2) setHits([]);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") close();
              else if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((a) => Math.min(entries.length - 1, a + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((a) => Math.max(0, a - 1));
              } else if (e.key === "Enter") {
                e.preventDefault();
                void entries[active]?.run();
              }
            }}
            placeholder="Jump to a looper, run a skill, search rows and notes…"
            className="h-14 flex-1 bg-transparent text-[1rem] outline-none placeholder:text-faint"
          />
          <kbd className="rounded-[6px] bg-ink/[0.06] px-1.5 text-[0.6875rem] text-mute">esc</kbd>
        </div>
        <div ref={list} className="max-h-[55vh] overflow-y-auto p-2">
          {entries.length === 0 && <div className="px-3 py-8 text-center text-[0.875rem] text-mute">Nothing matches “{q}”.</div>}
          {entries.map((e, i) => {
            const head = e.section !== last ? ((last = e.section), <div key={`h-${e.section}`} className="eyebrow px-3 pb-1 pt-3 first:pt-1">{e.section}</div>) : null;
            return (
              <div key={e.id}>
                {head}
                <button
                  data-i={i}
                  onMouseMove={() => setActive(i)}
                  onClick={() => void e.run()}
                  className={cx("flex w-full items-center gap-3 rounded-[10px] px-3 py-2 text-left text-[0.9375rem]", i === active && "bg-ink/[0.06]")}
                >
                  {e.bot ? <Bot size={22} color={e.bot.color} seed={e.bot.seed} dark={e.bot.dark} /> : <span className="flex h-[22px] w-[22px] items-center justify-center text-mute">{e.section === "Found" ? "·" : "→"}</span>}
                  <span className="min-w-0 flex-1 truncate">{e.label}</span>
                  {e.hint && <span className="shrink-0 text-[0.8125rem] text-mute">{e.hint}</span>}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
