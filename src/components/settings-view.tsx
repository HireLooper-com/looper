"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { addIntegration, checkIntegration, removeIntegration, removeKey, saveProvider, toggleIntegration } from "@/app/actions";
import type { IntegrationKind, Provider, PublicSettings } from "@/lib/types";
import { PROVIDERS } from "@/lib/types";
import { Button, Field, Input, Panel, Pill, cx } from "./ui";

const HUBS: { kind: IntegrationKind; name: string; apps: string; how: string; header?: string; tone: string }[] = [
  {
    kind: "composio",
    name: "Composio",
    apps: "Hundreds of toolkits",
    how: "Create an MCP server in the Composio dashboard, pick the toolkits, then paste its URL. Add your Composio API key as a header if the URL needs one.",
    header: "x-api-key",
    tone: "bg-green",
  },
  {
    kind: "zapier",
    name: "Zapier MCP",
    apps: "Thousands of apps",
    how: "Open Zapier MCP, choose the actions you allow, and copy the server URL. The URL carries its own secret.",
    tone: "bg-orange",
  },
  {
    kind: "pipedream",
    name: "Pipedream",
    apps: "Thousands of apps",
    how: "Use Pipedream's remote MCP server URL for your project. Add the auth header Pipedream gives you.",
    header: "Authorization",
    tone: "lavender-orb",
  },
  {
    kind: "custom",
    name: "Any MCP server",
    apps: "Your own tools",
    how: "Any Streamable HTTP MCP endpoint: your internal APIs, Linear, Notion, Stripe, GitHub and others.",
    header: "Authorization",
    tone: "bg-ink",
  },
];

export function SettingsView({ settings }: { settings: PublicSettings }) {
  return (
    <div className="pt-10">
      <p className="eyebrow">Settings</p>
      <h1 className="display mt-2 text-[2.5rem] sm:text-[3.25rem]">Your keys, your tools.</h1>
      <p className="mt-3 max-w-[60ch] text-[0.9375rem] text-mute">
        Groklooper runs on your own subscription. Keys are stored locally in <code className="rounded bg-well px-1">data/db.json</code> and never leave your server except to call the provider.
      </p>

      <section className="mt-10">
        <div className="eyebrow mb-3">1 · Model provider</div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {PROVIDERS.map((p) => (
            <ProviderCard key={p.id} id={p.id} settings={settings} />
          ))}
        </div>
      </section>

      <section className="mt-12">
        <div className="eyebrow mb-3">2 · Integration hubs</div>
        <Integrations settings={settings} />
      </section>
    </div>
  );
}

function ProviderCard({ id, settings }: { id: Provider; settings: PublicSettings }) {
  const router = useRouter();
  const meta = PROVIDERS.find((p) => p.id === id)!;
  const active = settings.provider === id;
  const hasKey = settings.keysSet[id];
  const [key, setKey] = useState("");
  const [model, setModel] = useState(settings.models[id]);
  const [pending, start] = useTransition();

  return (
    <div className={cx("flex flex-col gap-4 rounded-[8px] border p-5", active ? "border-ink bg-white" : "border-line bg-panel")}>
      <div className="flex items-center justify-between">
        <span className="text-[1.0625rem] font-semibold tracking-[-0.01em]">{meta.label}</span>
        {active ? <Pill tone="dark">In use</Pill> : hasKey ? <Pill tone="green">Key saved</Pill> : <Pill>No key</Pill>}
      </div>
      <Field label="API key">
        <Input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder={hasKey ? "•••••••• saved — paste to replace" : meta.keyHint} autoComplete="off" />
      </Field>
      <Field label="Model">
        <Input value={model} onChange={(e) => setModel(e.target.value)} />
      </Field>
      <div className="flex items-center justify-between gap-2">
        {hasKey ? (
          <Button size="sm" variant="danger" className="!px-0" onClick={() => start(async () => { await removeKey(id); router.refresh(); })}>
            Remove key
          </Button>
        ) : (
          <span />
        )}
        <Button
          size="sm"
          disabled={pending || (!hasKey && !key)}
          onClick={() =>
            start(async () => {
              await saveProvider({ provider: id, model, apiKey: key });
              setKey("");
              router.refresh();
            })
          }
        >
          {active ? "Save" : "Save & use"}
        </Button>
      </div>
    </div>
  );
}

