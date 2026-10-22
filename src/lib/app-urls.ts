// Web addresses that belong to an app a looper can connect. A link like
// drive.google.com/drive/folders/<id> is a job for the Drive tools, never for the browser:
// the app reads it without a login, and the browser would stop at a sign-in page.

const APPS: { slug: string; name: string; test: RegExp }[] = [
  { slug: "googlesheets", name: "Google Sheets", test: /^(docs\.google\.com\/spreadsheets|sheets\.google\.com)/ },
  { slug: "googledocs", name: "Google Docs", test: /^docs\.google\.com\/document/ },
  { slug: "googleslides", name: "Google Slides", test: /^docs\.google\.com\/presentation/ },
  // Drive opens every Google file, so it also covers Docs, Sheets and Slides links.
  { slug: "googledrive", name: "Google Drive", test: /^(drive|docs)\.google\.com/ },
  { slug: "gmail", name: "Gmail", test: /^mail\.google\.com/ },
  { slug: "googlecalendar", name: "Google Calendar", test: /^calendar\.google\.com/ },
  { slug: "google_analytics", name: "Google Analytics", test: /^analytics\.google\.com/ },
  { slug: "google_search_console", name: "Google Search Console", test: /^search\.google\.com\/search-console/ },
  { slug: "googleads", name: "Google Ads", test: /^ads\.google\.com/ },
  { slug: "stripe", name: "Stripe", test: /^dashboard\.stripe\.com/ },
  { slug: "notion", name: "Notion", test: /^notion\.so/ },
  { slug: "hubspot", name: "HubSpot", test: /^app(-[a-z0-9]+)?\.hubspot\.com/ },
  { slug: "slack", name: "Slack", test: /^([a-z0-9-]+\.)?slack\.com\/(client|archives)/ },
  { slug: "linear", name: "Linear", test: /^linear\.app/ },
  { slug: "airtable", name: "Airtable", test: /^airtable\.com/ },
  { slug: "dropbox", name: "Dropbox", test: /^dropbox\.com/ },
  { slug: "one_drive", name: "OneDrive", test: /^(onedrive\.live\.com|[a-z0-9-]+\.sharepoint\.com)/ },
  { slug: "outlook", name: "Outlook", test: /^outlook\.(office|office365|live)\.com/ },
  { slug: "asana", name: "Asana", test: /^app\.asana\.com/ },
  { slug: "trello", name: "Trello", test: /^trello\.com/ },
  { slug: "xero", name: "Xero", test: /^go\.xero\.com/ },
  { slug: "quickbooks", name: "QuickBooks", test: /^(app\.)?qbo\.intuit\.com/ },
  { slug: "shopify", name: "Shopify", test: /^(admin\.shopify\.com|[a-z0-9-]+\.myshopify\.com\/admin)/ },
];

/** The connected app that owns this URL, if any (`slugs` are the looper's connected toolkits). */
export function connectedAppFor(url: string, slugs: string[]) {
  let where: string;
  try {
    const u = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`);
    where = u.hostname.replace(/^www\./, "") + u.pathname;
  } catch {
    return null;
  }
  const app = APPS.find((a) => slugs.includes(a.slug) && a.test.test(where));
  return app ? { slug: app.slug, name: app.name } : null;
}

/** What the looper hears when it reaches for the browser (or a takeover) on a connected app's page. */
export const viaAppNote = (name: string) =>
  `${name} is connected, so read this with its tools, not the browser: find_tools "${name.toLowerCase()} …" and pass the file, folder or record id from the URL. If the connected account can't see it, it belongs to another account: ask_owner to share it with the connected account (name it), or to connect that account on your Tools tab. Don't open it in the browser and don't ask for a takeover to log in.`;
