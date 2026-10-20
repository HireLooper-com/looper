"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { computerStatus, resetComputer } from "@/app/computer-actions";
import { Button, Panel, Pill, timeAgo } from "./ui";

type Status = Awaited<ReturnType<typeof computerStatus>>;

/** The looper's own machine: where its browser was last and what it saw. */
export function ComputerCard({ looperId, looperName }: { looperId: string; looperName: string }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, start] = useTransition();
  const load = useCallback(() => computerStatus(looperId).then(setStatus).catch(() => undefined), [looperId]);
  useEffect(() => {
    load();
  }, [load]);

  if (!status?.available) return null;
  const s = status.state;
  const host = s?.url ? s.url.replace(/^https?:\/\//, "").replace(/\/$/, "") : null;

  return (
    <Panel className="p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[1.25rem] font-semibold tracking-[-0.01em]">Computer</div>
          <p className="mt-1 max-w-[56ch] text-[0.875rem] text-mute">
            {looperName} has a private Linux machine with Chrome for websites no app covers. It remembers logins, wakes up when needed and sleeps between runs.
          </p>
        </div>
        <Pill>{s ? "Asleep" : "Not used yet"}</Pill>
      </div>

      {s && (s.shot || host) && (
        <div className="mt-5 overflow-hidden rounded-[14px] bg-well">
          {s.shot && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={s.shot} alt={s.title ? `Screenshot of ${s.title}` : "Latest screenshot"} className="block max-h-[420px] w-full object-cover object-top" />
          )}
          {host && (
            <div className="flex items-center gap-2 px-4 py-2.5 text-[0.8125rem]">
              <span className="min-w-0 flex-1 truncate">
                <span className="font-medium">{s.title || host}</span>
                {s.title && <span className="text-mute"> · {host}</span>}
              </span>
              <span className="shrink-0 text-faint">{timeAgo(s.at)}</span>
            </div>
          )}
        </div>
      )}

      {s && (
        <div className="mt-4 flex items-center gap-2">
          {confirming ? (
            <>
              <span className="text-[0.8125rem] text-mute">Delete its files and logins?</span>
              <Button
                size="sm"
                variant="danger"
                disabled={busy}
                onClick={() =>
                  start(async () => {
                    await resetComputer(looperId);
                    setConfirming(false);
                    await load();
                  })
                }
              >
                {busy ? "Wiping…" : "Wipe"}
              </Button>
              <Button size="sm" variant="soft" onClick={() => setConfirming(false)}>
                Cancel
              </Button>
            </>
          ) : (
            <Button size="sm" variant="soft" onClick={() => setConfirming(true)}>
              Wipe computer
            </Button>
          )}
        </div>
      )}
    </Panel>
  );
}
