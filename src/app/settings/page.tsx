import { connection } from "next/server";
import { getState } from "../actions";
import { SettingsView } from "@/components/settings-view";

export default async function SettingsPage() {
  await connection();
  const { settings } = await getState();
  return <SettingsView settings={settings} />;
}
