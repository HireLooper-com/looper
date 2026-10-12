import { unmetered } from "./billing";

// Public contact address, used on the privacy and terms pages.
export const CONTACT = "hello@hirelooper.com";

// Base URL in emails. On-prem installs set LOOPER_URL to their own host; a self-hosted Vercel deploy
// without it uses the project's production domain.
const vercel = unmetered() && process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "";
export const SITE = (process.env.LOOPER_URL || vercel || "https://hirelooper.com").replace(/\/$/, "");
