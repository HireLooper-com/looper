import Link from "next/link";
import { connection } from "next/server";
import { getState } from "./actions";
import { progress } from "@/components/team-list";
import { Avatar, Bot, Sparkline, accentHex, cx, fmt, timeAgo } from "@/components/ui";
import { occurrences } from "@/lib/schedule";
import { cardAssignee, PROVIDERS } from "@/lib/types";

function greeting(d = new Date()) {
  const h = d.getHours();
  return h < 5 ? "Good evening" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

function nextRun(skills: { schedule: Parameters<typeof occurrences>[0] }[], now: number) {
  return skills
    .flatMap((s) => occurrences(s.schedule, new Date(now), new Date(now + 8 * 864e5)).slice(0, 1))
    .sort((a, b) => a.getTime() - b.getTime())[0];
}

const nowMs = () => Date.now();

export default async function Home() {
  await connection();
  const state = await getState();
  const { loopers, runs, cards, chief, settings, user } = state;
  const now = nowMs();
  const plan = PROVIDERS.find((p) => p.id === settings.provider)?.plan;
  const name = user.email?.split("@")[0];
  const lastChief = chief.filter((m) => m.role === "assistant").at(-1);

  return (
    <div className="pb-16">
      <div className="mx-auto max-w-[1100px]">
        <header className="flex flex-col items-center pb-8 pt-12 text-center">
          <span className="flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-b from-[#a1a1a6] to-[#6e6e73] text-[2rem] font-semibold uppercase text-white">
            {(user.email ?? "?").slice(0, 1)}
          </span>
          <h1 className="display mt-4 text-[2rem] sm:text-[2.5rem]">
            {greeting()}
            {name ? `, ${name}` : ""}
          </h1>
          <p className="mt-1 text-[1rem] text-mute">
            {loopers.length} {loopers.length === 1 ? "looper" : "loopers"} · running on your {plan} plan
          </p>
        </header>

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {/* Chief: wide tile */}
          <Link href="/chief" className="tile group flex min-h-[220px] flex-col p-6 sm:col-span-2">
            <div className="flex items-center gap-3">
              <Bot dark size={40} seed="chief" />
              <div>
                <div className="text-[1.0625rem] font-semibold">Chief</div>
                <div className="text-[0.8125rem] text-mute">Hire, brief and manage your loopers</div>
              </div>
            </div>
            <div className="mt-5 flex-1">
              {lastChief ? (
                <div className="max-w-[90%] rounded-[18px] rounded-bl-[6px] bg-[#e9e9eb] px-4 py-2.5 text-[0.9375rem] leading-snug text-ink">
                  <p className="line-clamp-3 whitespace-pre-wrap">{lastChief.content}</p>
                </div>
              ) : (
                <p className="max-w-[46ch] text-[1.0625rem] leading-snug text-ink-2">
                  Tell Chief what number you want to move. It hires a looper with one metric, a kanban board, a skill calendar and a retro.
                </p>
              )}
            </div>
            <div className="mt-5 flex h-10 items-center rounded-full bg-well px-4 text-[0.9375rem] text-faint group-hover:bg-[#ececf0]">Message Chief…</div>
          </Link>

          {/* Stats */}
          <div className="tile flex flex-col justify-between gap-4 p-6">
            <div className="text-[1.0625rem] font-semibold">This week</div>
            <div className="grid grid-cols-2 gap-4">
              <Stat value={runs.filter((r) => now - Date.parse(r.startedAt) < 7 * 864e5).length} label="skill runs" />
              <Stat value={cards.filter((c) => c.column !== "done").length} label="open cards" />
              <Stat value={cards.filter((c) => c.column === "done" && now - Date.parse(c.updatedAt) < 7 * 864e5).length} label="cards done" />
              <Stat value={state.retros.filter((r) => now - Date.parse(r.createdAt) < 7 * 864e5).length} label="retros" />
            </div>
          </div>

          {loopers.map((l) => {
            const { current, pct, onTrack } = progress(l);
            const last = runs.filter((r) => r.looperId === l.id).at(-1);
            const next = l.status === "active" ? nextRun(l.skills, now) : undefined;
            return (
              <Link key={l.id} href={`/loopers/${l.id}`} className="tile flex flex-col gap-4 p-6">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <Avatar seed={l.id} color={l.color} size={40} />
                    <div>
                      <div className="text-[1.0625rem] font-semibold">{l.name}</div>
                      <div className="text-[0.8125rem] text-mute">{l.status === "paused" ? "Paused" : last?.status === "running" ? "Working now" : last ? `Ran ${timeAgo(last.startedAt)}` : "Not run yet"}</div>
                    </div>
                  </div>
                  {(() => {
                    const waiting = cards.filter((c) => c.looperId === l.id && c.column !== "done" && cardAssignee(c) === "you").length;
                    return waiting ? (
                      <span className="rounded-full bg-blue px-2.5 py-1 text-[0.75rem] font-semibold text-white">{waiting} for you</span>
                    ) : last?.status === "running" ? (
                      <span className="pulse-dot mt-2 h-2 w-2 rounded-full bg-green" />
                    ) : null;
                  })()}
                </div>
                <div>
                  <div className="text-[0.8125rem] text-mute">{l.metric.name}</div>
                  <div className="mt-0.5 flex items-end justify-between gap-3">
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-[2.25rem] font-semibold leading-none tracking-[-0.03em] tabular-nums">{fmt(current)}</span>
                      <span className="text-[0.8125rem] text-faint">/ {fmt(l.metric.target)}</span>
                    </div>
                    <Sparkline values={l.metric.history.map((p) => p.value)} color={accentHex[l.color]} width={88} height={32} />
                  </div>
                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[#ececf0]">
                    <div className={cx("h-full rounded-full", onTrack ? "bg-green" : "bg-blue")} style={{ width: `${pct}%` }} />
                  </div>
                </div>
                <div className="mt-auto text-[0.8125rem] text-mute">
                  {next ? `Next: ${next.toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false })}` : "No upcoming runs"}
                </div>
              </Link>
            );
          })}

          <Link href="/loopers/new" className="tile flex min-h-[220px] flex-col items-center justify-center gap-3 p-6 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-blue/10 text-[1.75rem] leading-none text-blue">+</span>
            <div className="text-[1.0625rem] font-semibold">Hire a looper</div>
            <div className="max-w-[24ch] text-[0.8125rem] text-mute">Or ask Chief to draft one from your goal.</div>
          </Link>

          <Link href="/settings" className="tile flex flex-col gap-3 p-6">
            <div className="flex items-center gap-3">
              <span className="app-icon flex h-10 w-10 items-center justify-center bg-gradient-to-b from-[#a1a1a6] to-[#6e6e73] text-[1.1rem] text-white">⚙︎</span>
              <div className="text-[1.0625rem] font-semibold">Integrations</div>
            </div>
            <p className="text-[0.875rem] text-mute">
              {settings.integrations.length
                ? `${settings.integrations.filter((i) => i.enabled).length} hub${settings.integrations.length === 1 ? "" : "s"} connected: ${settings.integrations.map((i) => i.name).join(", ")}`
                : "Connect Composio, Zapier or Pipedream so loopers can use thousands of apps."}
            </p>
          </Link>
        </div>
      </div>
    </div>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div>
      <div className="text-[1.75rem] font-semibold leading-none tracking-[-0.03em] tabular-nums">{value}</div>
      <div className="mt-1 text-[0.8125rem] text-mute">{label}</div>
    </div>
  );
}
