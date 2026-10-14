# groklooper

Hire AI **loopers**. Each one owns exactly one business metric and has:

- **1 metric**: a number with a target and direction, logged over time
- **1 kanban board**: the looper adds cards and moves them as it works
- **1 skill calendar**: scheduled skills (hourly, daily, weekly or on demand) and every past run
- **1 retro board**: the looper reviews its own runs and metric movement, rates its effectiveness from 1 to 5, and turns "try next" items into new cards

**Chief** is the main bot. Ask it to hire, brief, pause, retire or run loopers, or to report on the team.

Bring your own key: **Grok (xAI)**, **OpenAI** or **Anthropic**.

## Run

```bash
npm install
npm run dev            # http://localhost:3000
npm run seed           # optional: three demo loopers (paused)
```

1. Open **Keys & integrations**, paste a provider key, and pick a model.
2. Connect an integration hub (see below).
3. Talk to Chief: *"Hire a looper to grow LinkedIn impressions to 50k/week."*

## Integrations: thousands of apps

Loopers use tools over the Model Context Protocol (MCP). Each hub is one MCP URL that exposes many apps:

| Hub | What you paste |
| --- | --- |
| Composio | MCP server URL from the Composio dashboard (+ `x-api-key` header if needed) |
| Zapier MCP | Server URL (the secret is in the URL) |
| Pipedream | Remote MCP URL + auth header |
| Anything else | Any Streamable HTTP MCP endpoint |

Every tool is registered with `deferLoading`, and the looper gets a `search` tool (AI SDK `toolSearch`). The model searches for what it needs, so connecting thousands of tools doesn't fill the context window. You can limit which hubs each looper may use under **Skills & tools**.

## Scheduling

- **Local:** `src/instrumentation.ts` checks for due skills every minute while the server runs. Turn it off with `GROKLOOPER_TICKER=off`.
- **Hosted:** call `GET /api/tick` from a cron job. Set `CRON_SECRET` and send `Authorization: Bearer $CRON_SECRET`.

## Storage

Everything, including API keys, is stored in `data/db.json` (gitignored, mode 600). This works for one server. For a multi-instance or serverless deployment, replace `src/lib/db.ts` with Postgres and keep the secrets in an encrypted store.

## Code map

- `src/lib/agent.ts`: looper runs, retros, the scheduler tick, and Chief with its management tools
- `src/lib/integrations.ts`: MCP connections and deferred tool loading
- `src/lib/llm.ts`: the provider for each key (xAI, OpenAI, Anthropic)
- `src/lib/schedule.ts`: skill schedules (due checks and calendar projection)
- `src/components/*`: Chief chat, kanban, calendar, retro board, skills panel, settings
