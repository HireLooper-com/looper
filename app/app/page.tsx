import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { sql } from "@/lib/db";
import { currentWorkspace, wsPaid } from "@/lib/workspace";
import { unmetered } from "@/lib/billing";
import { saveWebsite } from "../actions";
import { Form, Submit } from "../ui";
import HireChart from "./hire/chart";
import ModelStep from "./model-form";
import StartPro from "./start-pro";

// Onboarding, one step per screen: start Pro in Stripe, the website, the AI the loopers run on, the first hire.
// Hiring opens the looper builder (/app/new): metric, unit of work, tools, skills.
const STEPS = ["Start Pro", "Your website", "Your AI", "Hire a looper"];

export default async function AppHome({ searchParams }: { searchParams: Promise<{ paid?: string }> }) {
  const u = await requireUser();
  const { paid: back } = await searchParams;
  const ws = await currentWorkspace(u);
  const paid = wsPaid(ws);
  const [looper] = await sql<{ id: number }>`select id from loopers where workspace_id = ${ws.id} and fired_at is null order by id limit 1`;
  if (looper && paid) redirect(`/app/l/${looper.id}`);

  // Loopers run on the owner's key; a member whose owner has none goes on to the team and sees the loopers wait.
  const [key] = await sql`select 1 from model_keys where user_id = ${ws.owner_id}`;
  const step = !paid ? 0 : !ws.website ? 1 : !key && ws.role === "owner" ? 2 : 3;

  return (
    <main className={step === 3 ? "wide" : "wide xset"}>
      <ol className="xs" aria-label="Setup">
        {/* Installs without billing never see Start Pro, so the steps count from the website. */}
        {STEPS.map((s, i) => [s, i] as const).slice(unmetered() ? 1 : 0).map(([s, i], n) => (
          <li key={s} className={i < step ? "done" : i === step ? "now" : ""} aria-current={i === step ? "step" : undefined}>
            <b className="tab">{i < step ? "✓" : n + 1}</b>
            {s}
          </li>
        ))}
      </ol>

      {step === 0 && ws.role === "member" && (
        <>
          <h1>
            {ws.name} is paused. <span className="c">{ws.owner_email} owns this workspace and its plan has ended.</span>
          </h1>
          <section className="xset-s">
            <div className="xset-h">
              <h2>Plan</h2>
              <p className="dim">Loopers here run on the owner's subscription and model key.</p>
            </div>
            <div className="xset-b">
              <div className="xset-c">
                <p className="xset-plan">
                  <b>Paused</b>
                  <span className="dim">{ws.owner_email}</span>
                </p>
                <p className="dim">Ask them to restart the plan in Billing.</p>
              </div>
            </div>
          </section>
        </>
      )}

      {step === 0 && ws.role === "owner" && <StartPro u={u} back={back} />}

      {step === 1 && (
        <>
          <h1>
            {ws.name === "My workspace" ? "Your website." : `${ws.name}'s website.`} <span className="c">Your loopers read it to plan their first week.</span>
          </h1>
          <section className="xset-s">
            <div className="xset-h">
              <h2>Website</h2>
              <p className="dim">The model reads your homepage and writes each looper's brief, routines and tools from it.</p>
            </div>
            <div className="xset-b">
              <Form action={saveWebsite} className="xset-c">
                <label htmlFor="website">Website</label>
                <div className="xset-in">
                  <input id="website" name="website" required autoFocus inputMode="url" autoComplete="url" placeholder="timetuna.com" />
                  <Submit busy="Saving">Continue</Submit>
                </div>
              </Form>
            </div>
          </section>
        </>
      )}

      {step === 2 && (
        <>
          <h1>
            Your AI. <span className="c">Every looper thinks with your own model, so we never bill you for tokens.</span>
          </h1>
          <section className="xset-s">
            <div className="xset-h">
              <h2>Model</h2>
              <p className="dim">It reads your website, suggests tools, writes skills and every card. Change it any time in Settings.</p>
            </div>
            <div className="xset-b">
              <ModelStep />
            </div>
          </section>
        </>
      )}

      {step === 3 && (
        <>
          <h1>
            Hire your first looper. <span className="c">Pick a role to start from, or build your own.</span>
          </h1>
          <HireChart ws={ws} />
        </>
      )}
    </main>
  );
}
