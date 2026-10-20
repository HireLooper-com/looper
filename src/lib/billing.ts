import "server-only";
import Stripe from "stripe";
import { loopsContact, loopsEvent } from "./loops";
import { getUser, getWorkspace, mutateWorkspace, type Plan, type Workspace } from "./workspace";

// Hosted plans. Without STRIPE_SECRET_KEY (self-hosted) everything is open and nothing is metered.
//   Personal $49/month: unlimited loopers, $49 of AI credits once.
//   Team $199/month: unlimited collaborators and loopers, $199 of AI credits once.
// Each workspace may spend up to $5 a month on computers and storage.

export const PLANS: Record<Plan, { name: string; usd: number; credits: number; priceEnv: string; blurb: string }> = {
  personal: { name: "Personal", usd: 49, credits: 49, priceEnv: "STRIPE_PRICE_PERSONAL", blurb: "Unlimited loopers, just you" },
  team: { name: "Team", usd: 199, credits: 199, priceEnv: "STRIPE_PRICE_TEAM", blurb: "Unlimited collaborators and loopers" },
};

export const INFRA_CAP_USD = 5;

export const billingEnabled = () => !!process.env.STRIPE_SECRET_KEY;

let stripeClient: Stripe | null = null;
export function stripe() {
  if (!process.env.STRIPE_SECRET_KEY) throw new Error("Billing isn't configured.");
  stripeClient ??= new Stripe(process.env.STRIPE_SECRET_KEY);
  return stripeClient;
}

const ACTIVE = new Set(["active", "trialing", "past_due"]);
const compedEmails = () => (process.env.COMP_EMAILS ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);

/** Can this workspace use the hosted app right now? */
export function hasAccess(ws: Workspace | undefined, ownerEmail?: string) {
  if (!billingEnabled()) return true;
  if (!ws) return false;
  if (ws.comped || (ownerEmail && compedEmails().includes(ownerEmail.toLowerCase()))) return true;
  return !!ws.billing && ACTIVE.has(ws.billing.status);
}

export const creditsLeft = (ws: Workspace | undefined) => Math.max(0, (ws?.credits?.granted ?? 0) - (ws?.credits?.used ?? 0));

const month = () => new Date().toISOString().slice(0, 7);
export const infraSpent = (ws: Workspace | undefined) => (ws?.infra?.month === month() ? ws.infra.usd : 0);

// — Metering —

// Hosted model calls are priced from the model catalog (./models) and spent here.

export async function spendCredits(wsId: string, usd: number) {
  if (!(usd > 0)) return;
  await mutateWorkspace(wsId, (w) => {
    w.credits = { granted: w.credits?.granted ?? 0, used: (w.credits?.used ?? 0) + usd };
  });
}

/** Machines and storage this month; refused past the monthly cap. */
export async function spendInfra(wsId: string, usd: number) {
  if (!billingEnabled() || !(usd > 0)) return;
  await mutateWorkspace(wsId, (w) => {
    const m = month();
    w.infra = { month: m, usd: (w.infra?.month === m ? w.infra.usd : 0) + usd };
  });
}

export async function assertInfraBudget(wsId: string) {
  if (!billingEnabled()) return;
  const ws = await getWorkspace(wsId);
  if (ws?.comped) return;
  if (infraSpent(ws) >= INFRA_CAP_USD)
    throw new Error(`This workspace used its $${INFRA_CAP_USD} of computer time for this month. The computer is back on the 1st; apps, boards and chat keep working.`);
}

// — Stripe —

const priceOf = (plan: Plan) => {
  const id = process.env[PLANS[plan].priceEnv];
  if (!id) throw new Error(`Set ${PLANS[plan].priceEnv} to the Stripe price for the ${PLANS[plan].name} plan.`);
  return id;
};

const planOfPrice = (priceId?: string): Plan | undefined => (Object.keys(PLANS) as Plan[]).find((p) => process.env[PLANS[p].priceEnv] === priceId);

export async function checkoutUrl(ws: Workspace, plan: Plan, email: string | undefined, origin: string, template?: string) {
  const session = await stripe().checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: priceOf(plan), quantity: 1 }],
    client_reference_id: ws.id,
    metadata: { workspaceId: ws.id, plan },
    subscription_data: { metadata: { workspaceId: ws.id, plan } },
    ...(ws.billing?.customerId ? { customer: ws.billing.customerId } : { customer_email: email }),
    allow_promotion_codes: true,
    success_url: `${origin}/billing?welcome=1${template ? `&template=${encodeURIComponent(template)}` : ""}`,
    cancel_url: `${origin}/billing?plan=${plan}`,
  });
  return session.url!;
}

export async function portalUrl(ws: Workspace, origin: string) {
  if (!ws.billing?.customerId) throw new Error("No subscription yet.");
  const s = await stripe().billingPortal.sessions.create({ customer: ws.billing.customerId, return_url: `${origin}/billing` });
  return s.url;
}

/** Keep the workspace's plan in step with its Stripe subscription; grant each plan's credits once. */
export async function syncSubscription(sub: Stripe.Subscription) {
  const wsId = sub.metadata?.workspaceId;
  if (!wsId) return;
  const plan = planOfPrice(sub.items.data[0]?.price.id) ?? (sub.metadata.plan as Plan | undefined);
  if (!plan) return;
  const periodEnd = sub.items.data[0]?.current_period_end;
  const before = (await getWorkspace(wsId))?.billing?.status;
  const ws = await mutateWorkspace(wsId, (w) => {
    w.billing = {
      plan,
      status: sub.status,
      customerId: typeof sub.customer === "string" ? sub.customer : sub.customer.id,
      subscriptionId: sub.id,
      periodEnd: periodEnd ? new Date(periodEnd * 1000).toISOString() : undefined,
    };
    const grants = new Set(w.creditGrants ?? []);
    if (ACTIVE.has(sub.status) && !grants.has(plan)) {
      grants.add(plan);
      w.creditGrants = [...grants];
      w.credits = { granted: (w.credits?.granted ?? 0) + PLANS[plan].credits, used: w.credits?.used ?? 0 };
    }
    return { ...w };
  });
  // Tell Loops when a plan starts or ends, so its loops can welcome or win back the owner.
  const owner = await getUser(ws.ownerId);
  if (!owner?.email) return;
  const active = ACTIVE.has(sub.status);
  if (active !== (before !== undefined && ACTIVE.has(before))) {
    loopsContact(owner, { plan: active ? plan : "none" });
    loopsEvent(owner.email, active ? "subscribed" : "subscription_ended", { plan });
  }
}
