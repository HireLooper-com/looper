// Create (or find) the Looper plans and the webhook in Stripe. Safe to run again.
//   STRIPE_SECRET_KEY=sk_test_… APP_URL=https://app.hirelooper.com node scripts/stripe-setup.mjs
// Prints the env vars to set: STRIPE_PRICE_PERSONAL, STRIPE_PRICE_TEAM, STRIPE_WEBHOOK_SECRET.
import Stripe from "stripe";

const key = process.env.STRIPE_SECRET_KEY;
const app = process.env.APP_URL?.replace(/\/$/, "");
if (!key || !app) throw new Error("Set STRIPE_SECRET_KEY and APP_URL.");
const stripe = new Stripe(key);

const PLANS = [
  { lookup: "looper_personal_monthly", name: "Looper Personal", usd: 49, env: "STRIPE_PRICE_PERSONAL", desc: "Unlimited loopers for you. Includes $49 in AI credits once." },
  { lookup: "looper_team_monthly", name: "Looper Team", usd: 199, env: "STRIPE_PRICE_TEAM", desc: "Unlimited collaborators and loopers. Includes $199 in AI credits once." },
];

const out = {};
for (const p of PLANS) {
  const found = (await stripe.prices.list({ lookup_keys: [p.lookup], limit: 1 })).data[0];
  if (found) {
    out[p.env] = found.id;
    continue;
  }
  const product = await stripe.products.create({ name: p.name, description: p.desc });
  const price = await stripe.prices.create({ product: product.id, currency: "usd", unit_amount: p.usd * 100, recurring: { interval: "month" }, lookup_key: p.lookup });
  out[p.env] = price.id;
}

const url = `${app}/api/stripe/webhook`;
const events = ["checkout.session.completed", "customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted"];
const existing = (await stripe.webhookEndpoints.list({ limit: 100 })).data.find((w) => w.url === url);
if (existing) {
  console.log(`Webhook already exists for ${url} (its signing secret is shown once, in the Stripe dashboard).`);
} else {
  const hook = await stripe.webhookEndpoints.create({ url, enabled_events: events, description: "Looper subscriptions" });
  out.STRIPE_WEBHOOK_SECRET = hook.secret;
}

// Let customers manage their subscription, card and invoices.
const configs = await stripe.billingPortal.configurations.list({ is_default: true, limit: 1 });
if (!configs.data.length)
  await stripe.billingPortal.configurations.create({
    business_profile: { headline: "Looper billing" },
    features: { invoice_history: { enabled: true }, payment_method_update: { enabled: true }, subscription_cancel: { enabled: true, mode: "at_period_end" } },
  });

console.log("\nSet these in Vercel (Production):");
for (const [k, v] of Object.entries(out)) console.log(`${k}=${k === "STRIPE_WEBHOOK_SECRET" ? `${v.slice(0, 10)}… (full value printed only here; copy it now)` : v}`);
if (out.STRIPE_WEBHOOK_SECRET) console.log(`\nFull webhook secret: ${out.STRIPE_WEBHOOK_SECRET}`);
