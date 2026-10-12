"use client";

import { useActionState, useEffect, useState } from "react";
import { editBrief, editSetup, fire, rerunSetup } from "../../../actions";
import { Submit } from "../../../ui";

// The Brief tab's interactive parts: read view by default, Edit swaps in a textarea. The read view
// is rendered on the server and passed in as children.

export function Editable({
  looper,
  step,
  text,
  rows = 12,
  children,
}: {
  looper: number;
  step?: string; // a setup step; without it, the one-line brief
  text: string;
  rows?: number;
  children: React.ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const [state, run] = useActionState(step ? editSetup : editBrief, undefined);
  useEffect(() => {
    if (state?.ok) setEditing(false);
  }, [state]);

  if (!editing)
    return (
      <div className="xpg-ed">
        {children}
        <button type="button" className="link xpg-eb" onClick={() => setEditing(true)}>
          Edit
        </button>
        {state?.ok && (
          <p className="note" role="status">
            {state.ok}
          </p>
        )}
      </div>
    );

  return (
    <form action={run} className="xpg-form">
      <input type="hidden" name="looper" value={looper} />
      {step && <input type="hidden" name="step" value={step} />}
      <textarea
        name={step ? "text" : "brief"}
        defaultValue={text}
        rows={rows}
        maxLength={step ? 6000 : 400}
        autoFocus
        aria-label={step ? "Notes, one key: value line per topic" : "What the business does"}
        onKeyDown={(e) => {
          if (e.key === "Escape") setEditing(false);
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) e.currentTarget.form?.requestSubmit();
        }}
      />
      {state?.error && (
        <p className="err" role="alert">
          {state.error}
        </p>
      )}
      <div className="xpg-act">
        <Submit className="btn sm">Save</Submit>
        <button type="button" className="btn2 sm" onClick={() => setEditing(false)}>
          Cancel
        </button>
        <span className="dim2">{step ? "One key: value line per topic. ⌘Enter saves, Esc cancels." : "⌘Enter saves, Esc cancels."}</span>
      </div>
    </form>
  );
}

/** Run every setup step again. Notes a person edited go to history first, so ask before. */
export function LearnAgain({ looper, edited }: { looper: number; edited: boolean }) {
  const [state, run] = useActionState(rerunSetup, undefined);
  return (
    <form
      action={run}
      onSubmit={(e) => {
        if (edited && !confirm("Learn again replaces the notes you edited. They stay in earlier versions. Continue?")) e.preventDefault();
      }}
    >
      <input type="hidden" name="looper" value={looper} />
      <Submit className="btn2 sm" busy="Reading">
        Learn again
      </Submit>
      {state?.error && (
        <p className="err" role="alert">
          {state.error}
        </p>
      )}
      {state?.ok && (
        <p className="note" role="status">
          {state.ok}
        </p>
      )}
    </form>
  );
}

/** Fire the looper. Says what stops before it happens; nothing is deleted. `back` keeps the team page open after. */
export function Fire({ looper, name, back, className = "btn2 sm", label }: { looper: number; name: string; back?: string; className?: string; label?: string }) {
  return (
    <form
      action={fire}
      onSubmit={(e) => {
        if (!confirm(`Fire ${name}? Its routines stop, cards waiting for approval are rejected and its open pull requests are closed. The history stays.`))
          e.preventDefault();
      }}
    >
      <input type="hidden" name="looper" value={looper} />
      {back && <input type="hidden" name="back" value={back} />}
      <Submit className={className} busy="Firing">
        {label ?? `Fire ${name}`}
      </Submit>
    </form>
  );
}
