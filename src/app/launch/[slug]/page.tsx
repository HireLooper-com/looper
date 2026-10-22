import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { after, connection } from "next/server";
import { LogoMark } from "@/components/brand";
import { fmt, timeAgo } from "@/components/ui";
import { tickUser } from "@/lib/agent";
import { claimTick, getLaunch, isStale, launchDayLabel, launchSlug, launchStart, refreshLaunch, type Launch } from "@/lib/launch";
import { currentUser } from "@/lib/session";
import { appUrl } from "@/lib/loops";
import { Countdown, LiveRefresh, SetUpLaunch, VotesChart } from "./live";

// A view can start the launch looper's due hourly runs, as opening the app does.
export const maxDuration = 300;

const phLink = (slug: string) => `https://www.producthunt.com/posts/${slug}`;

function headline(l: Launch) {
  const p = l.points.at(-1);
  if (!p && l.launchDay) return `${l.name} launches on Product Hunt ${launchDayLabel(l.launchDay)}`;
  return p?.rank ? `${l.name} is #${p.rank} on Product Hunt today` : `${l.name} on Product Hunt`;
}

export async function generateMetadata({ params }: PageProps<"/launch/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const l = await getLaunch(slug);
  if (!l?.uid) return { title: "Set up a launch scoreboard · Looper", robots: { index: false } };
  const p = l.points.at(-1);
  const title = headline(l);
  const description = p
    ? `${fmt(p.votes)} upvotes and ${fmt(p.comments)} comments so far. Live launch scoreboard, run by a looper.`
    : `${l.tagline ? `${l.tagline}. ` : ""}Follow the launch live: upvotes, rank and every comment answered.`;
  return { title, description, openGraph: { title, description, siteName: "Looper", type: "website" }, twitter: { card: "summary_large_image", title, description } };
}

