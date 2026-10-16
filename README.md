# Chieflooper

Hire AI **loopers**. Each one owns exactly one business metric and has:

- **1 metric**: a number with a target and direction, logged over time
- **1 kanban board**: the looper adds cards and moves them as it works
- **1 database**: a Notion-style table where one row is one unit of the looper's work (a bank transaction for a VAT looper, a blog post for an SEO looper). The looper adds and updates rows on every run; you edit them inline
- **1 skill calendar**: scheduled skills (hourly, daily, weekly or on demand) and every past run
- **1 retro board**: the looper reviews its own runs and metric movement, rates its effectiveness from 1 to 5, and turns "try next" items into new cards

**Chief** is the main bot. Ask it to hire, brief, pause, retire or run loopers, or to report on the team.

## Sign in with your plan

The app starts on a login page. Each person signs in with a subscription they already pay for and gets a private workspace. Loopers run on that plan.

| | How | Where it works |
| --- | --- | --- |
| **Continue with ChatGPT** | OpenAI's [Sign in with ChatGPT](https://developers.openai.com/siwc/token-sharing-open-source) (Plus or Pro): PKCE, a client registered per user, plan usage through the Responses API | **Local only.** OpenAI allows plan usage for open-source and locally run apps; hosted apps need to [join OpenAI's waitlist](https://openai.com/form/sign-in-with-chatgpt-interest/). The callback must be `http://127.0.0.1:<port>/auth/callback`. |
| **Continue with Grok** | Device code at auth.x.ai using the Grok CLI's public client (SuperGrok / X Premium) | Local and hosted. **Unofficial**: xAI has no public OAuth client for other apps, so this may change. Some SuperGrok tiers get 403 on `api.x.ai`; Settings can switch to the Grok CLI endpoint (also unofficial) or an xAI API key. |

OpenAI and xAI API keys still work as a fallback, under Settings.

Restrict who can sign in with `ALLOWED_EMAILS="you@company.com,@company.com"`.

## Run

```bash
npm install
npm run dev            # open http://localhost:3000 and sign in
npm run seed           # optional: three demo loopers (paused) in the last signed-in workspace
```

## Integrations: thousands of apps

Loopers use tools over the Model Context Protocol (MCP). Each hub is one MCP URL that exposes many apps:

| Hub | What you paste |
| --- | --- |
| Composio | MCP server URL from the Composio dashboard (+ `x-api-key` header if needed) |
| Zapier MCP | Server URL (the secret is in the URL) |
| Pipedream | Remote MCP URL + auth header |
| Anything else | Any Streamable HTTP MCP endpoint |

Integration tools stay out of the model's context until the looper asks for them: it calls `find_tools` with the app and action, and the matching tools are enabled for its next step. That keeps a catalog of thousands of tools cheap per run, and it works the same on ChatGPT and Grok.

## Scheduling

- **Local:** `src/instrumentation.ts` checks every user's due skills each minute. Turn it off with `GROKLOOPER_TICKER=off`.
- **Hosted:** call `GET /api/tick` from a cron job. Set `CRON_SECRET` and send `Authorization: Bearer $CRON_SECRET`.

## Storage and sessions

- Everything lives in one key-value table, `chieflooper_kv`: the user list, one workspace per user (loopers, boards, runs, retros, OAuth tokens, keys) and pending sign-ins. It is created on first use.
- **Postgres** when `DATABASE_URL` is set: Neon, provisioned through the Vercel Marketplace. All server instances share it, and writes lock the row, so concurrent runs and token refreshes don't collide. Running locally with `.env.local` from `vercel env pull` uses the same database.
- **Local files** under `data/kv/` when `DATABASE_URL` isn't set (gitignored, mode 600).
- Sessions are an HMAC-signed cookie. Set `SESSION_SECRET` when hosting; locally one is generated in `data/.session-secret`.
- ChatGPT plan tokens are only ever used by a local server. A hosted instance refuses to run a ChatGPT-plan looper, even if it finds the tokens in the shared database.

## Code map

- `src/lib/oauth/chatgpt.ts`, `src/lib/oauth/grok.ts`: plan sign-in, token refresh, sign-out
- `src/lib/kv.ts`, `src/lib/db.ts`: storage (Postgres or files), users and workspaces
- `src/lib/session.ts`, `src/proxy.ts`: sessions and the login gate
- `src/lib/agent.ts`: looper runs, retros, the scheduler tick, and Chief with its management tools
- `src/lib/llm.ts`: the model for each user's plan or key
- `src/lib/integrations.ts`: MCP connections
- `src/lib/schedule.ts`: skill schedules (due checks and calendar projection)
- `src/components/*`: iCloud-style UI: home tiles, Chief, kanban, calendar, retro, settings
