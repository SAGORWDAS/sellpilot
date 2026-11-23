# SellPilot

Autonomous sales engine for any project. Paste a URL — a web design service, a Play Store
app, a Shopify store, a SaaS — and SellPilot learns the offer, finds leads, sends
personalized outreach from your own mailbox, reads replies, handles objections and closes
with your booking or checkout link. The frontend is a few inputs and a launch button.

## How it works

```
Project (any URL) ──► Offer Analyst ──► Strategist ──► Lead Scout ──► Copywriter
                                                          │               │
   booking / checkout ◄── Closer ◄── Reply Agent ◄── IMAP poll ◄── SMTP sender
```

- **Offer Analyst** crawls the site and extracts a factual offer profile (never invents prices or claims).
- **Strategist** (smart model) designs the ICP, lead searches, angles and a 3-step sequence.
- **Lead Scout** searches Google via Serper (Places for local businesses, Search for everything
  else), audits each website (HTTPS, mobile, contact form, stale copyright) into a personalization
  hook, and extracts published business emails. CSV import works too.
- **Copywriter** (bulk model) writes a per-lead sequence, lint-checked for spam triggers and length.
- **Sender** sends from your mailbox with warmup (5 → 10 → 20 → 40/day), daily caps,
  business-hours scheduling in the lead's timezone, jitter, and threading. **Stops on reply.**
- **Reply Agent** polls IMAP, matches threads, classifies replies and answers factually.
  Unsubscribe and bounces are handled deterministically — never by the LLM — and suppress
  the address globally. Interested leads get your close link; you get a hot-lead alert.
- **Human takeover** pauses the AI on any thread from the inbox UI.

No open/click tracking pixels (they hurt cold-email deliverability) — metrics are reply-based.
Every email carries sender identity, a working unsubscribe line and List-Unsubscribe headers.

## Stack

Next.js 16 · React 19 · Tailwind v4 · Postgres 16 + Drizzle · pg-boss (queue on the same
Postgres — no Redis) · OpenAI structured outputs · Serper.dev · nodemailer + imapflow.
Multi-tenant schema from day one; public signup is behind `ALLOW_SIGNUP`.

## Run locally

Node 22+ and a Postgres 16 (Docker is easiest):

```bash
docker run --name sellpilot-db -e POSTGRES_PASSWORD=dev -p 5432:5432 -d postgres:16
docker exec sellpilot-db createdb -U postgres sellpilot

npm install
cp .env.example .env        # fill SESSION_SECRET + SECRETS_KEY (openssl rand -base64 32)
npm run db:migrate:app
npm run db:seed             # prints your login email + password

npm run dev                 # web on :3000
npm run worker              # separate terminal — the agent pipeline
```

Then in the app: **Settings** (OpenAI + Serper keys, mailbox) → **New project** (paste URL) →
**Launch campaign** (audience, volume, budget) → watch the **Inbox**.

`EMAIL_DRY_RUN=1` runs the whole pipeline but logs emails instead of sending — use it for
your first end-to-end test.

## Tests

```bash
npm test          # boots a throwaway embedded Postgres — no install, no Docker needed
npm run typecheck
```

73 tests cover auth/tenancy, crypto, the queue, crawling, lead discovery/auditing,
copy lint, warmup/caps/scheduling, stop-on-reply, suppression, reply classification,
closing and the digest. OpenAI/Serper/SMTP/IMAP are mocked; the database is real.

## Deploy (one small VPS)

```bash
cp .env.example .env        # real secrets, keys, APP_URL=https://your-domain, EMAIL_DRY_RUN=0
docker compose up -d --build
docker compose run --rm migrate npx tsx scripts/seed.ts   # first run only — prints login
```

Compose runs Postgres, a one-shot migration, the web app and the worker. Put Caddy/nginx
with TLS in front of `:3000`. The worker schedules itself: sends every minute, inbox poll
every 2 minutes, digest daily.

## Costs

- OpenAI: bulk model for copy/classification (cents per lead), smart model only for strategy.
  Every campaign has a hard USD budget (`api_usage` tracks every call).
- Serper: ~$1 per 1,000 searches.
- Mailbox: your existing one (Hostinger/Google/Outlook presets). No per-seat SaaS fees.

## Safety rails

- Global suppression list honored across all projects and campaigns; unsubscribe is instant
  and never LLM-gated. Bounces suppress too.
- Only published business contact addresses; sender identity + unsubscribe in every email.
- Warmup ramp + per-mailbox daily caps + campaign volume caps, business hours only.
- Mailbox credentials and API keys encrypted at rest (AES-256-GCM).
- Pause/kill switch on every campaign; per-thread human takeover.