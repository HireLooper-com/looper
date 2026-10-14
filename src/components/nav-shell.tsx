import { currentUser } from "@/lib/session";
import { PROVIDERS } from "@/lib/types";
import { Nav } from "./nav";

export async function NavShell() {
  const user = await currentUser();
  if (!user) return <Nav />;
  return <Nav email={user.email ?? ""} plan={PROVIDERS.find((p) => p.id === user.provider)?.plan} />;
}
