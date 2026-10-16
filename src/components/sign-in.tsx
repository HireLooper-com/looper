"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { pollGrokLogin, startChatGPTLogin, startGrokLogin } from "@/app/actions";
import { cx } from "./ui";

export function OpenAIMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden fill="currentColor">
      <path d="M22.28 9.82a5.98 5.98 0 0 0-.52-4.91 6.05 6.05 0 0 0-6.51-2.9A6.07 6.07 0 0 0 4.98 4.18a5.98 5.98 0 0 0-4 2.9 6.05 6.05 0 0 0 .74 7.1 5.98 5.98 0 0 0 .51 4.91 6.05 6.05 0 0 0 6.52 2.9A5.98 5.98 0 0 0 13.26 24a6.06 6.06 0 0 0 5.77-4.21 5.99 5.99 0 0 0 4-2.9 6.06 6.06 0 0 0-.75-7.07zM13.26 22.43a4.48 4.48 0 0 1-2.88-1.04l.14-.08 4.78-2.76a.79.79 0 0 0 .39-.68v-6.74l2.02 1.17a.07.07 0 0 1 .04.05v5.58a4.5 4.5 0 0 1-4.49 4.5zM3.6 18.3a4.47 4.47 0 0 1-.53-3.01l.14.08 4.78 2.76a.77.77 0 0 0 .78 0l5.84-3.37v2.33a.08.08 0 0 1-.03.06l-4.83 2.79a4.5 4.5 0 0 1-6.14-1.64zM2.34 7.9a4.48 4.48 0 0 1 2.37-1.97v5.68a.77.77 0 0 0 .39.68l5.81 3.35-2.02 1.17a.08.08 0 0 1-.07 0l-4.83-2.79A4.5 4.5 0 0 1 2.34 7.87zm16.6 3.86-5.83-3.39 2.02-1.16a.08.08 0 0 1 .07 0l4.83 2.79a4.49 4.49 0 0 1-.68 8.1v-5.68a.79.79 0 0 0-.41-.66zm2.01-3.02-.14-.09-4.77-2.78a.78.78 0 0 0-.79 0L9.41 9.24V6.91a.07.07 0 0 1 .03-.06l4.83-2.79a4.5 4.5 0 0 1 6.68 4.66zM8.31 12.86 6.29 11.7a.08.08 0 0 1-.04-.06V6.07a4.5 4.5 0 0 1 7.37-3.45l-.14.08-4.78 2.76a.79.79 0 0 0-.39.68zm1.1-2.37 2.6-1.5 2.6 1.5v3l-2.6 1.5-2.6-1.5z" />
    </svg>
  );
}

/** Official Grok app icon (grok.com). */
export function GrokMark({ className }: { className?: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src="/grok.png" alt="" className={cx("rounded-[22%]", className)} />;
}

/** "Continue with ChatGPT": OpenAI's browser sign-in. Only available when the app runs locally. */
export function ChatGPTButton({ isLocal, label = "Continue with ChatGPT", className }: { isLocal: boolean; label?: string; className?: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-2">
      <button
        disabled={!isLocal || pending}
        onClick={() =>
          start(async () => {
            setError(null);
            try {
              const r = await startChatGPTLogin();
              if (r.ok) window.location.assign(r.value);
              else setError(r.error);
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e));
            }
          })
        }
        className={cx(
          "flex h-12 w-full items-center justify-center gap-2.5 rounded-full bg-ink px-5 text-[0.9375rem] font-medium text-page transition-colors hover:bg-ink-2 disabled:cursor-not-allowed disabled:opacity-40",
          className,
        )}
      >
        <OpenAIMark className="h-[18px] w-[18px]" />
        {pending ? "Opening ChatGPT…" : label}
      </button>
      {!isLocal && <p className="text-[0.75rem] leading-snug text-mute">OpenAI allows ChatGPT sign-in only for apps running on your own machine. Run Chieflooper locally to use it.</p>}
      {error && <p className="text-[0.75rem] text-red">{error}</p>}
    </div>
  );
}

type Device = Extract<Awaited<ReturnType<typeof startGrokLogin>>, { ok: true }>["value"];

/** "Continue with Grok": device code confirmed on x.ai, then polled from here. */
export function GrokSignIn({ label = "Continue with Grok", onConnected, className }: { label?: string; onConnected?: () => void; className?: string }) {
  const router = useRouter();
  const [device, setDevice] = useState<Device | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  const poll = (d: Device) => {
    timer.current = setTimeout(async () => {
      try {
        const r = await pollGrokLogin(d.flowId);
        if (r.status === "pending") return poll(d);
        setDevice(null);
        if (r.status === "connected") {
          if (onConnected) onConnected();
          else router.push("/");
          router.refresh();
          return;
        }
        setMessage(
          r.status === "denied" ? "Sign-in was declined on x.ai." : r.status === "not-allowed" ? "This account isn't on the allowed list for this workspace." : "The code expired. Start again.",
        );
      } catch (e) {
        setDevice(null);
        setMessage(e instanceof Error ? e.message : String(e));
      }
    }, d.interval * 1000);
  };

  const begin = () =>
    start(async () => {
      setMessage(null);
      try {
        const r = await startGrokLogin();
        if (!r.ok) return setMessage(r.error);
        const d = r.value;
        setDevice(d);
        window.open(d.verificationUriComplete, "_blank", "noopener");
        poll(d);
      } catch (e) {
        setMessage(e instanceof Error ? e.message : String(e));
      }
    });

  if (device)
    return (
      <div className="flex flex-col gap-3 rounded-[20px] border border-line bg-panel p-4">
        <div className="eyebrow">Confirm on x.ai</div>
        <div className="font-mono text-[1.75rem] font-medium tracking-[0.12em]">{device.userCode}</div>
        <p className="text-[0.8125rem] leading-snug text-mute">A tab opened at x.ai. Check the code matches and approve. This page continues on its own.</p>
        <div className="flex items-center gap-3">
          <a href={device.verificationUriComplete} target="_blank" rel="noopener noreferrer" className="text-[0.8125rem] font-medium underline underline-offset-4">
            Open x.ai again
          </a>
          <span className="flex items-center gap-1.5 text-[0.75rem] text-mute">
            <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-green" /> Waiting for approval
          </span>
          <button
            className="ml-auto text-[0.75rem] text-mute hover:text-ink"
            onClick={() => {
              if (timer.current) clearTimeout(timer.current);
              setDevice(null);
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    );

  return (
    <div className="flex flex-col gap-2">
      <button
        onClick={begin}
        disabled={pending}
        className={cx(
          "flex h-12 w-full items-center justify-center gap-2.5 rounded-full border border-ink/15 bg-panel px-5 text-[0.9375rem] font-medium text-ink transition-colors hover:border-ink/40 disabled:opacity-50",
          className,
        )}
      >
        <GrokMark className="h-5 w-5" />
        {pending ? "Getting a code…" : label}
      </button>
      {message && <p className="text-[0.75rem] text-red">{message}</p>}
    </div>
  );
}