function Integrations({ settings }: { settings: PublicSettings }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [hub, setHub] = useState<(typeof HUBS)[number] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tests, setTests] = useState<Record<string, string>>({});

  const test = (id: string) => {
    setTests((t) => ({ ...t, [id]: "Connecting…" }));
    start(async () => {
      const r = await checkIntegration(id);
      setTests((t) => ({ ...t, [id]: r.ok ? `✓ ${r.count} tools: ${r.sample.join(", ")}${r.count > r.sample.length ? "…" : ""}` : `✕ ${r.error}` }));
    });
  };

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {HUBS.map((h) => (
          <button
            key={h.kind}
            onClick={() => { setHub(h); setError(null); }}
            className={cx("flex flex-col gap-4 rounded-[8px] border p-5 text-left transition-colors", hub?.kind === h.kind ? "border-ink bg-white" : "border-line bg-panel hover:border-ink/30")}
          >
            <span className={cx("h-9 w-9 rounded-full", h.tone)} />
            <div>
              <div className="font-semibold tracking-[-0.01em]">{h.name}</div>
              <div className="text-[0.8125rem] text-mute">{h.apps}</div>
            </div>
          </button>
        ))}
      </div>

      <Panel className="p-5">
        {hub ? (
          <form
            className="grid gap-4"
            action={(fd) =>
              start(async () => {
                setError(null);
                try {
                  await addIntegration({
                    name: String(fd.get("name")),
                    kind: hub.kind,
                    url: String(fd.get("url")),
                    headerName: String(fd.get("headerName") ?? ""),
                    headerValue: String(fd.get("headerValue") ?? ""),
                  });
                  setHub(null);
                  router.refresh();
                } catch (e) {
                  setError(e instanceof Error ? e.message : String(e));
                }
              })
            }
          >
            <div className="text-[1.25rem] font-medium tracking-[-0.02em]">Connect {hub.name}</div>
            <p className="text-[0.8125rem] leading-relaxed text-mute">{hub.how}</p>
            <Field label="Name">
              <Input name="name" defaultValue={hub.name} />
            </Field>
            <Field label="MCP server URL">
              <Input name="url" type="url" required placeholder="https://…" />
            </Field>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[140px_1fr]">
              <Field label="Header">
                <Input name="headerName" defaultValue={hub.header ?? ""} placeholder="optional" />
              </Field>
              <Field label="Value">
                <Input name="headerValue" type="password" placeholder="optional" autoComplete="off" />
              </Field>
            </div>
            {error && <p className="text-[0.8125rem] text-orange">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setHub(null)}>Cancel</Button>
              <Button type="submit" disabled={pending}>Connect</Button>
            </div>
          </form>
        ) : settings.integrations.length === 0 ? (
          <div className="flex h-full min-h-56 flex-col justify-center gap-2">
            <div className="text-[1.25rem] font-medium tracking-[-0.02em]">Thousands of apps, one URL each</div>
            <p className="text-[0.875rem] leading-relaxed text-mute">
              Loopers use the Model Context Protocol. Connect a hub and every looper can reach Gmail, Slack, HubSpot, LinkedIn, Notion, Sheets, Stripe and thousands more. They search for the tool they need at run time, so a big catalog doesn&apos;t slow them down.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <div className="eyebrow mb-1">Connected</div>
            {settings.integrations.map((i) => (
              <div key={i.id} className="rounded-[6px] bg-well p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-[0.9375rem] font-medium">{i.name}</div>
                    <div className="truncate text-[0.75rem] text-mute">{i.url.replace(/(https?:\/\/[^/]+).*/, "$1/…")}{i.headerNames.length > 0 && ` · ${i.headerNames.join(", ")}`}</div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button size="sm" variant="ghost" onClick={() => test(i.id)}>Test</Button>
                    <Button size="sm" variant="soft" onClick={() => start(async () => { await toggleIntegration(i.id); router.refresh(); })}>
                      {i.enabled ? "On" : "Off"}
                    </Button>
                    <Button size="sm" variant="danger" onClick={() => start(async () => { await removeIntegration(i.id); router.refresh(); })} aria-label={`Remove ${i.name}`}>
                      ✕
                    </Button>
                  </div>
                </div>
                {tests[i.id] && <div className={cx("mt-2 break-words text-[0.75rem]", tests[i.id].startsWith("✕") ? "text-orange" : "text-green-deep")}>{tests[i.id]}</div>}
              </div>
            ))}
            <p className="mt-2 text-[0.75rem] text-faint">Pick a hub on the left to add another.</p>
          </div>
        )}
      </Panel>
    </div>
  );
}
