# Looper on your own servers

Self-hosted Looper runs the same app as hirelooper.com inside your network: Postgres, the web app and a scheduler that ticks every 15 minutes. No Vercel, no Neon, no billing. Free for your own use under FSL-1.1-ALv2 (`LICENSE.md`); reselling it as a service is not allowed.

## What you need

- A Linux host with Docker and Docker Compose, 2 vCPU and 4 GB RAM for up to 50 loopers
- A hostname with TLS in front of port 3000 (your load balancer or reverse proxy)
- An SMTP server for sign-in codes and notifications
- Outbound HTTPS to your model provider (Anthropic, OpenAI or xAI) and, if you use it, Composio

## Install

```
git clone https://github.com/HireLooper-com/looper looper && cd looper/deploy/enterprise
cp .env.example .env        # fill in every value
docker compose up -d --build
```

Open `LOOPER_URL`, sign up with an address in `LOOPER_ALLOWED_EMAILS`, paste a model key in Settings and hire the first looper. Tables are created on the first request; there is no migration step.

## What changes from the hosted app

| | hirelooper.com | On-prem (`LOOPER_EDITION=enterprise`) |
|---|---|---|
| Database | Neon over HTTP | Your Postgres through node-postgres (`DATABASE_DRIVER=pg`) |
| Scheduler | Vercel Cron | The `scheduler` service, `curl` every 900 seconds |
| Billing | Stripe | None: every workspace is active, unlimited workspaces and collaborators |
| Email | Loops | `SMTP_URL` |
| Sign up | Anyone | Only `LOOPER_ALLOWED_EMAILS` domains, plus people you invite |
| Custom connectors | Public hosts only | Hosts inside your network (`LOOPER_ALLOW_PRIVATE_HOSTS=1`) |

## Custom connectors

Settings → Custom connectors takes a base URL, an auth header and a JSON list of endpoints:

```json
[
  { "name": "list_orders", "method": "GET", "path": "/orders", "description": "Orders, newest first", "params": { "since": "string" } },
  { "name": "refund_order", "method": "POST", "path": "/orders/{id}/refund", "description": "Refund one order", "params": { "reason": "string" } }
]
```

GET endpoints are read tools: a routine reads from them before it proposes cards and the metric reader can use them. Every other method only runs from a card someone approves, or from a routine you switched to run alone. The header value is stored AES-256-GCM encrypted with `ENCRYPTION_KEY`.

## Operations

- Backups: `docker compose exec db pg_dump -U looper looper > looper-$(date +%F).sql`
- Upgrades: `git pull && docker compose up -d --build`; new columns are added on the first request
- Logs: `docker compose logs -f app scheduler`; each tick prints what ran
- `ENCRYPTION_KEY` never changes after the first sign in: model keys and connector secrets are encrypted with it

