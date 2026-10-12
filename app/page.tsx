import { redirect } from "next/navigation";

// Self-hosted Looper has no landing page: the root goes straight to the app, which sends visitors to /login.
export default function Page() {
  redirect("/app");
}
