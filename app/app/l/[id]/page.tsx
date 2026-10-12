import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { sql } from "@/lib/db";
import { hasComposio } from "@/lib/composio";
import { toolkitNames } from "@/lib/tools";
import { setupSteps } from "@/lib/plan";
import { isCustom } from "@/lib/connectors";
import { role as findRole } from "@/lib/roles";
import type { Card, Looper } from "@/lib/engine";
import { approve, connectTool, replan } from "../../../actions";
import { Submit } from "../../../ui";
import { Avatar } from "../../bits";
import { fmt, when } from "./shared";
import MetricTab from "./metric";
import BoardTab from "./board";
import CalendarTab from "./calendar";
import ReflectionTab from "./reflection";
import TrackingTab from "./tracking";
import BriefTab from "./brief";
import ChatPanel from "./chat";

const TABS = ["metric", "board", "calendar", "brief", "tracking", "reflection"] as const;
type Tab = (typeof TABS)[number];

export default async function LooperPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string; tool_error?: string }> }) {
  const u = await requireUser();
  const { id } = await params;
  const { tab: t, tool_error } = await searchParams;
  const tab: Tab = (TABS as readonly string[]).includes(t ?? "") ? (t as Tab) : "metric";
  const [l] = await sql<Looper>`
    select l.* from loopers l join members m on m.workspace_id = l.workspace_id where l.id = ${Number(id)} and m.user_id = ${u.id}`;
  if (!l) notFound();
  const names = await toolkitNames(l.workspace_id);
  const [p] = await sql<{ value: string }>`select value from metric_points where looper_id = ${l.id} order by taken_at desc limit 1`;
  const [{ n: proposed }] = await sql<{ n: number }>`select count(*)::int as n from cards where looper_id = ${l.id} and status = 'proposed'`;
  const top = await sql<Card>`select * from cards where looper_id = ${l.id} and status = 'proposed' order by created_at desc limit 3`;
  const [open] = await sql`select 1 from reflections where looper_id = ${l.id} and status in ('open','proposed')`;
  const routines = await sql<{ id: number; name: string; tool: string; days: number[]; hour: number; mode: string }>`
    select id, name, tool, days, hour, mode from routines where looper_id = ${l.id} order by hour, id`;
  // Loopers run on the workspace owner's key.
  const [key] = await sql`select 1 from model_keys where user_id = ${l.user_id}`;
  const team = await sql<{ id: number; role: string; name: string }>`select id, role, name from loopers where workspace_id = ${l.workspace_id} and fired_at is null order by id`;
  const conns = await sql<{ toolkit: string }>`select toolkit from ws_connections where workspace_id = ${l.workspace_id} and status = 'ACTIVE'`;
  const connected = new Set([...conns.map((c) => c.toolkit), ...Object.keys(names).filter(isCustom)]);
  const owner = l.user_id === u.id;

  const r = findRole(l.role);
  const steps = await setupSteps(l);
  const [ca, cb] = r?.colors ?? ["#8A8A92", "#5A5A62"];
  // "Mentions in AI answers, of 10 buyer questions" reads "Mentions in AI answers" in the menu bar.
  const short = l.metric_name.split(",")[0];
  const kpi = p ? `${short} ${fmt(Number(p.value), l.unit)}${l.target === null ? "" : ` of ${fmt(Number(l.target), l.unit)}`}` : `${short}, no reading yet`;
  const missing = names[l.metric_source] && !connected.has(l.metric_source) ? l.metric_source : null;
  const back = `/app/l/${l.id}`;

  // The Brief tab hint: who last wrote the hire notes, or what is still missing.
  function brief() {
    const st = steps.map((s) => l.setup?.[s.id]).filter((x) => x?.status === "done");
    if (!steps.length || !st.length) return steps.length ? "Not learned yet" : "What the business does";
    const last = st.sort((a, b) => b!.at.localeCompare(a!.at))[0]!;
    return last.by ? `Edited by ${last.by === u.email ? "you" : last.by.split("@")[0]}` : "Learned at hire";
  }

  const hints: Record<Tab, string> = {
    metric: p ? kpi.replace(short + " ", "") : "No reading yet",
    board: proposed ? `${proposed} to approve` : "Nothing to approve",
    calendar: l.plan_status === "ready" ? `${routines.length} routine${routines.length === 1 ? "" : "s"} a week` : "Being planned",
    brief: brief(),
    tracking: r?.signals?.length ? `${r.signals.length} daily read${r.signals.length > 1 ? "s" : ""}` : "Metric only",
    reflection: open ? "Open now" : "Every 2nd Friday",
  };

  return (
    <main className="full">
      {tool_error && (
        <p className="err" role="alert">
          {tool_error}
        </p>
      )}
      {l.fired_at && (
        <div className="xbn rows">
          <div className="r">
            <span>
              <b>
                {l.name} was fired on {when(new Date(l.fired_at), u.tz)}.
              </b>{" "}
              <span className="dim">Nothing runs. The history below stays as it was.</span>
            </span>
            <Link className="btn2 sm" href="/app/hire">
              Hire a looper
            </Link>
          </div>
        </div>
      )}
      {!l.fired_at && (!key || l.plan_status !== "ready" || missing) && (
        <div className="xbn rows">
          {!key && (
            <div className="r">
              <span>
                <b>{owner ? "Connect your model key." : "Waiting for the owner's model key."}</b>{" "}
                <span className="dim">
                  The looper plans its week and runs every routine on {owner ? "your" : "the workspace owner's"} Anthropic, OpenAI or xAI key.
                </span>
              </span>
              {owner && (
                <Link className="btn sm" href="/app/settings#model">
                  Connect key
                </Link>
              )}
            </div>
          )}
          {key && (l.plan_status === "waiting" || l.plan_status === "planning") && (
            <div className="r">
              {/* The plan runs after the hire request; look again until it lands. */}
              <meta httpEquiv="refresh" content="8" />
              <span>
                <b>Planning the week.</b>{" "}
                <span className="dim">Reading {l.website ? l.website.replace(/^https?:\/\//, "") : "your metric"} and writing routines, about a minute.</span>
              </span>
              <span className="pill on">Planning</span>
            </div>
          )}
          {key && l.plan_status === "failed" && (
            <div className="r">
              <span>
                <b>Planning failed.</b> <span className="dim">{l.plan_error}</span>
              </span>
              <form action={replan}>
                <input type="hidden" name="looper" value={l.id} />
                <Submit className="btn2 sm" busy="Starting">
                  Try again
                </Submit>
              </form>
            </div>
          )}
          {missing && (
            <div className="r">
              <span>
                <b>Connect {names[missing]}.</b> <span className="dim">The looper reads {short.toLowerCase()} from it every morning.</span>
              </span>
              {hasComposio() ? (
                <form action={connectTool}>
                  <input type="hidden" name="toolkit" value={missing} />
                  <input type="hidden" name="back" value={back} />
                  <Submit className="btn2 sm" busy="Opening">
                    Connect
                  </Submit>
                </form>
              ) : (
                <span className="dim2">Composio is not configured</span>
              )}
            </div>
          )}
        </div>
      )}

      <div className="xd" style={{ ["--wa" as string]: ca, ["--wb" as string]: cb }}>
        <div className="xd-main">
          <div className="xw">
            <nav className="xseg" aria-label="Looper">
              {TABS.map((x, i) => (
                <Link key={x} href={`?tab=${x}`} aria-current={tab === x ? "page" : undefined} scroll={false}>
                  <span className="sn">
                    <b>{i + 1}</b>
                    {x[0].toUpperCase() + x.slice(1)}
                  </span>
                  <span className="hn tab">{hints[x]}</span>
                </Link>
              ))}
            </nav>
            <div className="xw-p">
              {tab === "metric" && <MetricTab l={l} />}
              {tab === "board" && <BoardTab l={l} tz={u.tz} />}
              {tab === "calendar" && <CalendarTab l={l} tz={u.tz} names={names} />}
              {tab === "brief" && <BriefTab l={l} steps={steps} tz={u.tz} me={u.email} names={names} />}
              {tab === "tracking" && <TrackingTab l={l} tz={u.tz} />}
              {tab === "reflection" && <ReflectionTab l={l} tz={u.tz} me={u.email} />}
            </div>
          </div>

          {!l.fired_at && (
            <aside className="xd-side" aria-label={`Approvals and chat with ${l.name}`}>
              {top.map((c) => (
                <div key={c.id} className="xntf" role="status">
                  <Avatar roleId={l.role} id={l.id} size={32} />
                  <div>
                    <b>
                      {l.name}
                      <small>to approve</small>
                    </b>
                    {c.title}
                    <span className="sub">{c.tool || "by hand"}</span>
                    <span className="act">
                      <Link className="btn2 sm" href="?tab=board">
                        Details
                      </Link>
                      <form action={approve}>
                        <input type="hidden" name="card" value={c.id} />
                        <Submit className="btn sm" busy="Approving">
                          Approve
                        </Submit>
                      </form>
                    </span>
                  </div>
                </div>
              ))}
              <section className="xchat" aria-label={`Chat with ${l.name}`}>
                <ChatPanel l={l} tz={u.tz} me={u.email} names={names} routines={routines} />
              </section>
            </aside>
          )}
        </div>

        <div className="xdock">
          <div className="xdock-g" aria-label="Your loopers">
            {team.map((x) => (
              <Link key={x.id} href={`/app/l/${x.id}`} aria-current={x.id === l.id ? "page" : undefined} title={x.name}>
                <Avatar roleId={x.role} id={x.id} size={40} />
                <span className="rl">{x.name}</span>
              </Link>
            ))}
            <Link href="/app/hire" title="Hire a looper" className="add">
              <span className="xav-add" aria-hidden="true">
                +
              </span>
              <span className="rl">Hire</span>
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
