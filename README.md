# Octave Chime — Aster Bank WhatsApp Alerts

Aster Bank is a simulation bank (it never moves real money). Any transaction you
post fires **real WhatsApp alerts** to the recipients you add, delivered through the
**Twilio WhatsApp Sandbox**. Alerts use **freeform text** — sandbox recipients see the
full amount, party, reference and balance. An end-of-day summary is sent automatically
at 18:00 Africa/Lagos and can also be triggered manually.

Architecture: single Node.js/Express service (UI + API + webhooks), a persistent
**Neon Postgres** ledger, and Twilio Messages API for sending and inbound opt-in.

## The 24-hour sandbox window

Twilio only lets you send **freeform text** to a phone that has messaged the sandbox
number **within the last 24 hours**. So for the demo to work end to end:

1. Each phone you want to alert must first open WhatsApp → **Messaging > WhatsApp > Try
   out WhatsApp** and join the sandbox.
2. That same phone should send **any message** to the sandbox number to open its
   24-hour window (sending a test from one phone keeps that recipient warm).
3. Recipients you add in the app then receive a real **opt-in** message to which they
   reply `YES`.

Plan the fan-out with **2–3 joined phones** during the session so every alert lands.

## 1. Prerequisites (you must supply)

- A **Neon** project URL: `DATABASE_URL` (Postgres connection string).
- Twilio Console → **Messaging > WhatsApp > Try out WhatsApp**:
  - Account SID (`AC…`) and Auth Token (`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`)
  - Sandbox sender number, e.g. `whatsapp:+14155238886` (`TWILIO_WHATSAPP_FROM`)
  - The **join code** your test phones will message to the sandbox
- 2–3 WhatsApp phones to join the sandbox.

## 2. Setup

Requirements: Node.js 18+ (this machine has Node 24).

```powershell
npm install
Copy-Item .env.example .env
notepad .env
```

Fill in real values for `DATABASE_URL`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` and
`TWILIO_WHATSAPP_FROM`. Keep `.env` private — never commit it.

## 3. Run

```powershell
npm start
```

Open http://localhost:3000. The app opens straight to the Aster Bank dashboard.

- **Home / Transfers** — post a debit or credit. Every eligible (consented) recipient
  gets a real WhatsApp alert.
- **Alerts** — add recipients. Each addition sends a WhatsApp **double opt-in**
  message; alerts only start after the person replies `YES`.
- **More → Account holder** — set the holder's number. The holder is a trusted base
  recipient and receives alerts without opt-in.
- **More → Close day** — sends the daily summary to recipients who opted into it now
  (the scheduler also does this at `EOD_HOUR`).

Verify delivery on the **physical phones**, not the app — the UI only reports how many
recipients received the send. Delivery status is written to the `oc_message_log` table.

## 4. Deploying to Vercel

Vercel runs the whole Express app as a single serverless function (`api/index.js`).
Everything is pre-wired: `vercel.json` routes all traffic to it and adds a daily
**Vercel Cron** (17:00 UTC = 18:00 Africa/Lagos) that hits `/api/summary/run` for the
end-of-day summary — `node-cron` is disabled when the `VERCEL` env is present.

1. `npm i -g vercel` then `vercel login` (or `vercel` CLI linked the first time).
2. In Vercel **project > Settings > Environment Variables**, set the same variables as
   `.env`: `DATABASE_URL`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`,
   `TWILIO_WHATSAPP_FROM`, and `PUBLIC_URL = https://YOUR-APP.vercel.app`.
   Credentials never leave the server — they are not in the repo.
3. `vercel --prod` and note the live URL.
4. In Twilio Console → Messaging → WhatsApp → Try out WhatsApp, set the **When a
   message comes in** webhook (HTTP GET/POST) to
   `https://YOUR-APP.vercel.app/api/twilio/inbound`. Inbound `YES` / `STOP` / `RESUME` /
   `HELP` replies are then handled, and their signatures verified.
5. Verify delivery on the physical phones.

If Neon is blocked on your account (e.g. "action restricted"), use any Postgres:
**Supabase** (free), Render free Postgres, or Railway. Just put that connection string
in `DATABASE_URL` — the schema auto-applies on first request.

## 5. Troubleshooting

- **`20003` / auth error** — Account SID or Auth Token wrong, or pasted with spaces.
- **`21408` `+` / not in sandbox** — the number hasn't joined the sandbox, or its
  24-hour window closed (have it message the sandbox again).
- **Invalid `From`** — copy the sandbox sender exactly, including the `whatsapp:` prefix.
- **`db:false` on `/api/health`** — `DATABASE_URL` missing/placeholder; schema auto-applies
  and seeds on boot once set.
- **No alert after posting** — recipient not yet `granted` (they didn't reply `YES`),
  below their threshold, opted out, or the send failed (check the server console/logs).

## API endpoints

- `GET  /api/health` — db/twilio/puburl/eod readiness
- `GET  /api/account` · `PATCH /api/account` · `POST /api/account/reset`
- `GET  /api/transactions` · `POST /api/transactions`
- `GET  /api/recipients` · `POST /api/recipients` · `PATCH/DELETE /api/recipients/:id`
- `POST /api/summary/run`
- `POST /api/twilio/inbound` — signed webhook for YES/STOP/RESUME/HELP
- `POST /api/twilio/status` — signed delivery-status callback
- `POST /api/send-test` — one real freeform message to a `to` number

## Security notes

- Twilio credentials live only in server-side `.env` (never in the client).
- Message-idempotency keys, a row-locked transaction and an upserted daily summary keep
  alert replay safe across retries.
- Simulation only — no real accounts, no real money, and sandbox delivery only to
  numbers that joined it.