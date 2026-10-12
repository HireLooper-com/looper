import "../app.css";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { currentWorkspace, workspacesOf } from "@/lib/workspace";
import { logout, switchWorkspace } from "../actions";
import { Logo } from "../logo";

export const metadata = { title: "Looper" };
// Hiring and saving a key plan the week in after(); one plan is one model call plus a homepage fetch.
export const maxDuration = 300;

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const u = await requireUser();
  const cur = await currentWorkspace(u);
  const all = await workspacesOf(u.id);
  return (
    <div className="ax">
      <div className="top">
        <Link className="logo" href="/app">
          <Logo />
          Looper
        </Link>
        <nav aria-label="App">
          <details className="xws">
            <summary title="Switch workspace">
              {cur.name}
              <span className="dim2" aria-hidden="true"> ▾</span>
            </summary>
            <div className="xws-m">
              {all.map((w) => (
                <form key={w.id} action={switchWorkspace}>
                  <input type="hidden" name="ws" value={w.id} />
                  <button type="submit" aria-current={w.id === cur.id ? "true" : undefined}>
                    {w.name}
                    {w.role === "member" && <span className="dim2"> · {w.owner_email}</span>}
                  </button>
                </form>
              ))}
              {all.length > 1 && <Link href="/app/all">All workspaces</Link>}
              <Link href="/app/settings#workspaces">New workspace</Link>
            </div>
          </details>
          <Link href="/app/hire">Team</Link>
          <Link href="/app/settings">Settings</Link>
          <form action={logout} className="inline">
            <button type="submit">Sign out</button>
          </form>
        </nav>
      </div>
      {children}
    </div>
  );
}
