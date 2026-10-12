import { cookies } from "next/headers";
import { billingOff, unmetered } from "./billing";
import { sql } from "./db";
import type { User } from "./auth";

// A workspace is one product, brand or client: its own website, tools, loopers and board.
// Pro owns 1, A-team and Bloody enterprise own any number and invite collaborators.
// Loopers run on the owner's model key and subscription, whoever in the workspace hired them.

const COOKIE = "lp_ws";

export type Workspace = {
  id: number;
  owner_id: number;
  name: string;
  website: string;
  composio_user: string | null;
  role: "owner" | "member";
  owner_email: string;
  owner_plan: string;
  owner_status: string;
};

/** On-prem and self-hosted installs have every plan feature and no Stripe gate. */
export const enterprise = unmetered;

/** A-team and Bloody enterprise: unlimited workspaces and collaborators. */
export function isTeamPlan(plan: string) {
  return enterprise() || plan === "team" || plan === "enterprise";
}

/** The workspace's loopers run while its owner pays. */
export function wsPaid(ws: Workspace) {
  return billingOff() || ["active", "trialing"].includes(ws.owner_status);
}

export const composioUserOf = (ws: { id: number; composio_user: string | null }) => ws.composio_user || `looper-ws-${ws.id}`;

export async function workspacesOf(userId: number) {
  return sql<Workspace>`
    select w.id, w.owner_id, w.name, w.website, w.composio_user, m.role,
      o.email as owner_email, o.plan as owner_plan, o.subscription_status as owner_status
    from workspaces w join members m on m.workspace_id = w.id join users o on o.id = w.owner_id
    where m.user_id = ${userId} order by w.id`;
}

/** One workspace, only if the user is a member of it. */
export async function workspaceFor(userId: number, id: number) {
  const [ws] = await sql<Workspace>`
    select w.id, w.owner_id, w.name, w.website, w.composio_user, m.role,
      o.email as owner_email, o.plan as owner_plan, o.subscription_status as owner_status
    from workspaces w join members m on m.workspace_id = w.id join users o on o.id = w.owner_id
    where m.user_id = ${userId} and w.id = ${id}`;
  return ws ?? null;
}

/** The user's first workspace, which keeps the Composio user from before workspaces. Safe to call from parallel requests. */
async function firstWorkspace(u: User, label: string, website: string) {
  // Layout and page render in parallel on the first visit; the partial unique index lets only one of them create it.
  const [row] = await sql<{ id: number }>`
    insert into workspaces (owner_id, name, website, composio_user) values (${u.id}, ${label}, ${website}, ${`looper-${u.id}`})
    on conflict (owner_id) where composio_user is not null do nothing returning id`;
  if (!row) return (await sql<{ id: number }>`select id from workspaces where owner_id = ${u.id} and composio_user is not null`)[0].id;
  await sql`insert into ws_connections (workspace_id, toolkit, account_id, status, updated_at)
    select ${row.id}, toolkit, account_id, status, updated_at from connections where user_id = ${u.id} on conflict do nothing`;
  return row.id;
}

/** Create a workspace owned by the user. */
export async function createWorkspace(u: User, name: string, website = "") {
  const [{ n }] = await sql<{ n: number }>`select count(*)::int as n from workspaces where owner_id = ${u.id}`;
  const label = name.slice(0, 60) || "My workspace";
  const id =
    n === 0
      ? await firstWorkspace(u, label, website)
      : (await sql<{ id: number }>`insert into workspaces (owner_id, name, website) values (${u.id}, ${label}, ${website}) returning id`)[0].id;
  await sql`insert into members (workspace_id, user_id, role) values (${id}, ${u.id}, 'owner') on conflict do nothing`;
  return id;
}

/** The workspace the user is looking at: the cookie if they are still a member, else their first. Creates one if they have none. */
export async function currentWorkspace(u: User): Promise<Workspace> {
  const all = await workspacesOf(u.id);
  if (!all.length) {
    // Never the count in createWorkspace: a parallel request may have inserted the workspace but not its owner row yet.
    const id = await firstWorkspace(u, (u.website.replace(/^https?:\/\//, "") || "My workspace").slice(0, 60), u.website);
    await sql`insert into members (workspace_id, user_id, role) values (${id}, ${u.id}, 'owner') on conflict do nothing`;
    return (await workspacesOf(u.id))[0];
  }
  const want = Number((await cookies()).get(COOKIE)?.value);
  return all.find((w) => w.id === want) ?? all[0];
}

export async function setCurrentWorkspace(id: number) {
  (await cookies()).set(COOKIE, String(id), { httpOnly: true, sameSite: "lax", path: "/", maxAge: 365 * 864e5 / 1000 });
}

/** Turn pending invites for this email into memberships. Runs at every sign in. */
export async function acceptInvites(userId: number, email: string) {
  await sql`insert into members (workspace_id, user_id, role)
    select workspace_id, ${userId}, 'member' from invites where email = ${email} on conflict do nothing`;
  await sql`delete from invites where email = ${email}`;
}

/** Everyone who should hear about a workspace: its members. */
export async function memberEmails(workspaceId: number) {
  return sql<{ id: number; email: string; tz: string; notify: boolean }>`
    select u.id, u.email, u.tz, u.notify from members m join users u on u.id = m.user_id where m.workspace_id = ${workspaceId}`;
}
