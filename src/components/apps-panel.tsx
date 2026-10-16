"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, useTransition } from "react";
import { addLooperApp, connectApp, connectMcpApp, disconnectAccount, looperAppStatus, removeLooperApp, searchApps } from "@/app/actions";
import type { AppRef } from "@/lib/types";
import { Button, Input, Panel, Pill, cx } from "./ui";

type Status = Awaited<ReturnType<typeof looperAppStatus>>;
type Row = Status["apps"][number];

function AppIcon({ app }: { app: Pick<AppRef, "name" | "logo"> }) {
  if (app.logo)
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={app.logo} alt="" className="h-10 w-10 rounded-[22%] bg-panel object-contain p-1 shadow-[inset_0_0_0_0.5px_rgba(0,0,0,0.08)]" />;
  return <span className="flex h-10 w-10 items-center justify-center rounded-[22%] bg-ink/[0.07] text-[1rem] font-semibold uppercase text-ink-2">{app.name.slice(0, 1)}</span>;
}

/** The "connect what this looper needs" checklist, used right after hiring and on the looper's Apps tab. */
export function AppsPanel({ looperId, looperName }: { looperId: string; looperName: string }) {
  const router = useRouter();
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, start] = useTransition();

  const load = useCallback(() => looperAppStatus(looperId).then(setStatus).catch((e) => setError(String(e?.message ?? e))), [looperId]);
  useEffect(() => {
    load();
  }, [load]);

  const connect = (row: Row, another = false) =>
    start(async () => {
      setBusy(row.slug);
      setError(null);
      try {
        if (row.via === "composio") {
          const r = await connectApp(looperId, row.slug, another);
          if (r.ok) return window.location.assign(r.value);
          setError(r.error);
          return;
        }
        const r = await connectMcpApp(looperId, row.slug);
        if (!r.ok) setError(r.error);
        await load();
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(null);
      }
    });

  const apps = status?.apps ?? [];
  const connected = apps.filter((a) => a.state === "connected").length;

  return (
    <div className="flex flex-col gap-4">
      <Panel className="p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-[1.25rem] font-semibold tracking-[-0.01em]">Apps {looperName} needs</div>
            <p className="mt-1 text-[0.875rem] text-mute">
              {apps.length === 0 ? "Add the apps this looper works with." : `${connected} of ${apps.length} connected. Each connection is yours alone and can be removed any time.`}
            </p>
          </div>
          {apps.length > 0 && connected === apps.length && <Pill tone="green">All set</Pill>}
        </div>

        {status && !status.composio && apps.some((a) => a.via === "composio") && (
          <div className="mt-4 rounded-[12px] bg-orange/10 px-4 py-3 text-[0.8125rem] text-orange">
            One-click connections need a Composio API key on the server (COMPOSIO_API_KEY). Until it&apos;s set, connect these through an integration hub in Settings.
          </div>
        )}
        {error && <div className="mt-4 rounded-[12px] bg-red/8 px-4 py-3 text-[0.8125rem] text-red">{error}</div>}

        <div className="mt-5 flex flex-col divide-y divide-line">
          {!status && <div className="py-6 text-[0.875rem] text-mute">Checking connections…</div>}
          {apps.map((row) => (
            <div key={row.slug} className="flex flex-col gap-3 py-4">
              <div className="flex items-center gap-3">
                <AppIcon app={row} />
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">{row.name}</div>
                  <div className="truncate text-[0.8125rem] text-mute">{row.detail}</div>
                </div>
                {row.state === "connected" ? (
                  <Pill tone="green">✓ Connected</Pill>
                ) : row.state === "unavailable" ? (
                  <Pill>Unavailable</Pill>
                ) : (
                  <Button size="sm" disabled={busy === row.slug || (row.via === "composio" && !status?.composio)} onClick={() => connect(row)}>
                    {busy === row.slug ? "Connecting…" : row.via === "mcp" ? "Check connection" : "Connect"}
                  </Button>
                )}
                <button
                  aria-label={`Remove ${row.name}`}
                  className="ml-1 text-[1.1rem] leading-none text-faint hover:text-red"
                  onClick={() =>
                    start(async () => {
                      await removeLooperApp(looperId, row.slug);
                      await load();
                    })
                  }
                >
                  ×
                </button>
              </div>
              {row.accounts && row.accounts.length > 0 && (
                <div className="ml-[52px] flex flex-col gap-1.5">
                  {row.accounts.map((a) => (
                    <div key={a.id} className="flex items-center justify-between gap-3 rounded-[10px] bg-well px-3 py-2 text-[0.8125rem]">
                      <span className="truncate">{a.label}</span>
                      <button
                        className="shrink-0 text-red hover:underline"
                        onClick={() => {
                          if (!confirm(`Disconnect ${a.label}? Loopers will lose access to it.`)) return;
                          start(async () => {
                            try {
                              await disconnectAccount(a.id);
                            } catch (e) {
                              setError(e instanceof Error ? e.message : String(e));
                            }
                            await load();
                          });
                        }}
                      >
                        Disconnect
                      </button>
                    </div>
                  ))}
                  <button className="w-fit text-[0.8125rem] font-medium text-blue hover:underline disabled:opacity-50" disabled={busy === row.slug} onClick={() => connect(row, true)}>
                    + Connect another {row.name} account
                  </button>
                </div>
              )}
              {row.setup && row.state !== "connected" && (
                <ol className="ml-[52px] list-decimal space-y-1 pl-4 text-[0.8125rem] text-ink-2">
                  {row.setup.map((step, i) => (
                    <li key={i} className="font-mono text-[0.75rem] leading-relaxed [&]:font-sans">
                      {step}
                    </li>
                  ))}
                </ol>
              )}
            </div>
          ))}
        </div>
      </Panel>

      <AddApp
        looperId={looperId}
        existing={apps.map((a) => a.slug)}
        onAdded={() => {
          load();
          router.refresh();
        }}
      />
    </div>
  );
}

function AddApp({ looperId, existing, onAdded }: { looperId: string; existing: string[]; onAdded: () => void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<AppRef[]>([]);
  const [pending, start] = useTransition();

  useEffect(() => {
    if (q.trim().length < 2) return;
    const t = setTimeout(() => searchApps(q).then(setResults).catch(() => setResults([])), 250);
    return () => clearTimeout(t);
  }, [q]);

  return (
    <Panel className="p-6">
      <div className="font-semibold">Add an app</div>
      <Input className="mt-3" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search thousands of apps: Stripe, Gmail, bunq, HubSpot…" />
      {q.trim().length >= 2 && (
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {results.length === 0 && <div className="text-[0.8125rem] text-mute">No matches yet.</div>}
          {results.map((r) => {
            const added = existing.includes(r.slug);
            return (
              <button
                key={`${r.via}:${r.slug}`}
                disabled={added || pending}
                onClick={() =>
                  start(async () => {
                    await addLooperApp(looperId, r);
                    setQ("");
                    setResults([]);
                    onAdded();
                  })
                }
                className={cx("flex items-center gap-3 rounded-[12px] p-2 text-left hover:bg-ink/[0.04] disabled:opacity-50")}
              >
                <AppIcon app={r} />
                <span className="flex-1 text-[0.9375rem]">{r.name}</span>
                <span className="text-[0.8125rem] text-blue">{added ? "Added" : "Add"}</span>
              </button>
            );
          })}
        </div>
      )}
    </Panel>
  );
}
