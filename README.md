# Looper

AI hires that each own one business metric. A looper reads your tools every day, proposes work as cards on a board, and runs a card once you approve it. Every second Friday it opens a reflection chat about what worked.

This is the self-hosted Looper, the same app that runs [hirelooper.com](https://hirelooper.com). Free for your own use, see [License](#license).

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FHireLooper-com%2Flooper&project-name=looper&repository-name=looper&env=ENCRYPTION_KEY%2CCRON_SECRET%2CSMTP_URL%2CSMTP_FROM%2CLOOPER_ALLOWED_EMAILS&envDescription=Two+random+strings%2C+your+mail+server%2C+and+who+may+sign+up.&envLink=https%3A%2F%2Fgithub.com%2FHireLooper-com%2Flooper%23deploy-to-vercel&stores=%5B%7B%22type%22%3A%22integration%22%2C%22integrationSlug%22%3A%22neon%22%2C%22productSlug%22%3A%22neon%22%2C%22protocol%22%3A%22storage%22%7D%5D)

## What a looper does

- Owns one metric with a target and a date, like "qualified leads, 38 of 50 by Friday"
- Runs routines on a calendar and turns them into cards: Proposed, Approved, Running, Done
- Works in your tools through [Composio](https://composio.dev) (57 toolkits) or custom HTTP connectors
- Runs on your own model key: Anthropic, OpenAI or xAI
- Opens pull requests on GitHub for SEO pages and bug fixes, within file and line limits you set

## Deploy to Vercel

Click the button above. In about 3 minutes you get a copy of this repo in your GitHub, a Neon Postgres database and a running app. Vercel asks for 5 values:

| Variable | What to put |
|---|---|
| `ENCRYPTION_KEY` | Output of `openssl rand -hex 32`. Encrypts model keys; never change it later |
| `CRON_SECRET` | Another `openssl rand -hex 32` |
| `SMTP_URL` | Your mail server for sign-in codes. With [Resend](https://resend.com): `smtps://resend:re_YOURKEY@smtp.resend.com:465` |
| `SMTP_FROM` | `Looper <looper@yourdomain.com>`, on a domain your mail provider has verified |
| `LOOPER_ALLOWED_EMAILS` | Who may sign up: `you@yourcompany.com`, or `@yourcompany.com` for your whole team |

Then:

1. Open your new URL, sign up, and paste an Anthropic, OpenAI or xAI key in Settings.
2. Turn on the scheduler, which runs loopers every 15 minutes:
   - **Vercel Pro**: in `vercel.json`, change the schedule to `*/15 * * * *` and push.
   - **Vercel Hobby** (daily crons only): in your new GitHub repo, copy `deploy/github/tick.yml` to `.github/workflows/tick.yml` (Add file → Create new file, paste it). Then open Settings → Secrets and variables → Actions, add the variable `LOOPER_URL` with your app URL and the secret `CRON_SECRET` with the same value as in Vercel. The workflow then calls the scheduler every 15 minutes. It ships outside `.github/workflows` because GitHub refuses workflow files from the Deploy button.
3. Optional: add `COMPOSIO_API_KEY` in Vercel → Settings → Environment Variables to connect 57 tools.

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
