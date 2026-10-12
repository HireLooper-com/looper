# Looper

AI hires that each own one business metric. A looper reads your tools every day, proposes work as cards on a board, and runs a card once you approve it. Every second Friday it opens a reflection chat about what worked.

This is the self-hosted Looper, the same app that runs [hirelooper.com](https://hirelooper.com). Free for your own use, see [License](#license).

## What a looper does

- Owns one metric with a target and a date, like "qualified leads, 38 of 50 by Friday"
- Runs routines on a calendar and turns them into cards: Proposed, Approved, Running, Done
- Works in your tools through [Composio](https://composio.dev) (57 toolkits) or custom HTTP connectors
- Runs on your own model key: Anthropic, OpenAI or xAI
- Opens pull requests on GitHub for SEO pages and bug fixes, within file and line limits you set

## Run it with Docker

Postgres, the app and a scheduler that ticks every 15 minutes:

```
git clone https://github.com/HireLooper-com/looper && cd looper/deploy/enterprise
cp .env.example .env        # fill in every value
docker compose up -d --build
```

Full guide: [`deploy/enterprise/README.md`](deploy/enterprise/README.md).

## Run it locally

Node 22 and a Postgres database.

```
npm install
cp .env.example .env.local   # set DATABASE_URL, ENCRYPTION_KEY, CRON_SECRET
npm run dev
```

Tables are created on the first request. Without `LOOPS_API_KEY` or `SMTP_URL`, sign-in codes print to the dev server log. The scheduler is one endpoint: call `/api/cron/tick` with `authorization: Bearer $CRON_SECRET` every 15 minutes.

```
npm test
npm run build
```

`CLAUDE.md` maps the codebase file by file.

## License

[Functional Source License 1.1, Apache 2.0 future license](LICENSE.md) (FSL-1.1-ALv2).

- Free to use, modify and self-host for your own company, for education and for research
- Free to use when you run it for a client as a consultant
- Not allowed: selling Looper, or a service built on it that competes with hirelooper.com
- Each version becomes Apache 2.0 two years after its release

Want to resell or white-label it? Write to hello@hirelooper.com.

## Contributing

Issues and pull requests are welcome. This repository is exported from the hirelooper.com codebase, so a merged pull request is ported there by hand and comes back in the next export.
