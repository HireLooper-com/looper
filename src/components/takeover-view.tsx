"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { beginTakeover, endTakeover, openInTakeover } from "@/app/computer-actions";
import type { Accent } from "@/lib/types";
import { Bot, Button, cx } from "./ui";

// The owner drives the looper's browser: frames come over a WebSocket from the browser's live
// stream, and clicks, scrolls and keys go back the same way. Coordinates are in page pixels, so
// they're scaled from the size the frame is shown at.

type Live = { ws: string; expiresAt: number; question?: string };
type Status = "starting" | "connecting" | "live" | "lost";

// Keys that type nothing but need their key code for the page to react (Backspace, arrows…).
const CODES: Record<string, number> = { Backspace: 8, Tab: 9, Enter: 13, Escape: 27, " ": 32, PageUp: 33, PageDown: 34, End: 35, Home: 36, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, Delete: 46 };
const keyCode = (e: React.KeyboardEvent) => CODES[e.key] ?? (e.key.length === 1 ? e.key.toUpperCase().charCodeAt(0) : 0);
const modifiers = (e: { altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) => (e.altKey ? 1 : 0) | (e.ctrlKey ? 2 : 0) | (e.metaKey ? 4 : 0) | (e.shiftKey ? 8 : 0);

export function TakeoverView({ looper, askId, onClose }: { looper: { id: string; name: string; color: Accent }; askId?: string; onClose: () => void }) {
  const router = useRouter();
  const [live, setLive] = useState<Live | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("starting");
  const [url, setUrl] = useState("");
  const [draft, setDraft] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [ending, startEnding] = useTransition();
  const screen = useRef<HTMLImageElement>(null);
  const pad = useRef<HTMLDivElement>(null);
  const sock = useRef<WebSocket | null>(null);
  const moving = useRef(false);
  const size = useRef({ w: 1280, h: 720 });

  // Wake the machine and get the live view's address (reuses a take-over that's already running).
  useEffect(() => {
    let alive = true;
    beginTakeover(looper.id, askId).then((r) => {
      if (!alive) return;
      if (r.ok) {
        setLive(r.value);
        setStatus("connecting");
      } else setError(r.error);
    });
    return () => {
      alive = false;
    };
  }, [looper.id, askId]);

  // Connect, and reconnect a few times if the socket drops.
  useEffect(() => {
    if (!live) return;
    let tries = 0;
    let closed = false;
    let retry: ReturnType<typeof setTimeout>;
    const connect = () => {
      const ws = new WebSocket(live.ws);
      sock.current = ws;
      ws.onmessage = (m) => {
        const msg = JSON.parse(String(m.data)) as { type: string; data?: string; url?: string; metadata?: { deviceWidth: number; deviceHeight: number } };
        if (msg.type === "frame" && msg.data && screen.current) {
          screen.current.src = `data:image/jpeg;base64,${msg.data}`;
          if (msg.metadata) size.current = { w: msg.metadata.deviceWidth, h: msg.metadata.deviceHeight };
          tries = 0;
          setStatus("live");
        } else if (msg.type === "url" && msg.url) setUrl(msg.url);
      };
      ws.onclose = () => {
        if (closed) return;
        if (tries++ < 4) retry = setTimeout(connect, 1500 * tries);
        else setStatus("lost");
      };
    };
    connect();
    return () => {
      closed = true;
      clearTimeout(retry);
      sock.current?.close();
    };
  }, [live]);

  // A clock for the time left; hand the browser back when it runs out.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const left = live ? Math.max(0, live.expiresAt - now) : 0;

  const send = (m: object) => {
    if (sock.current?.readyState === WebSocket.OPEN) sock.current.send(JSON.stringify(m));
  };
  const point = (e: { clientX: number; clientY: number }) => {
    const r = screen.current!.getBoundingClientRect();
    return { x: Math.round(((e.clientX - r.left) * size.current.w) / r.width), y: Math.round(((e.clientY - r.top) * size.current.h) / r.height) };
  };
  const mouse = (eventType: string, e: React.MouseEvent, extra: object = {}) =>
    send({ type: "input_mouse", eventType, ...point(e), modifiers: modifiers(e), button: e.button === 2 ? "right" : "left", ...extra });

  // Wheel needs a non-passive listener so the app page doesn't scroll instead of theirs.
  useEffect(() => {
    const el = pad.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      send({ type: "input_mouse", eventType: "mouseWheel", ...point(e), deltaX: e.deltaX, deltaY: e.deltaY, button: "none" });
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, [status]);

  const finish = (note?: string) =>
    startEnding(async () => {
      const r = await endTakeover(looper.id, note);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      onClose();
      router.push(`/loopers/${looper.id}?tab=chat`);
    });

  useEffect(() => {
    if (live && left === 0 && !ending) finish("The take-over timed out.");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [left === 0]);

  if (error)
    return (
      <div className="tile flex flex-col items-center gap-3 px-6 py-12 text-center">
        <div className="text-[1rem] font-medium">Couldn&apos;t take over</div>
        <p className="max-w-[48ch] text-[0.875rem] text-mute">{error}</p>
        <Button size="sm" variant="soft" onClick={onClose}>
          Back
        </Button>
      </div>
    );

  return (
    <section className="tile min-w-0 overflow-hidden">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <form
          className="flex min-w-0 flex-1"
          onSubmit={(e) => {
            e.preventDefault();
            if (draft?.trim()) void openInTakeover(looper.id, draft.trim()).then((r) => (r.ok ? setDraft(null) : setError(r.error)));
          }}
        >
          <input
            value={draft ?? url.replace(/^https?:\/\//, "")}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => !draft?.trim() && setDraft(null)}
            placeholder="Go to a page"
            aria-label="Address"
            className="min-w-0 flex-1 rounded-full bg-ink/[0.05] px-3 py-1 text-[0.8125rem] outline-none focus:bg-ink/[0.08]"
          />
        </form>
        {live && <span className="shrink-0 text-[0.75rem] tabular-nums text-mute">{`${Math.floor(left / 60_000)}:${String(Math.floor((left % 60_000) / 1000)).padStart(2, "0")}`}</span>}
        <Button size="sm" disabled={ending || status === "starting"} onClick={() => finish()}>
          {ending ? "Handing back…" : `Done, back to ${looper.name}`}
        </Button>
      </div>

      {live?.question && <div className="border-b border-line bg-ink/[0.03] px-4 py-2 text-[0.8125rem]">{looper.name} asked: {live.question}</div>}

      <div
        ref={pad}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Tab" || e.key === " " || e.key.startsWith("Arrow") || e.key === "Backspace") e.preventDefault();
          const text = e.key === "Enter" ? "\r" : e.key.length === 1 && !e.ctrlKey && !e.metaKey ? e.key : undefined;
          send({ type: "input_keyboard", eventType: "keyDown", key: e.key, code: e.code, text, modifiers: modifiers(e), windowsVirtualKeyCode: keyCode(e) });
        }}
        onKeyUp={(e) => send({ type: "input_keyboard", eventType: "keyUp", key: e.key, code: e.code, modifiers: modifiers(e), windowsVirtualKeyCode: keyCode(e) })}
        onPaste={(e) => {
          // Pasting (a password manager, a code from an email) types it character by character.
          e.preventDefault();
          for (const ch of e.clipboardData.getData("text").slice(0, 500)) {
            send({ type: "input_keyboard", eventType: "keyDown", key: ch, text: ch });
            send({ type: "input_keyboard", eventType: "keyUp", key: ch });
          }
        }}
        className="relative bg-well outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          ref={screen}
          alt={`${looper.name}'s browser`}
          draggable={false}
          onContextMenu={(e) => e.preventDefault()}
          onMouseDown={(e) => {
            pad.current?.focus();
            mouse("mousePressed", e, { clickCount: e.detail || 1 });
          }}
          onMouseUp={(e) => mouse("mouseReleased", e, { clickCount: e.detail || 1 })}
          onMouseMove={(e) => {
            // One move per frame is plenty, and keeps the socket clear for clicks.
            if (moving.current) return;
            moving.current = true;
            requestAnimationFrame(() => (moving.current = false));
            send({ type: "input_mouse", eventType: "mouseMoved", ...point(e), button: e.buttons & 1 ? "left" : "none", modifiers: modifiers(e) });
          }}
          className={cx("block h-auto w-full cursor-default select-none", status !== "live" && "invisible aspect-[16/9]")}
        />
        {status !== "live" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-[0.875rem] text-mute">
            <Bot size={56} color={looper.color} seed={looper.id} className={cx(status !== "lost" && "looping")} />
            {status === "lost" ? "Lost the connection to the browser. Hand it back, or reload to try again." : status === "starting" ? "Waking up the computer (about 20 seconds)…" : "Connecting to the browser…"}
          </div>
        )}
      </div>

      <div className="border-t border-line px-4 py-2.5 text-[0.75rem] text-mute">
        Click into the page and type: it goes to {looper.name}&apos;s browser. Logins you make stay in that browser, so {looper.name} can use them on later runs. Your keystrokes go straight to the browser; Looper doesn&apos;t record them.
      </div>
    </section>
  );
}
