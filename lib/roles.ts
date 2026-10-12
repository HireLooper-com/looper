// Roles a founder can hire, in the order of the org chart on the landing page.
// A role is a spec: data only. The engine reads it and never names a role in code.
//
//   metrics   what it owns, read once a day
//   subject   the one thing a card changes (a page, a campaign); locks, check-backs and the ledger key off it
//   setup     what it learns once at hire, from the website or a connected tool; the Brief tab, editable
//   signals   what it reads every day besides the metric, stored in the ledger
//   routines  presets on the weekly calendar (input from the ledger, an action kind, a check-back);
//             roles without presets get routines written by the model at hire from `guide`
//   check     how a done card is judged: read the subject on these days after it shipped
//   limits    guardrails applied when cards are created
//   work      units of work to pick from in the builder: what one card ships, and the preset routines that ship it
//
// At hire the spec is copied into the looper (routines, rules, setup results), and from then on
// reflection and chat change the looper's copy, never the spec.

export type MetricPreset = {
  name: string;
  source: string; // Composio toolkit slug, "geo", or "manual"
  unit: string;
  direction: "up" | "down";
  hint: string; // how the reader should compute the number
};

/** What a card does on approval. `tool`: one tool call with an undo. `github_pr`: a pull request, done when merged. */
export type ActionKind = "tool" | "github_pr" | "manual";
export const ACTION_KINDS: ActionKind[] = ["tool", "github_pr", "manual"];

export type Check = {
  days: number[]; // read the subject this many days after the card was done; day 0 is the baseline
  read: string; // what to read about the subject, in words
  tool?: string; // toolkit to read it in; default the routine's
  keep?: string; // when a later day may say keep, in words; anything short of it is wait, revert or iterate
};

export type RoutinePreset = {
  slug: string;
  name: string;
  tool: string; // toolkit the routine acts in
  days: number[];
  hour: number;
  rules: string;
  input?: string; // ledger kind the routine picks from, one of the role's signals
  action?: ActionKind; // default "tool"
  check?: Check; // default: the role's check
};

export type SetupStep = {
  id: string;
  name: string; // shown on the Brief tab
  tool: string; // toolkit the step reads, or "" for the website and the model alone
  ask: string;
};

/**
 * Where the site's pages live: the repository, folders, frontmatter and paths to leave alone.
 * Any looper with a pull request routine learns it once (`setupOf` in lib/spec.ts); it shows on the
 * Brief tab, where a person can correct the repo.
 */
export const REPO_STEP: SetupStep = {
  id: "repo",
  name: "Where the site's pages live",
  tool: "github",
  ask: [
    "Find the repository that builds the website and how its pages are written.",
    "Answer in short lines: repo: owner/name; posts: the folder new articles go in and the file extension;",
    "frontmatter: copied from the newest post, with every field; metadata: where a page's title and meta description live;",
    "url: how a file path maps to a URL; edit: the folders a content change may touch; never: files to leave alone.",
  ].join(" "),
};

export type Signal = {
  kind: string; // ledger kind, like "query"
  tool: string; // toolkit to read, or "geo" for AI answers to the buyer questions
  key: string; // what one row is keyed by, in words
  read: string; // what to read, in words
  columns: Column[]; // the fields of one row, shown as table columns on the Tracking tab
};

/** One field of a signal row. The read asks for these field names, so rows from different days line up. */
export type Column = {
  key: string;
  label: string;
  type: "num" | "pct" | "pos" | "url" | "list" | "text";
};

export type Limits = {
  cooldownDays: number; // one card per subject in this many days
  perWeek: Partial<Record<ActionKind, number>>; // cards per action kind in 7 days
  alwaysAsk: ActionKind[]; // these never run alone, whatever the routine's mode
  writePaths?: string; // regex a github_pr file path must match
  pr?: PrLimits; // the shape a github_pr card must have; one that does not fit becomes a by-hand card
};

/** A pull request a looper may open. Test files count apart from the rest. */
export type PrLimits = {
  maxFiles: number; // files changed, tests not counted
  maxLines: number; // lines added plus removed, tests not counted
  editsOnly?: boolean; // existing files change by find and replace only, never rewritten or deleted
  tests?: string; // regex for test file paths; when set, every pull request adds or changes one
};

/** What one card ships. `skills`: the preset routines that ship it; none means the model writes the routines. */
export type WorkUnit = {
  name: string; // "A blog post"
  detail: string; // "Shipped as a pull request to your site's GitHub repository"
  action: ActionKind;
  tool: string; // toolkit it ships through, or "" by hand
  skills?: string[];
};

/**
 * Tools that do the same job. A role names one as its default; the founder picks the one they run
 * (`swap` in lib/draft-steps.ts), so a support looper works the same on Zendesk, Crisp or Help Scout.
 * Hints, rules and copy for a swappable tool name the job, never the product. GitHub is in no kind:
 * pull requests need it.
 */
