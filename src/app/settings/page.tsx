import { connection } from "next/server";
import { getState } from "../actions";
import { SettingsView } from "@/components/settings-view";

const NOTICES: Record<string, string> = {
  connected: "ChatGPT plan connected. Your loopers now run on it.",
  "no-sharing": "Signed in, but plan usage wasn't allowed. Connect again and allow it to run loopers on ChatGPT.",
  declined: "ChatGPT sign-in was cancelled.",
  error: "ChatGPT sign-in didn't complete. Try again.",
};

export default async function SettingsPage({ searchParams }: PageProps<"/settings">) {
  await connection();
  const { settings } = await getState();
  const { chatgpt } = await searchParams;
  return <SettingsView settings={settings} notice={typeof chatgpt === "string" ? NOTICES[chatgpt] : undefined} />;
}