export default async function LaunchPage({ params }: PageProps<"/launch/[slug]">) {
  await connection();
  const { slug } = await params;
  const l = await getLaunch(slug);
  if (!l?.uid) {
    // Signed in: set the page up before the launch goes live. Signed out: nothing here yet.
    if (!(await currentUser())) notFound();
    let valid = true;
    try {
      launchSlug(slug);
    } catch {
      valid = false;
    }
    if (!valid) notFound();
    return (
      <div className="mx-auto max-w-[560px] px-4 py-10 sm:px-6 sm:py-14">
        <h1 className="display text-[2rem]">
          Set up your launch scoreboard.
          <span className="text-faint"> A public page with your upvotes, rank and comments, live all launch day. Share it before you go live.</span>
        </h1>
        <SetUpLaunch slug={slug} />
      </div>
    );
  }
  after(async () => {
    if (isStale(l)) await refreshLaunch(slug).catch((e) => console.error("[launch] refresh", slug, e));
    if (await claimTick(slug)) await tickUser(l.uid).catch((e) => console.error("[launch] tick", e));
  });
  const owner = (await currentUser())?.ws === l.uid;
  const p = l.points.at(-1);
  const startsAt = !p && l.launchDay ? launchStart(l.launchDay).toISOString() : undefined;
  const prev = l.points.findLast((x) => p && Date.parse(p.at) - Date.parse(x.at) >= 55 * 60_000);
  const lastHour = p && prev ? p.votes - prev.votes : undefined;
  const badge = `${appUrl()}/launch/${slug}/badge`;

  return (
    <div className="mx-auto max-w-[760px] px-4 py-10 sm:px-6 sm:py-14">
      <LiveRefresh />
      <div className="flex items-start gap-4">
        {l.thumbnail && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={l.thumbnail} alt="" width={56} height={56} className="app-icon h-14 w-14 shrink-0 object-cover" />
        )}
        <h1 className="display min-w-0 text-[2rem] sm:text-[2.5rem]">
          {l.name}
          {l.tagline && <span className="text-faint">. {l.tagline.replace(/\.$/, "")}.</span>}
        </h1>
      </div>

      {!p && (
        <section className="tile mt-8 p-5 sm:p-6">
          <div className="eyebrow">{l.launchDay ? `Goes live ${launchDayLabel(l.launchDay)}, 12:01 AM Pacific` : "Not live yet"}</div>
          {startsAt ? <Countdown to={startsAt} /> : <div className="mt-1 text-[1.75rem] font-semibold tracking-[-0.03em]">Launching soon</div>}
          <p className="mt-2 text-[0.9375rem] text-mute">Upvotes, rank and comments show here from the first minute of the launch.</p>
        </section>
      )}

      {p && (
        <>
          <div className="mt-8 grid grid-cols-3 gap-2.5">
            <Stat label="Today" value={p.rank ? `#${p.rank}` : "Not ranked"} />
            <Stat label="Upvotes" value={fmt(p.votes)} note={lastHour ? `+${fmt(lastHour)} in the last hour` : undefined} />
            <Stat label="Comments" value={fmt(p.comments)} note={l.replies ? `${fmt(l.replies.answered)} answered by the makers` : undefined} />
          </div>

          <section className="tile mt-2.5 p-5">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="eyebrow">Upvotes, Pacific time</h2>
              <span className="text-[0.8125rem] tabular-nums text-faint">Updated {timeAgo(l.updatedAt)}</span>
            </div>
            <VotesChart points={l.points.map(({ at, votes, rank }) => ({ at, votes, rank }))} />
          </section>
        </>
      )}

      {l.replies?.medianMinutes !== undefined && (
        <p className="mt-5 text-[1.0625rem] font-medium tracking-[-0.01em]">
          Comments answered in a median of {fmt(Math.round(l.replies.medianMinutes))} minutes.
          <span className="text-faint"> Each reply drafted by a looper and approved by the makers.</span>
        </p>
      )}

      {l.topComments.length > 0 && (
        <section className="mt-8">
          <h2 className="eyebrow">Top comments</h2>
          <div className="mt-2 flex flex-col gap-2.5">
            {l.topComments.map((c, i) => (
              <figure key={i} className="tile p-5">
                <blockquote className="whitespace-pre-line text-[0.9375rem] leading-relaxed text-ink-2">{c.body}</blockquote>
                <figcaption className="mt-2 flex items-center gap-2 text-[0.8125rem] text-mute">
                  <span className="font-medium text-ink">{c.author}</span>
                  {c.votes ? <span className="tabular-nums">▲ {fmt(c.votes)}</span> : null}
                </figcaption>
              </figure>
            ))}
          </div>
        </section>
      )}

      <div className="mt-8 flex flex-wrap items-center gap-3">
        <a href={phLink(slug)} target="_blank" rel="noopener" className="inline-flex h-10 items-center rounded-full bg-blue px-5 text-[0.9375rem] font-medium text-page hover:bg-blue-hover">
          Open on Product Hunt
        </a>
        {l.website && (
          <a href={l.website} target="_blank" rel="noopener" className="inline-flex h-10 items-center rounded-full bg-ink/[0.08] px-5 text-[0.9375rem] font-medium hover:bg-ink/[0.11]">
            Visit {l.name}
          </a>
        )}
      </div>

      {owner && !l.looperId && (
        <section className="tile mt-8 p-5">
          <h2 className="eyebrow">Only you see this</h2>
          <p className="mt-1 text-[0.9375rem] text-ink-2">
            No looper posts to this page yet. Hire Rally, pin this launch&apos;s Product Hunt link on its canvas, and it keeps the page live and drafts a reply to every comment.
          </p>
          <Link href="/hire?template=product-hunt-launch" className="mt-3 inline-flex h-9 items-center rounded-full bg-blue px-4 text-[0.875rem] font-medium text-page hover:bg-blue-hover">
            Hire Rally
          </Link>
        </section>
      )}

      {owner && (
        <section className="tile mt-2.5 p-5">
          <h2 className="eyebrow">Only you see this</h2>
          <p className="mt-1 text-[0.9375rem] text-ink-2">Put the live badge on your site or in your README. It links back to this page.</p>
          <pre className="mt-3 overflow-x-auto rounded-[12px] bg-well p-3 text-[0.75rem] text-ink-2">{`<a href="${appUrl()}/launch/${slug}"><img src="${badge}" alt="${l.name} on Product Hunt" height="40"></a>`}</pre>
        </section>
      )}

      <footer className="mt-14 flex flex-col items-start gap-4 border-t border-line pt-8 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <LogoMark size={36} />
          <p className="max-w-[46ch] text-[0.875rem] text-ink-2">
            A looper runs this launch.
            <span className="text-mute"> It keeps this page live and drafts a reply to every comment for the makers to approve.</span>
          </p>
        </div>
        <Link href="/login?template=product-hunt-launch" className="inline-flex h-10 shrink-0 items-center rounded-full bg-ink/[0.08] px-5 text-[0.9375rem] font-medium hover:bg-ink/[0.11]">
          Get one for your launch
        </Link>
      </footer>
    </div>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="tile min-w-0 p-4 sm:p-5">
      <div className="eyebrow">{label}</div>
      <div className="mt-1 text-[1.75rem] font-semibold tabular-nums tracking-[-0.03em] sm:text-[2.25rem]">{value}</div>
      {note && <div className="mt-0.5 text-[0.75rem] leading-snug text-mute">{note}</div>}
    </div>
  );
}
