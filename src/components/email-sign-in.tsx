"use client";

import { useState, useTransition } from "react";
import { sendEmailCode, signInWithEmailCode } from "@/app/auth-actions";
import { cx } from "./ui";

/** Where to go after signing in: only paths on this site. */
const safeNext = (next: string | undefined) => (next && next.startsWith("/") && !next.startsWith("//") ? next : "/");

const button = "flex h-12 w-full items-center justify-center gap-2.5 rounded-full px-5 text-[0.9375rem] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50";

/** A 6-digit code by email. */
export function EmailSignIn({ next }: { next?: string }) {
  const [email, setEmail] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const target = safeNext(next);

  const sendCode = () =>
    start(async () => {
      setError(null);
      const e = email.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return setError("Enter a valid email address.");
      const r = await sendEmailCode(e);
      if (r) return setError(r.error);
      setSentTo(e);
      setCode("");
    });

  const verify = (token: string) =>
    start(async () => {
      setError(null);
      const r = await signInWithEmailCode(sentTo!, token);
      if (r) return setError(r.error);
      window.location.assign(target);
    });

  if (sentTo)
    return (
      <div className="flex flex-col gap-3">
        <p className="text-center text-[0.875rem] text-mute">
          We sent a 6-digit code to <span className="font-medium text-ink">{sentTo}</span>.
        </p>
        <input
          autoFocus
          value={code}
          onChange={(e) => {
            const v = e.target.value.replace(/\D/g, "").slice(0, 6);
            setCode(v);
            if (v.length === 6) verify(v);
          }}
          inputMode="numeric"
          autoComplete="one-time-code"
          aria-label="6-digit code"
          placeholder="••••••"
          className="h-14 w-full rounded-[14px] bg-ink/[0.05] text-center font-mono text-[1.5rem] tracking-[0.5em] outline-none focus:bg-ink/[0.08]"
        />
        <button disabled={pending || code.length !== 6} onClick={() => verify(code)} className={cx(button, "bg-ink text-page hover:bg-ink-2")}>
          {pending ? "Checking…" : "Sign in"}
        </button>
        {error && <p className="text-center text-[0.8125rem] text-red">{error}</p>}
        <div className="flex justify-center gap-4 text-[0.8125rem] text-mute">
          <button onClick={sendCode} disabled={pending} className="hover:text-ink">
            Send a new code
          </button>
          <button onClick={() => (setSentTo(null), setError(null))} className="hover:text-ink">
            Use another email
          </button>
        </div>
      </div>
    );

  return (
    <div className="flex flex-col gap-3">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          sendCode();
        }}
        className="flex flex-col gap-3"
      >
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          placeholder="you@company.com"
          aria-label="Email"
          className="h-12 w-full rounded-full bg-ink/[0.05] px-5 text-[0.9375rem] outline-none placeholder:text-faint focus:bg-ink/[0.08]"
        />
        <button type="submit" disabled={pending || !email} className={cx(button, "bg-ink text-page hover:bg-ink-2")}>
          {pending ? "Sending…" : "Email me a code"}
        </button>
      </form>
      {error && <p className="text-center text-[0.8125rem] text-red">{error}</p>}
    </div>
  );
}
