"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { sendNudge } from "@/app/admin-actions";
import type { Nudge } from "@/lib/admin";
import { Button, Input, Textarea, timeAgo } from "./ui";

/** One reason a workspace is stuck: a draft note to its owner, edited and sent from here. */
export function NudgeButton({ wsId, nudge, to, canSend }: { wsId: string; nudge: Nudge; to?: string; canSend: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [subject, setSubject] = useState(nudge.subject);
  const [body, setBody] = useState(nudge.body);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const send = () =>
    start(async () => {
      setError(null);
      const r = await sendNudge(wsId, nudge.reason, subject, body);
      if (!r.ok) return setError(r.error);
      setOpen(false);
      router.refresh();
    });

  if (!open)
    return (
      <Button size="sm" variant={nudge.sentAt ? "ghost" : "soft"} onClick={() => setOpen(true)} disabled={!to} title={to ? `Email ${to}` : "No email address"}>
        {nudge.sentAt ? `Nudged ${timeAgo(nudge.sentAt)}` : "Nudge"}
      </Button>
    );
  return (
    <div className="mt-3 flex w-full flex-col gap-2">
      <div className="text-[0.75rem] text-mute">To {to}</div>
      <Input value={subject} onChange={(e) => setSubject(e.target.value)} aria-label="Subject" />
      <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={9} aria-label="Message" />
      {error && <div className="text-[0.8125rem] text-red">{error}</div>}
      {!canSend && <div className="text-[0.8125rem] text-mute">Sending needs LOOPS_API_KEY and LOOPS_GENERIC_TEMPLATE_ID. Copy the text to send it yourself.</div>}
      <div className="flex gap-2">
        <Button size="sm" onClick={send} disabled={pending || !canSend}>
          {pending ? "Sending…" : "Send"}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
