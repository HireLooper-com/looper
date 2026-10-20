# Looper

Hire AI **loopers**: autonomous operators that each own exactly one business metric and work it every day. Hosted at [hirelooper.com](https://hirelooper.com), or deploy your own on Vercel with Supabase ([one click](#on-vercel-with-supabase)).

Each looper has:

- **One metric** with a target and direction, logged over time, always in view
- **Skills** on a schedule (hourly, daily, weekly or on demand) that use your apps: Gmail, Search Console, Buffer, GitHub, Linear and thousands more
- **Tasks:** a kanban board, a calendar of runs, and its own **computer** (a private Linux machine with Chrome) that you can watch live and replay step by step
- **Space:** a database (one row per unit of work) and a canvas for references, images and boards
- **Results:** a weekly retro where it scores its own effectiveness and decides what to try next

**Chief** hires and coordinates the team and writes a daily brief. Loopers never send, publish, pay or delete without your approval: questions and approvals land in **Needs you**.

**Templates** ready to hire: SEO & GEO Grower, Customer Support, Weekly Build-in-Public Update. Or describe a goal and Chief drafts a looper for it.

**Teams:** shared workspaces with invite links. Everyone works with the same loopers, chats, boards and approvals.

## Run it yourself

```bash
git clone https://github.com/HireLooper-com/looper && cd looper
npm install
npm run dev        # http://localhost:3000
```

With no configuration it stores data as JSON files in `./data`, and you sign in with your Grok plan (or ChatGPT when running locally). Add an OpenAI, xAI or Anthropic API key under Settings instead if you prefer. See [`.env.example`](.env.example) for everything optional:

| Want | Set |
| --- | --- |
| Postgres instead of files (Supabase, Neon, …) | `DATABASE_URL` (or `POSTGRES_URL`, as the Vercel integrations set it) |
| Sign in with Google, GitHub or a 6-digit email code | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (Supabase Auth) |
| One-click app connections | `COMPOSIO_API_KEY` |
| Each looper's computer | Vercel Sandbox: automatic on Vercel, or `VERCEL_TOKEN`, `VERCEL_TEAM_ID`, `VERCEL_PROJECT_ID` |
| Schedules when hosted | a cron hitting `GET /api/tick` with `Authorization: Bearer $CRON_SECRET` |

Billing (Stripe) and included Claude credits are for the hosted service only; they stay off unless their keys are set.

### On Vercel with Supabase

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FHireLooper-com%2Flooper&project-name=looper&repository-name=looper&stores=%5B%7B%22type%22%3A%22integration%22%2C%22protocol%22%3A%22storage%22%2C%22productSlug%22%3A%22supabase%22%2C%22integrationSlug%22%3A%22supabase%22%7D%5D)

The button copies this repository to your GitHub, creates a Vercel project and a Supabase database, and deploys. Or by hand:

1. In Vercel, **Add New → Project** and import this repository.
2. Connect a Supabase project: from Vercel's **Storage** tab (Supabase), or from Supabase's **Integrations → Vercel**. Either sets `POSTGRES_URL` and the `NEXT_PUBLIC_SUPABASE_*` keys for you. The Data API isn't needed; leave it off.
3. Redeploy. The app creates its table on first use and keeps its session secret in the database, so nothing else is required. Add `CRON_SECRET` so only Vercel Cron can run the scheduler, and the optional keys above as you need them.

## How it works

- **Storage:** one key-value table (Postgres) or files. Users and workspaces live in `src/lib/workspace.ts`. A workspace's data is keyed by its id; your personal workspace has your user id.
- **Models:** `src/lib/llm.ts` resolves the workspace's model: a Grok or ChatGPT plan, an API key, or hosted credits (metered in `src/lib/billing.ts`).
- **Runs:** `src/lib/agent.ts` runs skills, retros, Chief and the scheduler. App tools stay out of the model's context until the looper finds them with `find_tools`, so thousands of tools cost a few definitions per step.
- **Computer:** `src/lib/computer.ts` gives each looper a persistent Vercel Sandbox with Chrome ([agent-browser](https://github.com/vercel-labs/agent-browser)). It's stopped after every turn, logs every step with a screenshot, and stops at bot checks instead of fighting them.
- **Sign-in:** `src/lib/supabase-auth.ts` (Google, GitHub, email codes) or `src/lib/oauth/*` (Grok, ChatGPT), then an HMAC-signed session cookie (`src/lib/session.ts`).

## License

[Sustainable Use License](LICENSE.md): free to use and modify for personal use and for your own business's internal use. You may not sell it or host it as a service for others. For anything else, get in touch.
