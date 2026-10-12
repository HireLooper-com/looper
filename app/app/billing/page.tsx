import { redirect } from "next/navigation";

// Self-hosted Looper has no billing.
export default function Billing() {
  redirect("/app/settings");
}
