# CLAUDE.md

Looper, self-hosted: AI hires that each own one business metric. Next.js 16, React 19, Postgres. Licensed FSL-1.1-ALv2, see `LICENSE.md`. This repository is exported from the private hirelooper.com repo; pull requests are ported back by hand.

## Layout

Web app (`/app`, `/login`, `/signup`):
- `lib/db.ts` the whole schema; tables are created on first query, no migration step. Neon over HTTP for Neon URLs, node-postgres for any other Postgres (on-prem, local)
- `lib/workspace.ts` workspaces, members, invites; loopers keep `user_id` = the workspace owner, whose key and plan they run on. Scope every query by workspace membership, never by `user_id` alone
- `lib/tools.ts` the one entry point for tools: Composio (`lib/composio.ts`) plus custom connectors (`lib/connectors.ts`, toolkit slug `x_<slug>`)
- `lib/notify.ts` digest email (cards to approve, failed runs, open reflection) and the Monday report, from the tick
- `lib/geo.ts` GEO answer engines with web search: the founder's model plus ChatGPT, Perplexity and Google AI through one OpenRouter key (`engine_keys`); `lib/models.ts` providers and the model dropdown lists
- `lib/auth.ts` email codes (6 digits, 10 minutes, 5 tries, `login_codes` table), session cookie, `isPaid` billing gate
- `lib/mail.ts` Loops transactional email over fetch (`LOOPS_API_KEY`, `LOOPS_TEMPLATE_ID`), one generic template with `subject`, `heading`, `body`; without a key, mail prints to the server log
- `lib/llm.ts` founder's own key: Anthropic SDK, OpenAI and xAI over fetch; `chat`, `json`, `withTools`
- `lib/composio.ts` Composio REST v3.1: link accounts, list tools, execute; `TOOLKITS` lists the 57 toolkits; the app only offers those with an enabled auth config in the Composio project (`enabledToolkits`, cached 5 minutes); one Composio user per workspace
- `lib/engine.ts` routine runs into cards, card execution, metric reads, attribution, `fireLooper`. A fired looper keeps its row with `fired_at` set; any query that runs, lists or emails loopers filters `fired_at is null`
- `lib/reflection.ts` reflection chat, rule diff, accept (new `routine_versions` from next Monday)
- `lib/talk.ts` chat with a looper any day (`talk` table, right panel of the looper page, `app/app/l/[id]/chat.tsx`): answers with read tools, proposes changes through `propose_*` tools; `apply` runs one after a person presses Apply. Pure helpers in `lib/talk-turns.ts`. Looper replies in both chats render the model's small markdown (paragraphs, lists, bold, italic, code) through `lib/rich.ts` and `app/app/l/[id]/rich.tsx`, never as HTML; tested in `test/rich.test.ts`
- `lib/memory-store.ts` looper memory, scoped by workspace: `notes` (what a person approved a looper should know, superseded never edited, 90-day expiry) and `ledger` (items a looper tracks, written from tool reads). The only file that queries those tables; `lib/memory.ts` binds it to the app database. Routines read both; signals and check-backs write the ledger
- `lib/scheduler.ts` one idempotent tick; `/api/cron/tick` every 15 minutes via `vercel.json`: plan, setup, signals, routines, metric, reflection, approved cards, pull requests, check-backs, email
- `lib/roles.ts` hireable roles as specs, data only: metrics, units of work, subject, setup steps, signals, preset routines (input, action, check), check, limits. Paid ads, SEO and bug fixing have presets, the rest are planned by the model. `limits.pr` caps a pull request (files, lines, edits only, a required test); a PR outside it becomes a by-hand card. Never name a role in engine code; add to the spec. `KINDS` groups tools that do one job (help desk, CRM, inbox, books, issue tracker): a role's default in a kind is swapped for the founder's own (`stack` on the draft, `swap` in `lib/draft-steps.ts`), so metric names, hints and rules for a kinded tool name the job, never the product
- `lib/spec.ts` pure rules from a spec: guards (subject cooldown, weekly caps, always ask), check days, routine defaults, writable paths, edits, citation parsing. Tested in `test/spec.test.ts`
- `lib/brief.ts` the Brief tab's pure rules: setup notes as `key: value` properties, path lists, edit history (an edit or a new read moves the old text into `history`, 5 kept). Tested in `test/brief.test.ts`
- `lib/pages.ts` the pages already on a founder's site, from robots.txt or /sitemap.xml (public hosts only, `getPublic` in `lib/net.ts`). A role with `sitePages` gets them in every routine run, and a new page whose URL words match a published one is held back (`existingPage` in `lib/spec.ts`)
- `lib/signals.ts` daily reads into the ledger (`loopers.signals_at` keeps it to once a day); GEO answers come from `askBuyerQuestions` in `lib/engine.ts`
- `lib/publish.ts` the `github_pr` action: branch, commits, pull request, merge state, undo PR, read tools for the model (pinned to one repo when given), all through an injected `gh` (`githubFor` in `lib/tools.ts`, Composio proxy execute)
- `lib/checks.ts` check-backs on done cards (`checks` table): day 0 baseline, verdicts after
- `lib/plan.ts` reads the founder's homepage and has their model write the brief, routines (v1 rules, unless the role has presets), tools and, when the role reads AI answers, 10 buyer questions; then runs the setup steps (`loopers.setup`, `setupSteps`: the role's, plus `REPO_STEP` once any routine opens pull requests, so every PR looper knows its repo); runs after hire, after a key is saved, and from the tick
- `lib/logos.ts` tool logos for the app keyed by Composio slug, copied from `public/looper.js`
- `/app/all` every looper and card to approve across workspaces; `/app/settings` workspace, people, connectors, engines, email
- `deploy/enterprise/` self-hosting with Docker: Postgres, the app and a scheduler that ticks every 15 minutes
- `lib/billing.ts` billing gates; self-hosted Looper has none, so every workspace runs with every feature
- Onboarding at `/app`, one step per screen: start Pro, website, the AI (API key; ChatGPT, Grok and Cursor plans record interest as `model_plan_interest` events), hire from the org chart (`app/app/hire/chart.tsx`). The looper page is a full-width desk: tabs on the left (Metric, Board, Calendar, Brief, Tracking, Reflection; Brief is the editable hire notes, Tracking one sortable table per signal with columns from the role spec), approval notifications and the chat on the right, a dock with the team and a hire button
- Looper builder at `/app/new` (`app/app/new/`): metric, unit of work, tools, skills, try it, one screen each, saved in the `drafts` table until hire. Try it runs the metric read and each skill once through `lib/trial.ts` (`measureMetric`, `fetchSignal`, `planCards`, the same code a hired looper runs) and saves nothing but the result on the draft; each run shows as the looper's message with its cards. A looper with a `github_pr` skill needs its repository confirmed on Try it before it tries or hires (`guessRepo` suggests, never picks); it becomes `loopers.repo`. `repoFor` in `lib/brief.ts` is the one repo a looper reads and opens pull requests in: `loopers.repo`, else the `repo:` line of its notes, which a Brief edit keeps in sync. A PR card for any other repo never opens. A role prefills every step from its spec (`work` units map to preset routines); your own looper gets units, tools and skills suggested by the model. `lib/draft.ts` holds the model calls, `lib/draft-steps.ts` the pure steps (tested in `test/draft.test.ts`); skills are routines, written by `writePlan` in `lib/plan.ts`
- `app/actions.ts` every server action; `app/app.css` app styles on `.ax`, same tokens as `.pA`
- Env vars: `.env.example`

## Commands

```
npm install
npm run dev
npm run build
```

```
npm test     # node --test: routine slots, reflection Fridays, attribution, chat turns, memory, role specs, guards, pull requests, brief notes, chat markdown
TEST_DATABASE_URL=postgres://localhost/looper_test npm test   # also runs the workspace isolation test; a throwaway database, never production
```

No linter. Run `npm test` and `npm run build` before pushing. For local app work set `DATABASE_URL`, `ENCRYPTION_KEY` and `LOOPER_SKIP_BILLING=1` in `.env.local`; a local Postgres (`postgres://...@localhost/looper`) works through node-postgres, or a separate Neon database, never production. Without `LOOPS_API_KEY` sign-in codes print to the dev server log.

## Rules

- Copy: sentence case, no em dashes, no buzzwords. Every claim is a number, a time or a tool.
- Terminology: what a looper owns is a "metric" or "business metric", never a "number" ("one business metric", not "one business number"). Applies to copy, UI, emails, prompts and docs.
- One accent (`--acc`). Do not add a second.
- Respect `prefers-reduced-motion` in any new animation.
