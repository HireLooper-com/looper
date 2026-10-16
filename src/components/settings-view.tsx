"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import {
  addIntegration,
  checkIntegration,
  disconnectSubscription,
  listPlanModels,
  removeIntegration,
  removeKey,
  saveModelSettings,
  setGrokRoute,
  toggleIntegration,
} from "@/app/actions";
import type { IntegrationKind, Provider, PublicSettings } from "@/lib/types";
import { PROVIDERS } from "@/lib/types";
import { ChatGPTButton, GrokMark, GrokSignIn, OpenAIMark } from "./sign-in";
import { Button, Field, Input, Panel, Pill, Select, cx } from "./ui";

const HUBS: { kind: IntegrationKind; name: string; apps: string; how: string; header?: string; tone: string }[] = [
  {
    kind: "composio",
    name: "Composio",
    apps: "Hundreds of toolkits",
    how: "Create an MCP server in the Composio dashboard, pick the toolkits, then paste its URL. Add your Composio API key as a header if the URL needs one.",
    header: "x-api-key",
    tone: "bg-ink/[0.08]",
  },
  {
    kind: "zapier",
    name: "Zapier MCP",
    apps: "Thousands of apps",
    how: "Open Zapier MCP, choose the actions you allow, and copy the server URL. The URL carries its own secret.",
    tone: "bg-ink/[0.08]",
  },
  {
    kind: "pipedream",
    name: "Pipedream",
    apps: "Thousands of apps",
    how: "Use Pipedream's remote MCP server URL for your project. Add the auth header Pipedream gives you.",
    header: "Authorization",
    tone: "bg-ink/[0.08]",
  },
  {
    kind: "custom",
    name: "Any MCP server",
    apps: "Your own tools",
    how: "Any Streamable HTTP MCP endpoint: your internal APIs, Linear, Notion, Stripe, GitHub and others.",
    header: "Authorization",
    tone: "bg-ink/[0.08]",
  },
];

export function SettingsView({ settings, notice }: { settings: PublicSettings; notice?: string }) {
  return (
    <div className="mx-auto max-w-5xl px-6 pb-16 pt-10">
      <h1 className="display text-[2.5rem] sm:text-[3rem]">Settings</h1>
      <p className="mt-2 max-w-[60ch] text-[1rem] text-mute">Choose which plan your loopers run on, and connect the apps they can use.</p>
      {notice && <div className="mt-6 rounded-[12px] bg-blue/10 px-4 py-3 text-[0.875rem] text-blue">{notice}</div>}

      <section className="mt-10">
        <h2 className="mb-3 text-[1.25rem] font-semibold tracking-[-0.01em]">AI plan</h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {PROVIDERS.map((p) => (
            <ProviderCard key={p.id} id={p.id} settings={settings} />
          ))}
        </div>
      </section>

      <section className="mt-12">
        <h2 className="mb-1 text-[1.25rem] font-semibold tracking-[-0.01em]">Integrations</h2>
        <p className="mb-4 text-[0.875rem] text-mute">Each hub is one MCP link that reaches hundreds or thousands of apps. Loopers search for the tool they need while they work.</p>
        <Integrations settings={settings} />
      </section>
    </div>
  );
}

