import Link from "next/link";
import { isPaid, requireUser } from "@/lib/auth";
import { sql } from "@/lib/db";
import { enabledToolkits, hasComposio, TOOLKITS } from "@/lib/composio";
import { connectorsOf } from "@/lib/connectors";
import { PROVIDERS } from "@/lib/llm";
import ModelPicker from "../model-picker";
import { ENGINES, OPENROUTER } from "@/lib/geo";
import { currentWorkspace, enterprise, isTeamPlan, workspacesOf, wsPaid } from "@/lib/workspace";
import {
  addConnector,
  connectTool,
  deleteConnector,
  invite,
  newWorkspace,
  removeEngine,
  removeMember,
  renameWorkspace,
  saveModel,
  saveEngine,
  saveNotify,
  saveTz,
  saveWebsite,
} from "../../actions";
import { Form, Submit } from "../../ui";
import { ToolIcon } from "../bits";
import { unmetered } from "@/lib/billing";
import { instanceSecret } from "@/lib/crypto";
import { tickSetup } from "@/lib/tick-workflow";

const ENDPOINTS_EXAMPLE = `[
  { "name": "list_orders", "method": "GET", "path": "/orders",
    "description": "Orders, newest first", "params": { "since": "string" } },
  { "name": "refund_order", "method": "POST", "path": "/orders/{id}/refund",
    "description": "Refund one order", "params": { "reason": "string" } }
]`;

