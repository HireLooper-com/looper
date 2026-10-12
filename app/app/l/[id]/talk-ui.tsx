"use client";

import { useFormStatus } from "react-dom";

/** The message box. While the looper answers, the sent text shows as a bubble with a typing line under it. */
export function Composer({ name, placeholder }: { name: string; placeholder: string }) {
  const { pending, data } = useFormStatus();
  const sent = data ? String(data.get("text") || data.get("ask") || "") : "";
  return (
    <>
      {pending && sent && (
        <div className="chat" aria-live="polite">
          <div className="msg me">
            <div className="who2">You</div>
            {sent}
          </div>
          <div className="msg typing">
            <div className="who2">{name}</div>
            Reading the data<span className="dots3" aria-hidden="true"><i /><i /><i /></span>
          </div>
        </div>
      )}
      <label htmlFor="talk-text" className="sr">
        Message {name}
      </label>
      <textarea
        id="talk-text"
        name="text"
        rows={2}
        maxLength={4000}
        disabled={pending}
        placeholder={placeholder}
        onKeyDown={(e) => {
          // Enter sends, Shift+Enter is a new line.
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            if (e.currentTarget.value.trim()) e.currentTarget.form?.requestSubmit();
          }
        }}
      />
    </>
  );
}
