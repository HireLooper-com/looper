// Transactional email over the Loops REST API. Every email uses one generic
// Loops template (LOOPS_TEMPLATE_ID) with three data variables: subject,
// heading and body. On-prem installs set SMTP_URL instead and send plain text
// through their own mail server. Without either, the email goes to the server
// log, which is enough for local work.
export type Mail = { subject: string; heading: string; body: string };

async function smtp(email: string, mail: Mail) {
  const nodemailer = (await import("nodemailer")).default;
  const t = nodemailer.createTransport(process.env.SMTP_URL);
  await t.sendMail({ from: process.env.SMTP_FROM || "Looper <looper@localhost>", to: email, subject: mail.subject, text: `${mail.heading}\n\n${mail.body}` });
}

export async function sendMail(email: string, mail: Mail) {
  if (process.env.SMTP_URL) return smtp(email, mail);
  const key = process.env.LOOPS_API_KEY;
  const transactionalId = process.env.LOOPS_TEMPLATE_ID;
  if (!key || !transactionalId) {
    if (process.env.NODE_ENV === "production") throw new Error("LOOPS_API_KEY or LOOPS_TEMPLATE_ID is not set");
    console.log(`[mail] to ${email}:`, mail);
    return;
  }
  const res = await fetch("https://app.loops.so/api/v1/transactional", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ transactionalId, email, dataVariables: mail }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Loops ${res.status}: ${await res.text()}`);
}

export const sendCode = (email: string, code: string) =>
  sendMail(email, {
    subject: `${code} is your Looper code`,
    heading: code,
    body: "Enter this code to sign in to Looper. It works for 10 minutes. If you did not ask for it, ignore this email.",
  });

export const sendInvite = (email: string, i: { from: string; workspace: string; url: string }) =>
  sendMail(email, {
    subject: `${i.from} added you to ${i.workspace} on Looper`,
    heading: `Join ${i.workspace}`,
    body: `${i.from} added you as a collaborator in ${i.workspace}. You approve cards, reject them with a reason and join the reflection every second Friday. Sign in with this email: ${i.url}`,
  });

/** After A-team or enterprise checkout: book the setup call with the Looper engineer. */
export const setupUrl = () => process.env.LOOPER_SETUP_URL || "";

export const sendSetup = (email: string, plan: string) =>
  sendMail(email, {
    subject: `Book your Looper setup call`,
    heading: plan === "enterprise" ? "Welcome to Bloody enterprise" : "Welcome to A-team",
    body: setupUrl()
      ? `Pick a 45 minute slot with your Looper engineer: ${setupUrl()}. On the call we set up every workspace, connect the tools and agree the first routines. Rules are reviewed with you every 2 weeks after that.`
      : `Your Looper engineer emails you within 1 business day to set up every workspace, connect the tools and agree the first routines. Rules are reviewed with you every 2 weeks after that.`,
  });
