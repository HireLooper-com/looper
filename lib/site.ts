// Public contact address, used on the privacy and terms pages.
export const CONTACT = "hello@hirelooper.com";

// Base URL in emails. On-prem installs set LOOPER_URL to their own host.
export const SITE = (process.env.LOOPER_URL || "https://hirelooper.com").replace(/\/$/, "");