function ProviderCard({ id, settings }: { id: Provider; settings: PublicSettings }) {
  const router = useRouter();
  const meta = PROVIDERS.find((p) => p.id === id)!;
  const active = settings.provider === id;
  const sub = settings.subscriptions[id];
  const mode = settings.authMode[id] ?? (sub ? "oauth" : "key");
  const hasKey = settings.keysSet[id];
  const [key, setKey] = useState("");
  const [model, setModel] = useState(settings.models[id]);
  const [planModels, setPlanModels] = useState<{ id: string; name: string }[]>([]);
  const [showKey, setShowKey] = useState(false);
  const [pending, start] = useTransition();
  const refresh = () => router.refresh();

  useEffect(() => {
    if (id !== "openai" || !sub) return;
    listPlanModels("openai").then(setPlanModels).catch(() => setPlanModels([]));
  }, [id, sub]);

  const Mark = id === "openai" ? OpenAIMark : GrokMark;
  const usable = mode === "oauth" ? !!sub : hasKey;

  return (
    <Panel className={cx("flex flex-col gap-5 p-6", active && "ring-2 ring-blue")}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          {id === "xai" ? (
            <Mark className="h-11 w-11" />
          ) : (
            <span className="flex h-11 w-11 items-center justify-center rounded-[22%] bg-ink text-page">
              <Mark className="h-5 w-5" />
            </span>
          )}
          <div>
            <div className="text-[1.0625rem] font-semibold">{meta.plan}</div>
            <div className="text-[0.8125rem] text-mute">{sub ? `Signed in${sub.email ? ` as ${sub.email}` : ""}` : "Not connected"}</div>
          </div>
        </div>
        {active ? <Pill tone="blue">In use</Pill> : usable ? <Pill tone="green">Ready</Pill> : null}
      </div>

      {sub ? (
        <div className="flex flex-col gap-3">
          {id === "openai" && !settings.subscriptions.openai?.sharing && (
            <p className="text-[0.8125rem] text-red">Plan usage wasn&apos;t granted. Sign in again and allow plan usage.</p>
          )}
          <div className="flex flex-wrap gap-2">
            {mode === "oauth" && hasKey && (
              <Button size="sm" variant="soft" onClick={() => start(async () => { await saveModelSettings({ provider: id, model, useKey: true }); refresh(); })}>
                Use API key instead
              </Button>
            )}
            {mode === "key" && (
              <Button size="sm" variant="soft" onClick={() => start(async () => { await saveModelSettings({ provider: id, model, useKey: false }); refresh(); })}>
                Use my {meta.plan} plan
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => start(async () => { await disconnectSubscription(id); refresh(); })}>
              Disconnect
            </Button>
          </div>
        </div>
      ) : id === "openai" ? (
        <ChatGPTButton isLocal={settings.isLocal} label="Connect ChatGPT plan" />
      ) : (
        <GrokSignIn label="Connect Grok plan" onConnected={refresh} />
      )}

      <Field label="Model">
        {id === "openai" && mode === "oauth" && planModels.length > 0 ? (
          <Select value={model} onChange={(e) => setModel(e.target.value)}>
            {!planModels.some((m) => m.id === model) && <option value={model}>{model}</option>}
            {planModels.map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </Select>
        ) : (
          <Input value={model} onChange={(e) => setModel(e.target.value)} />
        )}
      </Field>

      {id === "xai" && sub && mode === "oauth" && (
        <Field label="Send Grok requests to" hint="Some SuperGrok tiers get a 403 on xAI's API. The Grok CLI endpoint is what the Grok CLI uses; it's unofficial and identifies as the Grok CLI.">
          <Select value={settings.grokRoute} onChange={(e) => start(async () => { await setGrokRoute(e.target.value as "api" | "cli-proxy"); refresh(); })}>
            <option value="api">xAI API (api.x.ai)</option>
            <option value="cli-proxy">Grok CLI endpoint (unofficial)</option>
          </Select>
        </Field>
      )}

      <div>
        <button className="text-[0.8125rem] text-blue hover:underline" onClick={() => setShowKey((s) => !s)}>
          {showKey ? "Hide API key" : hasKey ? "API key saved · change" : `Use an ${meta.label} API key instead`}
        </button>
        {showKey && (
          <div className="mt-3 flex gap-2">
            <Input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder={hasKey ? "Paste to replace" : meta.keyHint} autoComplete="off" />
            {hasKey && (
              <Button size="sm" variant="ghost" className="!h-10" onClick={() => start(async () => { await removeKey(id); refresh(); })}>
                Remove
              </Button>
            )}
          </div>
        )}
      </div>

      <div className="mt-auto flex justify-end">
        <Button
          size="sm"
          disabled={pending || (!usable && !key)}
          onClick={() =>
            start(async () => {
              await saveModelSettings({ provider: id, model, apiKey: key || undefined, useKey: key ? true : undefined });
              setKey("");
              refresh();
            })
          }
        >
          {active ? "Save" : `Use ${meta.plan}`}
        </Button>
      </div>
    </Panel>
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
      <div className="grid grid-cols-2 gap-3">
        {HUBS.map((h) => (
          <button
            key={h.kind}
            onClick={() => {
              setHub(h);
              setError(null);
            }}
            className={cx("tile flex flex-col gap-4 p-5 text-left", hub?.kind === h.kind && "ring-2 ring-blue")}
          >
            <span className={cx("h-10 w-10 rounded-[11px]", h.tone)} />
            <div>
              <div className="font-semibold">{h.name}</div>
              <div className="text-[0.8125rem] text-mute">{h.apps}</div>
            </div>
          </button>
        ))}
      </div>

      <Panel className="p-6">
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
            <div className="text-[1.25rem] font-semibold tracking-[-0.01em]">Connect {hub.name}</div>
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
            {error && <p className="text-[0.8125rem] text-red">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setHub(null)}>Cancel</Button>
              <Button type="submit" disabled={pending}>Connect</Button>
            </div>
          </form>
        ) : settings.integrations.length === 0 ? (
          <div className="flex h-full min-h-56 flex-col justify-center gap-2">
            <div className="text-[1.25rem] font-semibold tracking-[-0.01em]">Thousands of apps, one link each</div>
            <p className="text-[0.875rem] leading-relaxed text-mute">
              Connect a hub and every looper can reach Gmail, Slack, HubSpot, LinkedIn, Notion, Sheets, Stripe and thousands more. They search for the tool they need at run time, so a big catalog doesn&apos;t slow them down.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <div className="mb-1 text-[0.8125rem] font-medium text-mute">Connected</div>
            {settings.integrations.map((i) => (
              <div key={i.id} className="rounded-[12px] bg-well p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-[0.9375rem] font-medium">{i.name}</div>
                    <div className="truncate text-[0.75rem] text-mute">
                      {i.url.replace(/(https?:\/\/[^/]+).*/, "$1/…")}
                      {i.headerNames.length > 0 && ` · ${i.headerNames.join(", ")}`}
                    </div>
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
            <p className="mt-2 text-[0.75rem] text-faint">Pick a hub to add another.</p>
          </div>
        )}
      </Panel>
    </div>
  );
}
