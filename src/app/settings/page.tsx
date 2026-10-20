import { connection } from "next/server";
import { getState } from "../actions";
import { SettingsView, type ConnectedApp } from "@/components/settings-view";
import { accountLabel, activeAccounts, getToolkit, hasComposio } from "@/lib/composio";
import { read } from "@/lib/db";
import { modelMenu } from "@/lib/llm";
import { getCatalog, nameOf } from "@/lib/models";
import { requireUser } from "@/lib/session";
import { allUsage, isAdmin, summarize, usageRows } from "@/lib/usage";

const NOTICES: Record<string, string> = {
  connected: "ChatGPT plan connected. Pick its models in any chat, or make one the default below.",
  "no-sharing": "Signed in, but plan usage wasn't allowed. Connect again and allow it to run loopers on ChatGPT.",
  declined: "ChatGPT sign-in was cancelled.",
  error: "ChatGPT sign-in didn't complete. Try again.",
};

export default async function SettingsPage({ searchParams }: PageProps<"/settings">) {
  await connection();
  const { settings, loopers } = await getState();
  const { chatgpt } = await searchParams;
  const user = await requireUser();
  const uid = user.ws;
  const [db, catalog, rows, everyone] = await Promise.all([read(uid), getCatalog(), usageRows(uid), isAdmin(user.email) ? allUsage() : undefined]);
  const menu = await modelMenu(uid, db.settings, db.settings.defaultModel);
  const names = {
    model: (provider: Parameters<typeof nameOf>[1], id: string) => nameOf(catalog, provider, id),
    source: (id: string) => (id === "chief" ? "Chief" : (loopers.find((l) => l.id === id)?.name ?? "Removed looper")),
  };
  const label = (s: ReturnType<typeof summarize>) => ({
    ...s,
    byModel: s.byModel.map((m) => ({ ...m, name: names.model(m.provider, m.model) })),
    bySource: s.bySource.map((x) => ({ ...x, name: names.source(x.source) })),
  });
  const usage = { workspace: label(summarize(rows)), all: everyone && { ...label(everyone.summary), workspaces: everyone.workspaces } };
  // Every app account the user has connected, and which loopers use it.
  const accounts = hasComposio() ? await activeAccounts(uid, true).catch(() => new Map()) : new Map();
  const apps: ConnectedApp[] = await Promise.all(
    [...accounts].map(async ([slug, list]) => {
      const known = loopers.flatMap((l) => l.apps ?? []).find((a) => a.slug === slug);
      const tk = known ? null : await getToolkit(slug).catch(() => null);
      return {
        slug,
        name: known?.name ?? tk?.name ?? slug,
        logo: known?.logo ?? tk?.meta?.logo,
        accounts: list.map(accountLabel),
        loopers: loopers.filter((l) => l.apps?.some((a) => a.slug === slug)).map((l) => ({ id: l.id, name: l.name })),
      };
    }),
  );
  return <SettingsView settings={settings} menu={menu} usage={usage} apps={apps} notice={typeof chatgpt === "string" ? NOTICES[chatgpt] : undefined} />;
}
