import { connection } from "next/server";
import { getState } from "../actions";
import { SettingsView, type ConnectedApp } from "@/components/settings-view";
import { accountLabel, activeAccounts, getToolkit, hasComposio } from "@/lib/composio";
import { requireUid } from "@/lib/session";

const NOTICES: Record<string, string> = {
  connected: "ChatGPT plan connected. Your loopers now run on it.",
  "no-sharing": "Signed in, but plan usage wasn't allowed. Connect again and allow it to run loopers on ChatGPT.",
  declined: "ChatGPT sign-in was cancelled.",
  error: "ChatGPT sign-in didn't complete. Try again.",
};

export default async function SettingsPage({ searchParams }: PageProps<"/settings">) {
  await connection();
  const { settings, loopers } = await getState();
  const { chatgpt } = await searchParams;
  const uid = await requireUid();
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
  return <SettingsView settings={settings} apps={apps} notice={typeof chatgpt === "string" ? NOTICES[chatgpt] : undefined} />;
}