export const KINDS: Record<string, { name: string; tools: string[] }> = {
  helpdesk: { name: "help desk", tools: ["zendesk", "intercom", "crisp", "freshdesk", "help_scout", "front", "gorgias", "zoho_desk"] },
  crm: { name: "CRM", tools: ["hubspot", "salesforce", "pipedrive", "attio", "close", "zoho"] },
  email: { name: "email", tools: ["gmail", "outlook"] },
  books: { name: "accounting tool", tools: ["quickbooks", "xero", "freshbooks", "zoho_books"] },
  issues: { name: "issue tracker", tools: ["linear", "jira", "asana"] },
};

/** The kind a toolkit belongs to, or undefined when nothing else does its job. */
export const kindOf = (slug: string) => Object.keys(KINDS).find((k) => KINDS[k].tools.includes(slug));

export const DEFAULT_LIMITS: Limits = { cooldownDays: 7, perWeek: {}, alwaysAsk: [] };

export type Role = {
  id: string;
  name: string;
  live: boolean;
  group: "Distribution" | "Operations" | null;
  avatar: string | null; // public/loopers/<avatar>.webp
  colors: [string, string];
  tools: string[]; // toolkit slugs shown on the org chart node
  example: string; // what the metric line reads like once hired
  metrics: MetricPreset[];
  routines: RoutinePreset[];
  guide?: string; // what the planner should focus on when it writes routines
  subject?: { kind: string; key: string };
  setup?: SetupStep[];
  signals?: Signal[];
  actions?: ActionKind[]; // what planned routines may do; default tool and manual
  check?: Check;
  limits?: Limits;
  work: WorkUnit[];
  // Routines see every page on the site, read from its sitemap, and a new page whose URL words match one is held back.
  sitePages?: boolean;
  // Signal kinds every routine also sees besides its input, to match one item against another (a bank transaction to its invoice).
  evidence?: string[];
};

