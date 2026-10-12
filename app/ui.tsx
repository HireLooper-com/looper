"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import type { FormState } from "./actions";

export function Submit({ children, busy, className = "btn" }: { children: React.ReactNode; busy?: string; className?: string }) {
  const { pending } = useFormStatus();
  return (
    <button className={className} type="submit" disabled={pending}>
      {pending ? busy ?? "Saving" : children}
    </button>
  );
}

/** A form bound to a server action that returns { error } or { ok }. */
export function Form({
  action,
  children,
  className,
  reset,
}: {
  action: (s: FormState, f: FormData) => Promise<FormState>;
  children: React.ReactNode;
  className?: string;
  reset?: boolean;
}) {
  const [state, run] = useActionState(action, undefined);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (reset && !state?.error) ref.current?.reset();
  }, [state, reset]);
  return (
    <form action={run} className={className} ref={ref}>
      {children}
      {state?.error && <p className="err" role="alert">{state.error}</p>}
      {state?.ok && <p className="note" role="status">{state.ok}</p>}
    </form>
  );
}

/** Hidden input with the browser's time zone, so signup gets the founder's calendar right. */
export function TzField() {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.value = Intl.DateTimeFormat().resolvedOptions().timeZone;
  }, []);
  return <input type="hidden" name="tz" ref={ref} defaultValue="Europe/Amsterdam" />;
}

/** Email, then the 6-digit code we mailed. Same flow for sign in and sign up. */
export function CodeForm({
  action,
  label,
  busy,
  children,
}: {
  action: (s: FormState, f: FormData) => Promise<FormState>;
  label: string;
  busy: string;
  children?: React.ReactNode;
}) {
  const [state, run] = useActionState(action, undefined);
  const [editing, setEditing] = useState(false);
  useEffect(() => setEditing(false), [state]);
  const email = editing ? undefined : state?.email;

  return (
    <form action={run} key={email ?? "email"}>
      {email ? (
        <>
          <input type="hidden" name="email" value={email} />
          <label htmlFor="code">6-digit code from the email</label>
          <input
            id="code"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9 ]{6,7}"
            maxLength={7}
            required
            autoFocus
            placeholder="123456"
          />
          <div style={{ marginTop: 20, display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
            <Submit busy={busy}>{label}</Submit>
            <button className="link" type="submit" name="resend" value="1" formNoValidate>
              Send a new code
            </button>
            <button className="link" type="button" onClick={() => setEditing(true)}>
              Use another email
            </button>
          </div>
        </>
      ) : (
        <>
          <label htmlFor="email">Work email</label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            autoFocus
            defaultValue={state?.email}
            placeholder="you@company.com"
          />
          {children}
          <div style={{ marginTop: 20 }}>
            <Submit busy="Sending">Email me a code</Submit>
          </div>
        </>
      )}
      {state?.error && <p className="err" role="alert">{state.error}</p>}
      {email && state?.ok && <p className="note" role="status">{state.ok}</p>}
    </form>
  );
}