export default async function Settings({ searchParams }: { searchParams: Promise<{ tool_error?: string }> }) {
  const { tool_error } = await searchParams;
  const u = await requireUser();
  const ws = await currentWorkspace(u);
  const owned = (await workspacesOf(u.id)).filter((w) => w.role === "owner").length;
  const team = isTeamPlan(ws.owner_plan) && wsPaid(ws);
  const [key] = await sql<{ provider: keyof typeof PROVIDERS; model: string; key_hint: string; created_at: Date }>`
    select provider, model, key_hint, created_at from model_keys where user_id = ${u.id}`;
  const conns = await sql<{ toolkit: string; status: string }>`select toolkit, status from ws_connections where workspace_id = ${ws.id}`;
  const status = new Map(conns.map((c) => [c.toolkit, c.status]));
  // Only toolkits with an enabled auth config in Composio, plus any this workspace already tried.
  const on = await enabledToolkits();
  const people = await sql<{ id: number; email: string; role: string }>`
    select u.id, u.email, m.role from members m join users u on u.id = m.user_id where m.workspace_id = ${ws.id} order by m.role desc, u.email`;
  const pending = await sql<{ email: string }>`select email from invites where workspace_id = ${ws.id} order by created_at`;
  const connectors = await connectorsOf(ws.id);
  const [router] = await sql<{ key_hint: string }>`select key_hint from engine_keys where user_id = ${u.id} and engine = ${OPENROUTER}`;
  // Self-hosted on Vercel: the scheduler needs a GitHub workflow to run every 15 minutes.
  const tick = unmetered() ? tickSetup() : null;
  const canAddWs = owned === 0 || (isTeamPlan(u.plan) && isPaid(u));

  const all = Object.entries(TOOLKITS).filter(([slug]) => !on || on.has(slug) || status.has(slug));
  const connected = all.filter(([slug]) => status.get(slug) === "ACTIVE").length;
  // Tools this workspace already tried come first, then the rest in TOOLKITS order.
  const tools = [...all.filter(([slug]) => status.has(slug)), ...all.filter(([slug]) => !status.has(slug))];

  return (
    <main className="wide xset">
      <h1>
        Settings. <span className="c">{ws.name}</span>
      </h1>

      <section className="xset-s" id="workspaces">
        <div className="xset-h">
          <h2>Workspace</h2>
          <p className="dim">One workspace per product, brand or client. Each has its own website, tools, loopers and board.</p>
        </div>
        <div className="xset-b">
          <div className="xset-g2">
            <Form action={renameWorkspace} className="xset-c">
              <input type="hidden" name="ws" value={ws.id} />
              <label htmlFor="wsname">Name</label>
              <div className="xset-in">
                <input id="wsname" name="name" defaultValue={ws.name} />
                <Submit className="btn2">Save</Submit>
              </div>
            </Form>
            <Form action={saveWebsite} className="xset-c">
              <input type="hidden" name="back" value="/app/settings" />
              <label htmlFor="website">Website, new loopers read it</label>
              <div className="xset-in">
                <input id="website" name="website" defaultValue={ws.website} placeholder="timetuna.com" />
                <Submit className="btn2">Save</Submit>
              </div>
            </Form>
          </div>

          <h3>New workspace</h3>
          {canAddWs ? (
            <Form action={newWorkspace} className="xset-c">
              <div className="xset-g3">
                <div>
                  <label htmlFor="nwname">Name</label>
                  <input id="nwname" name="name" required placeholder="Client or product name" />
                </div>
                <div>
                  <label htmlFor="nwsite">Website, optional</label>
                  <input id="nwsite" name="website" placeholder="client.com" />
                </div>
                <div className="xset-end">
                  <Submit className="btn2" busy="Creating">Create workspace</Submit>
                </div>
              </div>
            </Form>
          ) : (
            <p className="note">
              Pro has 1 workspace. A-team has unlimited workspaces, one per product or client. <Link href="/app/billing">See A-team</Link>
            </p>
          )}
        </div>
      </section>

      <section className="xset-s" id="people">
        <div className="xset-h">
          <h2>People</h2>
          <p className="dim">Collaborators approve and reject cards and join reflections; the board shows who acted.</p>
        </div>
        <div className="xset-b">
          <div className="xset-grid">
            {people.map((p) => (
              <div className="xset-c xset-p" key={p.id}>
                <span className="xset-av" aria-hidden="true">{p.email[0].toUpperCase()}</span>
                <span className="xset-t">
                  <b>{p.email}</b>
                  <small>
                    {p.role === "owner" ? "Owner, plan and model key" : "Collaborator"}
                    {p.id === u.id ? " · you" : ""}
                  </small>
                </span>
                {p.role !== "owner" && (ws.role === "owner" || p.id === u.id) && (
                  <form action={removeMember} className="inline">
                    <input type="hidden" name="ws" value={ws.id} />
                    <input type="hidden" name="user" value={p.id} />
                    <Submit className="btn2 sm">{p.id === u.id ? "Leave" : "Remove"}</Submit>
                  </form>
                )}
              </div>
            ))}
            {pending.map((p) => (
              <div className="xset-c xset-p" key={p.email}>
                <span className="xset-av off" aria-hidden="true">{p.email[0].toUpperCase()}</span>
                <span className="xset-t">
                  <b className="dim">{p.email}</b>
                  <small>Invited, joins at sign up</small>
                </span>
                {ws.role === "owner" && (
                  <form action={removeMember} className="inline">
                    <input type="hidden" name="ws" value={ws.id} />
                    <input type="hidden" name="email" value={p.email} />
                    <Submit className="btn2 sm">Cancel</Submit>
                  </form>
                )}
              </div>
            ))}
            {team && (
              <Form action={invite} reset className="xset-c xset-add">
                <input type="hidden" name="ws" value={ws.id} />
                <label htmlFor="invite">Invite a collaborator</label>
                <div className="xset-in">
                  <input id="invite" name="email" type="email" required placeholder="ana@company.com" />
                  <Submit className="btn2" busy="Inviting">Invite</Submit>
                </div>
              </Form>
            )}
          </div>
          {!team && (
            <p className="note">
              Collaborators come with A-team, unlimited people per workspace. <Link href="/app/billing">See A-team</Link>
            </p>
          )}
        </div>
      </section>

      <section className="xset-s" id="model">
        <div className="xset-h">
          <h2>Model</h2>
          <p className="dim">
            Every routine in the workspaces you own runs on your key
            {ws.role === "member" ? `; loopers in ${ws.name} run on ${ws.owner_email}'s key` : ""}. Stored encrypted (AES-256-GCM), decrypted on the
            server only for a run.
          </p>
          <p className="note">Codex and Grok plan sign-in is not open to third-party apps yet, so use an API key.</p>
        </div>
        <div className="xset-b">
          {key && (
            <div className="xset-c xset-key">
              <span className="pill on">Connected</span>
              <b>{PROVIDERS[key.provider].name}</b>
              <span className="dim">{key.model}</span>
              <span className="mono dim2">{key.key_hint}</span>
            </div>
          )}
          <Form action={saveModel} className="xset-c">
            <ModelPicker provider={key?.provider} model={key?.model} />
            <div className="xset-act">
              <Submit busy="Checking the key">{key ? "Replace key" : "Connect"}</Submit>
              <span className="note">We send one 1-word request to check the key before saving it.</span>
            </div>
          </Form>
        </div>
      </section>

      <section className="xset-s" id="engines">
        <div className="xset-h">
          <h2>AI answer engines</h2>
          <p className="dim">
            The SEO / GEO looper asks its 10 buyer questions every day with web search on your model. One OpenRouter key adds ChatGPT,
            Perplexity and Google AI. A question counts when any engine names your site.
          </p>
        </div>
        <div className="xset-b">
          <div className={`xset-c${router ? " on" : ""}`}>
            <div className="xset-top">
              <span className="xset-t">
                <b>OpenRouter</b>
                <small>{ENGINES.map((e) => `${e.name} (${e.model.split("/")[1]})`).join(", ")}</small>
              </span>
              {router && <span className="pill on">Connected</span>}
            </div>
            {router ? (
              <div className="xset-foot">
                <span className="mono dim2">{router.key_hint}</span>
                <form action={removeEngine} className="inline">
                  <Submit className="btn2 sm">Remove</Submit>
                </form>
              </div>
            ) : (
              <Form action={saveEngine} reset>
                <label htmlFor="ekey" className="sr">OpenRouter API key</label>
                <div className="xset-in">
                  <input id="ekey" name="key" type="password" autoComplete="off" required placeholder="OpenRouter key, sk-or-..." />
                  <Submit className="btn2" busy="Checking">Add</Submit>
                </div>
              </Form>
            )}
          </div>
        </div>
      </section>

      <section className="xset-s" id="tools">
        <div className="xset-h">
          <h2>Tools</h2>
          <p className="dim">
            {connected} of {all.length} connected in {ws.name}. Each one opens the tool's own sign-in through Composio.
          </p>
          <p className="note">Loopers only call a tool after you approve a card, unless a routine runs alone.</p>
        </div>
        <div className="xset-b">
          {!hasComposio() && <p className="err">Composio is not configured on this deployment (COMPOSIO_API_KEY).</p>}
          {tool_error && <p className="err" role="alert">{tool_error}</p>}
          <div className="xset-tools">
            {tools.map(([slug, name]) => {
              const s = status.get(slug);
              return (
                <form action={connectTool} className={`xset-c xset-tool${s === "ACTIVE" ? " on" : ""}`} key={slug}>
                  <input type="hidden" name="toolkit" value={slug} />
                  <input type="hidden" name="ws" value={ws.id} />
                  <input type="hidden" name="back" value="/app/settings#tools" />
                  <ToolIcon slug={slug} name={name} />
                  <span className="xset-t">
                    <b>{name}</b>
                    <small>{s === "ACTIVE" ? "Connected" : s ? s.toLowerCase() : "Not connected"}</small>
                  </span>
                  <Submit className="btn2 sm" busy="Opening">
                    {s === "ACTIVE" ? "Reconnect" : s ? "Retry" : "Connect"}
                  </Submit>
                </form>
              );
            })}
          </div>
        </div>
      </section>

      <section className="xset-s" id="connectors">
        <div className="xset-h">
          <h2>Custom connectors</h2>
          <p className="dim">
            Any REST API, described as endpoints. Loopers read from GET endpoints and put the others on cards you approve, like any other tool.
          </p>
        </div>
        <div className="xset-b">
          {connectors.length > 0 && (
            <div className="xset-grid">
              {connectors.map((c) => (
                <div className="xset-c on" key={c.id}>
                  <div className="xset-top">
                    <span className="xset-t">
                      <b>{c.name}</b>
                      <small>{c.endpoints.length} endpoints</small>
                    </span>
                    <form action={deleteConnector} className="inline">
                      <input type="hidden" name="ws" value={ws.id} />
                      <input type="hidden" name="id" value={c.id} />
                      <Submit className="btn2 sm">Remove</Submit>
                    </form>
                  </div>
                  <span className="mono dim2 xset-url">{c.base_url}</span>
                </div>
              ))}
            </div>
          )}
          {team ? (
            <Form action={addConnector} className="xset-c">
              <input type="hidden" name="ws" value={ws.id} />
              <div className="xset-g2">
                <div>
                  <div className="xset-g2">
                    <div>
                      <label htmlFor="cname">Name</label>
                      <input id="cname" name="name" required placeholder="Orders API" />
                    </div>
                    <div>
                      <label htmlFor="cheader">Auth header</label>
                      <input id="cheader" name="header" defaultValue="Authorization" />
                    </div>
                  </div>
                  <label htmlFor="cbase">Base URL</label>
                  <input id="cbase" name="base" required placeholder="https://api.example.com/v1" />
                  <label htmlFor="csecret">Header value, stored encrypted</label>
                  <input id="csecret" name="secret" type="password" autoComplete="off" placeholder="Bearer sk_live_..." />
                </div>
                <div>
                  <label htmlFor="cend">Endpoints, JSON</label>
                  <textarea id="cend" name="endpoints" rows={9} required className="mono" defaultValue={ENDPOINTS_EXAMPLE} />
                </div>
              </div>
              <div className="xset-act">
                <Submit className="btn2" busy="Saving">Save connector</Submit>
              </div>
            </Form>
          ) : (
            <p className="note">
              Custom connectors come with A-team and Bloody enterprise. <Link href="/app/billing">See plans</Link>
            </p>
          )}
        </div>
      </section>

      {tick && (
        <section className="xset-s" id="scheduler">
          <div className="xset-h">
            <h2>Scheduler</h2>
            <p className="dim">Vercel Hobby runs loopers once a day. A GitHub workflow in {tick.repo} runs them every 15 minutes.</p>
          </div>
          <div className="xset-b">
            <div className="xset-c">
              <ol className="xset-steps">
                <li>
                  <a href={tick.workflow} target="_blank" rel="noreferrer">Add the tick workflow</a> to {tick.repo} and press Commit changes.
                </li>
                <li>
                  <a href={tick.secret} target="_blank" rel="noreferrer">Add an Actions secret</a> named <span className="mono">CRON_SECRET</span> with this value:
                  <input className="mono" readOnly value={instanceSecret("CRON_SECRET") || ""} aria-label="CRON_SECRET" />
                </li>
                <li>
                  <a href={tick.runs} target="_blank" rel="noreferrer">Check the runs</a>: a green run every 15 minutes.
                </li>
              </ol>
            </div>
          </div>
        </section>
      )}

      <section className="xset-s" id="account">
        <div className="xset-h">
          <h2>You</h2>
          <p className="dim">Email, clock and plan for {u.email}, across every workspace.</p>
        </div>
        <div className="xset-b">
          <div className="xset-g3">
            <form action={saveNotify} className="xset-c" id="email">
              <h3>Email</h3>
              <label className="xset-chk">
                <input type="checkbox" name="notify" defaultChecked={u.notify} />
                <span>
                  Cards to approve, failed runs, reflection open
                  <small>At most every 3 hours</small>
                </span>
              </label>
              <label className="xset-chk">
                <input type="checkbox" name="weekly" defaultChecked={u.weekly} />
                <span>
                  Monday report: each metric, its target, the 3 cards that moved it
                  <small>08:00 your time</small>
                </span>
              </label>
              <div className="xset-act">
                <Submit className="btn2 sm">Save</Submit>
              </div>
            </form>
            <form action={saveTz} className="xset-c">
              <h3>Time zone</h3>
              <label htmlFor="tz">Routines run on this clock</label>
              <div className="xset-in">
                <input id="tz" name="tz" defaultValue={u.tz} />
                <Submit className="btn2">Save</Submit>
              </div>
            </form>
            {!enterprise() && (
              <div className="xset-c">
                <h3>Plan</h3>
                <p className="xset-plan">
                  <b>{isTeamPlan(u.plan) ? "A-team" : "Pro"}</b>
                  <span className="dim">{isTeamPlan(u.plan) ? "$1,000/mo" : "$100/mo"}</span>
                </p>
                <p className="dim">{u.subscription_status === "trialing" ? "Free trial" : isPaid(u) ? "Active" : "Not started"}</p>
                <div className="xset-act">
                  <Link href="/app/billing" className="btn2 sm">Billing</Link>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