export const ROLES: Role[] = [
  {
    id: "social",
    name: "Social media manager",
    live: true,
    group: "Distribution",
    avatar: "social",
    colors: ["#FF7AB6", "#FFB36B"],
    tools: ["linkedin", "twitter", "instagram"],
    example: "Impressions 41.2K of 60K",
    work: [
      { name: "A post", detail: "Drafted for LinkedIn or X, published after you approve it", action: "tool", tool: "linkedin" },
      { name: "A reply to a comment", detail: "Drafted under your recent posts, sent after you approve it", action: "tool", tool: "linkedin" },
      { name: "A post in your Buffer queue", detail: "Drafted for any channel connected to Buffer, queued after you approve it", action: "tool", tool: "buffer" },
    ],
    metrics: [
      { name: "LinkedIn followers", source: "linkedin", unit: "", direction: "up", hint: "Followers of the company page that matches the website; if there is none, of the connected profile." },
      { name: "X followers", source: "twitter", unit: "", direction: "up", hint: "Followers of the connected X account." },
      { name: "Instagram reach, last 28 days", source: "instagram", unit: "", direction: "up", hint: "Accounts reached by the connected business account, last 28 full days." },
      { name: "A metric I enter myself", source: "manual", unit: "", direction: "up", hint: "" },
    ],
    subject: { kind: "post", key: "the post URL or id" },
    check: { days: [0, 2, 7], read: "Impressions, reactions, comments and new followers attributed to the post." },
    limits: { cooldownDays: 1, perWeek: { tool: 7 }, alwaysAsk: ["tool"] },
    routines: [],
    guide: [
      "Routines for social. Good ones:",
      "- draft 3 posts a week from the website, recent wins and numbers; the founder approves each one before it goes out",
      "- find the 3 best posts of the last 28 days by impressions and draft a follow-up in the same format",
      "- reply drafts to comments on the last 7 days of posts",
      "- one repurposing routine: a long post into a carousel or a thread",
      "- when Buffer is connected, queue approved posts there instead of posting directly, so they go out in the founder's own time slots",
      "Publishing is always a card the founder approves first.",
    ].join("\n"),
  },
  {
    id: "seo",
    name: "SEO / GEO",
    live: true,
    group: "Distribution",
    avatar: "seo",
    colors: ["#5BE3C4", "#3D8BFF"],
    tools: ["google_search_console", "github"],
    example: "Visits 3,120 of 4,000",
    work: [
      {
        name: "A blog post",
        detail: "Written and shipped as a pull request to your site's GitHub repository",
        action: "github_pr",
        tool: "github",
        skills: ["new-page", "geo-gaps", "refresh"],
      },
      {
        name: "A title and meta description rewrite",
        detail: "For pages on Google's page 2, shipped as a pull request",
        action: "github_pr",
        tool: "github",
        skills: ["striking-distance"],
      },
      { name: "A blog post you publish yourself", detail: "A full draft on the card; you paste it into your CMS", action: "manual", tool: "" },
    ],
    metrics: [
      {
        name: "Search Console clicks, last 28 days",
        source: "google_search_console",
        unit: "",
        direction: "up",
        hint: "Total clicks from Google Search for the site property that matches the website, last 28 full days.",
      },
      {
        name: "Search queries in the top 10, last 28 days",
        source: "google_search_console",
        unit: "",
        direction: "up",
        hint: "Count of queries with an average position of 10 or better for the site property that matches the website, last 28 full days.",
      },
      {
        name: "Mentions in AI answers, of 10 buyer questions",
        source: "geo",
        unit: "",
        direction: "up",
        hint: "Every day the looper asks the 10 buyer questions it wrote at hire, with web search, in your model and any answer engine you add (ChatGPT, Perplexity, Google AI), and counts the questions where an answer names your site.",
      },
    ],
    // Pages ship as pull requests to the site's repository: the founder reads the Vercel preview and merges.
    subject: { kind: "page", key: "the file path in the repository, like content/blog/pricing.mdx" },
    sitePages: true,
    setup: [REPO_STEP],
    signals: [
      {
        kind: "query",
        tool: "google_search_console",
        key: "the search query, lower case",
        read: "Per query for the site property that matches the website, last 28 full days: clicks, impressions, ctr, position, and the page URL with the most clicks for it. The top 100 queries by impressions.",
        columns: [
          { key: "position", label: "Position", type: "pos" },
          { key: "impressions", label: "Impressions", type: "num" },
          { key: "clicks", label: "Clicks", type: "num" },
          { key: "ctr", label: "CTR", type: "pct" },
          { key: "top_page", label: "Page", type: "url" },
        ],
      },
      {
        kind: "ai_answer",
        tool: "geo",
        key: "the buyer question",
        read: "Each buyer question asked in every answer engine with web search: which engines name the site, and which URLs they cite.",
        columns: [
          { key: "named_by", label: "Named by", type: "list" },
          { key: "cited", label: "Cited instead", type: "list" },
        ],
      },
    ],
    actions: ["github_pr", "manual"],
    check: {
      days: [0, 14, 28],
      tool: "google_search_console",
      read: "For the page URL: Search Console clicks, impressions, ctr and average position over the last 14 full days, and the 3 queries with the most clicks.",
    },
    limits: {
      cooldownDays: 28,
      perWeek: { github_pr: 4 },
      alwaysAsk: [],
      writePaths: "\\.(mdx?|markdown|html|astro|tsx|jsx|txt|json|ya?ml)$",
    },
    routines: [
      {
        slug: "striking-distance",
        name: "Rewrite titles on page 2 results",
        tool: "github",
        days: [0],
        hour: 9,
        input: "query",
        action: "github_pr",
        rules: [
          "pick: queries at position 5 to 15 with 100+ impressions and ctr under 3%, last 28 days",
          "max: 3 pages, one card per page",
          "change: the title (under 60 characters, the query in the first 40) and the meta description (under 155 characters, one number)",
          "keep: the URL, headings and body as they are",
        ].join("\n"),
      },
      {
        slug: "geo-gaps",
        name: "Answer buyer questions AI skips us on",
        tool: "github",
        days: [1],
        hour: 10,
        input: "ai_answer",
        action: "github_pr",
        rules: [
          "pick: buyer questions no engine names us for, most cited competitor URLs first",
          "max: 2 cards",
          "page exists: rewrite its first 2 sentences to answer the question, add a comparison table and 3 FAQ entries with FAQPage schema",
          "no page: write one, 800 to 1,400 words, the answer in the first 2 sentences, one table, links from 2 existing pages",
          "cited list or forum we are missing from: a by-hand card with the URL and the draft pitch or reply",
        ].join("\n"),
      },
      {
        slug: "new-page",
        name: "Write one page for an unanswered query",
        tool: "github",
        days: [2],
        hour: 10,
        input: "query",
        action: "github_pr",
        rules: [
          "pick: the query with the most impressions whose top page is the homepage or ranks over 20, and that no page in the site's page list already covers",
          "max: 1 card",
          "write: 1,000 to 1,600 words, the answer in the first 2 sentences, one table, 3 FAQ entries, links from 2 existing pages",
          "follow: the repo notes for folder, frontmatter and file name",
        ].join("\n"),
      },
      {
        slug: "refresh",
        name: "Refresh the page that lost most clicks",
        tool: "github",
        days: [3],
        hour: 10,
        input: "query",
        action: "github_pr",
        rules: [
          "pick: the page whose queries lost the most clicks, with 50+ impressions",
          "max: 1 card",
          "change: numbers, dates and the year, answers to the queries it gets impressions for but does not cover",
          "keep: the URL and the title unless the title is over 60 characters",
        ].join("\n"),
      },
    ],
    guide: [
      "Routines for SEO and GEO (being named in AI answers).",
      "Pages ship as pull requests to the website's repository. Follow the repo notes for folders and frontmatter.",
      "Outreach to list authors and replies on forums are by-hand cards the founder sends.",
    ].join("\n"),
  },
  {
    id: "ads",
    name: "Paid ads manager",
    live: true,
    group: "Distribution",
    avatar: "ads",
    colors: ["#FFD24A", "#FF6A2B"],
    tools: ["googleads", "google_analytics", "stripe"],
    example: "ROAS 3.1x, target 3.5x",
    work: [
      { name: "A campaign change", detail: "Bids, budgets, keywords or negatives, applied in Google Ads after you approve", action: "tool", tool: "googleads" },
    ],
    metrics: [
      {
        name: "Google Ads ROAS, last 7 days",
        source: "googleads",
        unit: "x",
        direction: "up",
        hint: "Total conversion value divided by total cost across enabled campaigns, last 7 full days.",
      },
      {
        name: "Google Ads conversions, last 7 days",
        source: "googleads",
        unit: "",
        direction: "up",
        hint: "Sum of conversions across enabled campaigns, last 7 full days.",
      },
      {
        name: "Google Ads cost per conversion, last 7 days",
        source: "googleads",
        unit: "€",
        direction: "down",
        hint: "Total cost divided by total conversions across enabled campaigns, last 7 full days.",
      },
    ],
    subject: { kind: "campaign", key: "the campaign id" },
    check: {
      days: [0, 3, 7],
      read: "For the campaign: cost, conversions, conversion value and ROAS since the card was done, and the same for the same number of days before it.",
    },
    limits: { cooldownDays: 3, perWeek: {}, alwaysAsk: [] },
    routines: [
      {
        slug: "pull-spend",
        name: "Pull spend by campaign",
        tool: "googleads",
        days: [0, 1, 2, 3, 4],
        hour: 8,
        rules: [
          "read: cost, conversions, conversion value by campaign, last 7 days",
          "flag: campaigns whose ROAS dropped more than 20% week over week",
          "cards: one card per flagged campaign, no changes made",
        ].join("\n"),
      },
      {
        slug: "pause-keywords",
        name: "Pause losing keywords",
        tool: "googleads",
        days: [0, 2, 4],
        hour: 10,
        rules: [
          "pick: keywords with ROAS under 1x and spend over €20, last 14 days",
          "skip: brand keywords",
          "max: 10 keywords per card",
          "action: pause, never delete",
        ].join("\n"),
      },
      {
        slug: "negatives",
        name: "Search terms to negatives",
        tool: "googleads",
        days: [1, 3],
        hour: 14,
        rules: [
          "pick: search terms with 0 conversions and over 30 clicks, last 30 days",
          "match: phrase",
          "max: 25 negatives per card",
        ].join("\n"),
      },
      {
        slug: "ad-variants",
        name: "Draft 3 ad variants",
        tool: "googleads",
        days: [1, 3],
        hour: 12,
        rules: [
          "pick: the ad group with the most spend and CTR under 3%",
          "write: 3 responsive search ad headlines sets, a number in each first headline",
          "action: create as paused, founder enables",
        ].join("\n"),
      },
    ],
  },
  {
    id: "outreach",
    name: "B2B sales outreach",
    live: true,
    group: "Distribution",
    avatar: "sales",
    colors: ["#8F6BFF", "#3DD6FF"],
    tools: ["hubspot", "gmail", "apollo"],
    example: "Leads 38 of 50",
    work: [
      { name: "An email to one person", detail: "A first email or follow-up, sent from your inbox after you approve it", action: "tool", tool: "gmail" },
    ],
    metrics: [
      { name: "Meetings booked, last 7 days", source: "hubspot", unit: "", direction: "up", hint: "Meetings logged in the CRM in the last 7 full days." },
      { name: "Deals created, last 30 days", source: "hubspot", unit: "", direction: "up", hint: "Deals or opportunities created in the CRM in the last 30 full days, any pipeline." },
      {
        name: "Replies to outreach, last 7 days",
        source: "gmail",
        unit: "",
        direction: "up",
        hint: "Threads the connected inbox started in the last 30 days to an external address that got a reply from that address in the last 7 full days.",
      },
      { name: "A metric I enter myself", source: "manual", unit: "", direction: "up", hint: "" },
    ],
    subject: { kind: "person", key: "the person's email address" },
    check: { days: [4, 10], read: "Whether the person replied, and the CRM stage of their contact." },
    limits: { cooldownDays: 4, perWeek: { tool: 50 }, alwaysAsk: ["tool"] },
    routines: [],
    guide: [
      "Routines for B2B outbound. Good ones:",
      "- build a list of 25 accounts a week that match the buyers on the website, with one named person each (Apollo or the CRM)",
      "- draft a 3-line first email per person with one specific reason to talk; the founder approves every send",
      "- draft follow-ups for threads with no reply after 4 days, at most 2 follow-ups per person",
      "- move contacts who replied to the next CRM stage and draft the reply",
      "Every email to a prospect is a draft card the founder approves.",
    ].join("\n"),
  },
  {
    id: "support",
    name: "Customer support",
    live: true,
    group: "Operations",
    avatar: "support",
    colors: ["#8BE38F", "#E8D84A"],
    tools: ["zendesk", "intercom", "gmail"],
    example: "Resolution 9.4 h, target 6",
    work: [
      { name: "A reply to a ticket", detail: "Drafted from your help center and past answers, sent from your help desk after you approve it", action: "tool", tool: "zendesk" },
      { name: "A help center article", detail: "Written for the topic customers ask about most; you publish it", action: "manual", tool: "" },
    ],
    metrics: [
      { name: "First reply time, median, last 7 days", source: "zendesk", unit: "h", direction: "down", hint: "Median hours from a ticket or conversation starting to the first reply from the team, ones started in the last 7 full days." },
      { name: "Open tickets", source: "zendesk", unit: "", direction: "down", hint: "Tickets or conversations waiting on the team right now: new, open or pending, not snoozed or closed." },
      { name: "A metric I enter myself", source: "manual", unit: "", direction: "up", hint: "" },
    ],
    subject: { kind: "ticket", key: "the ticket or conversation id" },
    limits: { cooldownDays: 1, perWeek: {}, alwaysAsk: [] },
    routines: [],
    guide: [
      "Routines for support. Good ones:",
      "- every weekday morning, draft replies to tickets waiting over 4 hours, using the help center and past answers",
      "- group the last 7 days of tickets by topic and draft one help center article for the biggest group",
      "- tag and close tickets with no customer reply in 7 days, after a final check-in draft",
      "- send the founder the 3 bugs customers reported most, with ticket counts",
      "Replies to customers are drafts the founder approves until a routine earns running alone.",
    ].join("\n"),
  },
  {
    id: "bugs",
    name: "Bug fixing",
    live: true,
    group: "Operations",
    avatar: "bugs",
    colors: ["#FF5A5A", "#8F4BFF"],
    tools: ["sentry", "github", "linear"],
    example: "Users hitting errors 140, target 40",
    work: [
      {
        name: "A fix for one error",
        detail: "A pull request with the fix and a regression test, for the error most users hit in Sentry",
        action: "github_pr",
        tool: "github",
        skills: ["fix-errors", "ignore-noise"],
      },
      { name: "A fix plan for one issue", detail: "The cause, the files involved and the change, for you or your developer", action: "manual", tool: "" },
      { name: "A triage pass on one issue", detail: "Duplicates grouped, linked and labeled in Sentry, GitHub or your issue tracker", action: "tool", tool: "sentry" },
    ],
    // Users hitting errors, not open issues: resolving, ignoring or merging issues does not move it, only fixing the code people run does.
    metrics: [
      {
        name: "Users hitting unhandled errors, last 7 days",
        source: "sentry",
        unit: "",
        direction: "down",
        hint: "Unique users with at least one unhandled error event in the last 7 full days, across the organisation's projects: count_unique(user) on events with error.unhandled:true, statsPeriod 7d. Count every issue whatever its status; resolved and ignored issues count too.",
      },
      { name: "GitHub open issues labeled bug", source: "github", unit: "", direction: "down", hint: "Open issues with a label containing 'bug' in the repository that matches the website, or the most recently pushed repository." },
      { name: "Open bugs in your issue tracker", source: "linear", unit: "", direction: "down", hint: "Issues labeled or typed bug that are not done, completed or canceled." },
      { name: "A metric I enter myself", source: "manual", unit: "", direction: "up", hint: "" },
    ],
    subject: { kind: "error", key: "the Sentry issue short id, like ACME-3F" },
    setup: [
      {
        id: "repo",
        name: "Where the code lives",
        tool: "github",
        ask: [
          "Find the repository that builds the product at the website and how it is tested.",
          "Answer in short lines: repo: owner/name; stack: language and framework; tests: the test command, the folder tests live in and the file name pattern, or none;",
          "src: the folders application code lives in; never: files to leave alone (migrations, generated code, vendored code).",
        ].join(" "),
      },
    ],
    signals: [
      {
        kind: "error",
        tool: "sentry",
        key: "the Sentry issue short id, like ACME-3F",
        read: [
          "Unresolved Sentry issues seen in the last 7 days, the 50 with the most users.",
          "Per issue: users and events in the last 7 days, level, unhandled (true or false), the culprit (file and function that throws), last seen, the latest release it was seen in, and the issue's permalink.",
        ].join(" "),
        columns: [
          { key: "users", label: "Users, 7d", type: "num" },
          { key: "events", label: "Events, 7d", type: "num" },
          { key: "culprit", label: "Where", type: "text" },
          { key: "level", label: "Level", type: "text" },
          { key: "url", label: "Issue", type: "url" },
        ],
      },
    ],
    actions: ["github_pr", "tool", "manual"],
    // A fix counts when production shows it: no events after the release that carries it, on code people still run.
    check: {
      days: [0, 7, 14],
      tool: "sentry",
      read: [
        "For the Sentry issue: its status and whether it regressed; events and users in the 7 days before the merge;",
        "the first release that contains the merge commit (from the issue's releases or the project's release list) and when it was first seen;",
        "events and users since that release, and the sessions or events the release has in total.",
      ].join(" "),
      keep: [
        "keep only when the first release with the fix is live, the issue has 0 events since that release, and the code path had traffic",
        "(events in the 7 days before the merge, and 50+ sessions or events on the release).",
        "A regressed or reopened issue, or events on the release with the fix, is revert.",
        "No release with the fix yet, or too little traffic, is wait, and iterate on the last day.",
      ].join(" "),
    },
    limits: {
      cooldownDays: 14,
      perWeek: { github_pr: 2, tool: 10 },
      alwaysAsk: ["github_pr"],
      // Application code and tests; never migrations or generated code.
      writePaths: "^(?!.*(^|/)(migrations?|db/migrate|generated|__generated__|vendor)/).*\\.(ts|tsx|js|jsx|mjs|cjs|py|rb|go|rs|java|kt|swift|php|vue|svelte)$",
      pr: {
        maxFiles: 2,
        maxLines: 60,
        editsOnly: true,
        tests: "(^|/)(__tests__|tests?|spec)/|\\.(test|spec)\\.\\w+$|_test\\.(go|py)$|(^|/)test_\\w+\\.py$",
      },
    },
    routines: [
      {
        slug: "fix-errors",
        name: "Fix the error most users hit",
        tool: "github",
        days: [1, 3],
        hour: 10,
        input: "error",
        action: "github_pr",
        rules: [
          "pick: unhandled errors, level error or fatal, 3+ users in 7 days, seen in the last 7 days",
          "skip: frames only in third-party scripts or browser extensions, network aborts and timeouts, bots and crawlers, ResizeObserver loop, ChunkLoadError",
          "rank: users affected, then errors on signup, login, payment or the product's main action",
          "max: 1 card",
          "read: the latest event's stack trace in Sentry, then the file and lines that throw in the repository",
          "fix: the smallest change that removes the cause; never an empty catch or optional chaining over a value that must exist",
          "test: a regression test that fails before the fix and passes after, in the repo's test folder and pattern",
          "too big, no test setup or cause unclear: a by-hand card with the cause, the files and the change",
          "body: Sentry link, the frame that throws, the cause in one sentence, what changed, how the test reproduces it",
        ].join("\n"),
      },
      {
        slug: "ignore-noise",
        name: "Ignore noise errors in Sentry",
        tool: "sentry",
        days: [0],
        hour: 9,
        input: "error",
        action: "tool",
        check: { days: [], read: "" },
        rules: [
          "pick: issues whose frames are only in third-party scripts or browser extensions, network aborts and timeouts, bots and crawlers",
          "max: 5 cards, one per issue",
          "change: ignore the issue in Sentry, with the reason in the detail",
          "never: resolve an issue, or ignore one with a frame in the product's own code",
        ].join("\n"),
      },
    ],
    guide: [
      "Routines for bug fixing. Good ones:",
      "- twice a week, fix the unhandled error most users hit: a pull request with the fix and a regression test, from the Sentry stack trace",
      "- weekly, ignore noise in Sentry: errors only in third-party scripts, extensions, network aborts and bots",
      "- pick the 3 bugs with the most users affected and write a fix plan with the files involved",
      "- weekly: list bugs open over 30 days with a one-line next step each",
      "Never resolve, ignore or merge issues to lower a count: the metric counts users hitting errors, whatever the issue's status.",
      "Code changes and merges are always cards the founder approves.",
    ].join("\n"),
  },
  {
    id: "vat_nl",
    name: "VAT reporting, NL",
    live: true,
    group: "Operations",
    avatar: "accounting",
    colors: ["#5AB471", "#74DDC8"],
    tools: ["googledrive", "gmail", "stripe"],
    example: "Unbooked 64, target 0",
    work: [
      {
        name: "One bank transaction",
        detail: "Matched to its invoice or Stripe payout, given a box of the Dutch VAT return and filed in Google Drive after you approve it",
        action: "tool",
        tool: "googledrive",
        skills: ["book-transactions", "chase-invoices", "ask-statements", "draft-return"],
      },
      { name: "The quarterly VAT return", detail: "Totals per box, 1a to 5b, from the booked transactions, for you or your accountant to file", action: "manual", tool: "", skills: ["draft-return"] },
    ],
    // Read from Drive, where the statements and the booking files both live: what is left to book this quarter.
    metrics: [
      {
        name: "Unbooked bank transactions, this quarter",
        source: "googledrive",
        unit: "",
        direction: "down",
        hint: [
          "In the Google Drive folder with the bank statement exports: transactions dated in the current calendar quarter,",
          "minus those with a booking file in the 'VAT bookings/<year>-Q<n>' subfolder (file names start with the transaction's date and amount).",
        ].join(" "),
      },
      { name: "A metric I enter myself", source: "manual", unit: "", direction: "down", hint: "" },
    ],
    subject: { kind: "transaction", key: "date, amount and counterparty, like 2026-10-03 -49.00 Google Ireland" },
    setup: [
      {
        id: "folder",
        name: "Where the bank statements are",
        tool: "googledrive",
        ask: [
          "Find the Google Drive folder with the bank statement exports.",
          "Answer in short lines: folder: name and id; bank: the bank and the last 4 digits of the IBAN; format: CSV, MT940, CAMT.053 or PDF,",
          "and for CSV the columns for date, amount, counterparty and description; covers: the first and last transaction date in the files;",
          "bookings: the id of the 'VAT bookings' subfolder, or none yet.",
        ].join(" "),
      },
      {
        id: "business",
        name: "What is sold, to whom, where",
        tool: "",
        ask: [
          "From the website: answer in short lines: sells: services, software or goods; customers: businesses, consumers or both;",
          "countries: where customers are (Netherlands, the EU, outside the EU); vat id: the NL VAT number if the site prints it, else unknown;",
          "period: quarterly; oss: yes if it sells to consumers in other EU countries, else no.",
        ].join(" "),
      },
    ],
    signals: [
      {
        kind: "transaction",
        tool: "googledrive",
        key: "date, amount and counterparty, like 2026-10-03 -49.00 Google Ireland",
        read: [
          "The bank statement exports in the folder from setup: transactions dated in the current calendar quarter and the one before, unbooked first, at most 100.",
          "Per transaction: date, amount (negative when money left), counterparty, description,",
          "and booked: yes when the 'VAT bookings/<year>-Q<n>' subfolder has a file whose name starts with its date and amount, else no.",
        ].join(" "),
        columns: [
          { key: "date", label: "Date", type: "text" },
          { key: "amount", label: "Amount", type: "num" },
          { key: "counterparty", label: "Counterparty", type: "text" },
          { key: "description", label: "Description", type: "text" },
          { key: "booked", label: "Booked", type: "text" },
        ],
      },
      {
        kind: "invoice",
        tool: "gmail",
        key: "seller and invoice number, like Google Ireland 5512093",
        read: [
          "Emails from the last 120 days with an invoice or receipt, attached or in the body, received or sent.",
          "Per invoice: date, seller, total, VAT amount and rate as printed (0 and 'reverse charge' when it says so), currency, the seller's VAT number if printed, and a link to the email.",
        ].join(" "),
        columns: [
          { key: "date", label: "Date", type: "text" },
          { key: "seller", label: "Seller", type: "text" },
          { key: "total", label: "Total", type: "num" },
          { key: "vat", label: "VAT", type: "num" },
          { key: "rate", label: "Rate", type: "text" },
          { key: "vat_id", label: "VAT number", type: "text" },
          { key: "url", label: "Email", type: "url" },
        ],
      },
      {
        kind: "payout",
        tool: "stripe",
        key: "the Stripe payout id, like po_1Q2w3E",
        read: [
          "Payouts from the last 120 days. Per payout: arrival date, amount as it lands in the bank, the gross of the charges in it, refunds and Stripe fees,",
          "and the gross split by customer: Netherlands, EU businesses with a VAT ID (from the customer's tax IDs), other EU customers, outside the EU (from the billing address or card country).",
        ].join(" "),
        columns: [
          { key: "arrival", label: "Arrival", type: "text" },
          { key: "amount", label: "Amount", type: "num" },
          { key: "gross", label: "Gross", type: "num" },
          { key: "fees", label: "Fees", type: "num" },
          { key: "nl", label: "NL", type: "num" },
          { key: "eu_b2b", label: "EU, VAT ID", type: "num" },
          { key: "eu_b2c", label: "EU, other", type: "num" },
          { key: "non_eu", label: "Outside EU", type: "num" },
        ],
      },
    ],
    evidence: ["invoice", "payout"],
    actions: ["tool", "manual"],
    // A transaction is booked once: the lock outlasts the quarter.
    limits: { cooldownDays: 120, perWeek: {}, alwaysAsk: ["tool"] },
    routines: [
      {
        slug: "book-transactions",
        name: "Book bank transactions for VAT",
        tool: "googledrive",
        days: [0, 1, 2, 3, 4],
        hour: 8,
        input: "transaction",
        action: "tool",
        check: { days: [], read: "" },
        rules: [
          "pick: transactions with booked no, oldest first",
          "match: money in to the Stripe payout with the same amount, arriving within 3 days; money out to the invoice from the counterparty with the same total, dated up to 30 days before",
          "box: 1a 21% and 1b 9% on Dutch sales; 1e services to businesses outside the EU; 3b services to EU businesses with a VAT ID, also on the ICP return;",
          "  4a services bought from outside the EU and 4b from EU sellers that charge no VAT (Google Ireland, Meta Ireland): 21% due, deducted again in 5b;",
          "  5b the Dutch VAT printed on an invoice you paid; a Stripe payout splits its gross over 1a, 3b and 1e, and EU consumer sales go in 1a while they stay under 10,000 euro a year, else OSS",
          "no VAT: transfers between own accounts, payments to or from the Belastingdienst, salaries, loans, bank fees; booked with the reason",
          "max: 5 cards, one per transaction",
          "change: one text file in 'VAT bookings/<year>-Q<n>' (create the folders when missing), named '<date> <amount> <counterparty>.txt',",
          "  with the box and amount per line, the VAT and rate, and the invoice or payout it matched with its link",
          "no match: leave it for chase-invoices; never guess a VAT amount the invoice does not print, never book a transaction twice",
          "detail: the transaction, what it matched, the box and the VAT, in 3 lines",
        ].join("\n"),
      },
      {
        slug: "chase-invoices",
        name: "List transactions with no invoice",
        tool: "gmail",
        days: [3],
        hour: 9,
        input: "transaction",
        action: "manual",
        check: { days: [], read: "" },
        rules: [
          "pick: money out with booked no, 7+ days old, no invoice in the ledger or Gmail from the counterparty with that total",
          "skip: the no VAT kinds from book-transactions",
          "rank: amount, largest first",
          "max: 5 cards, one per transaction",
          "detail: the transaction, the searches you ran in Gmail, and where the seller usually puts invoices (account billing page, portal, email address)",
        ].join("\n"),
      },
      {
        slug: "ask-statements",
        name: "Ask for the latest bank statement",
        tool: "googledrive",
        days: [0],
        hour: 9,
        input: "transaction",
        action: "manual",
        check: { days: [], read: "" },
        rules: [
          "pick: when the newest transaction in the ledger is more than 10 days old, or the ledger is empty",
          "max: 1 card",
          "subject: statement <year>-<month> of the month that is missing",
          "detail: export the statement from the bank in setup, the dates it should cover, the format the folder already uses, and the folder to put it in",
        ].join("\n"),
      },
      {
        slug: "draft-return",
        name: "Draft the quarterly VAT return",
        tool: "googledrive",
        days: [0],
        hour: 10,
        input: "transaction",
        action: "manual",
        check: { days: [], read: "" },
        rules: [
          "when: only in the first 4 weeks after a quarter ends (January, April, July, October); otherwise no card",
          "read: every booking file in 'VAT bookings/<year>-Q<n>' of the quarter that ended",
          "max: 1 card",
          "subject: return <year>-Q<n>",
          "detail: the amount and VAT per box (1a, 1b, 1e, 2a, 3b, 4a, 4b, 5b), the total to pay or reclaim, the ICP lines per EU customer VAT ID,",
          "  the transactions still unbooked with their amounts, and the due date: the last day of the month after the quarter",
          "never: file the return; you or your accountant files it in Mijn Belastingdienst Zakelijk",
        ].join("\n"),
      },
    ],
    guide: [
      "Routines for Dutch VAT reporting. Good ones:",
      "- every weekday, book 5 bank transactions: match each to its invoice in Gmail or its Stripe payout, pick the box of the VAT return, file the booking in Drive",
      "- weekly, list the transactions with no invoice, largest first, with where to download each one",
      "- weekly, ask for the bank statement when the newest transaction is over 10 days old",
      "- after each quarter, draft the return: amount and VAT per box, ICP lines and the due date",
      "Gmail and Stripe are read only. Booking files are cards the founder approves; the return is filed by a person.",
    ].join("\n"),
  },
  {
    id: "accounting",
    name: "Accounting",
    // Off the org chart since the VAT looper took its place; kept so loopers hired before still read their spec.
    live: false,
    group: null,
    avatar: "accounting",
    colors: ["#5AB471", "#74DDC8"],
    tools: ["quickbooks", "xero", "freshbooks", "stripe"],
    example: "Unreconciled 96, target 20",
    work: [
      { name: "A reminder for one overdue invoice", detail: "Drafted per customer, sent from your inbox after you approve it", action: "tool", tool: "gmail" },
      { name: "A reconciliation note", detail: "Payouts matched to deposits, with what does not match", action: "manual", tool: "" },
    ],
    metrics: [
      { name: "Overdue invoices", source: "quickbooks", unit: "", direction: "down", hint: "Customer invoices that are sent or authorised, have an open balance and are past their due date." },
      { name: "Stripe failed payments, last 30 days", source: "stripe", unit: "", direction: "down", hint: "Charges with status failed in the last 30 full days." },
      { name: "A metric I enter myself", source: "manual", unit: "", direction: "up", hint: "" },
    ],
    subject: { kind: "invoice", key: "the invoice number" },
    check: { days: [7], read: "Whether the invoice is paid, and its open balance." },
    limits: { cooldownDays: 7, perWeek: {}, alwaysAsk: ["tool"] },
    routines: [],
    guide: [
      "Routines for accounting. Good ones:",
      "- weekly: draft polite reminders for invoices 7, 14 and 30 days overdue, one card per customer",
      "- match Stripe payouts to bank deposits and list what does not match, with amounts",
      "- monthly: draft the close checklist with the numbers that need the founder's eye",
      "- flag failed Stripe payments and draft the dunning email",
      "Anything sent to a customer or that changes the books is a card the founder approves.",
    ].join("\n"),
  },
  {
    id: "custom",
    name: "Your own looper",
    live: true,
    group: null,
    avatar: null,
    colors: ["#8A8A92", "#5A5A62"],
    tools: [],
    example: "Any metric you track",
    work: [],
    // Pages and content can ship as pull requests; the repo step joins setup once a routine does.
    actions: ["tool", "github_pr", "manual"],
    metrics: [
      { name: "GA4 sessions, last 7 days", source: "google_analytics", unit: "", direction: "up", hint: "Sessions, last 7 full days, all traffic." },
      { name: "HubSpot new contacts, last 7 days", source: "hubspot", unit: "", direction: "up", hint: "Contacts created in the last 7 days." },
      { name: "Sentry unresolved issues", source: "sentry", unit: "", direction: "down", hint: "Count of unresolved issues across projects." },
      { name: "A metric I enter myself", source: "manual", unit: "", direction: "up", hint: "" },
    ],
    routines: [],
  },
];

export const role = (id: string) => ROLES.find((r) => r.id === id);
