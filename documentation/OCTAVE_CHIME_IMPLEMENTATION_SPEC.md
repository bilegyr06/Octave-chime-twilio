# Octave Chime — Implementation Spec (agreed)

Status: Locked for build · Supersedes `OCTAVE_CHIME_BUILD_PLAN.md` (rejected)
Product source of truth: `documentation/octave-chime-prd.html`
Demo source: `documentation/octave-chime-whatsapp.zip`

## 1. Objective

A pseudo-bank ("Aster Bank") simulator that posts transactions to a persistent
ledger and sends **real WhatsApp alerts** to account recipients via Twilio,
plus an end-of-day summary. A message must be observable on a physical phone.

## 2. Locked decisions

| Area | Decision |
|---|---|
| Backend | Node.js + Express, single service (UI + API + webhooks) |
| Frontend | Preserve `public/index.html`, restructured into a banking app |
| Messaging | Twilio WhatsApp Sandbox, freeform text inside the 24h window |
| Persistence | Neon Postgres via plain `pg` (no Prisma), new dedicated database |
| Consent | Simulated WhatsApp double opt-in (recipient replies YES) |
| Recipients | Managed in-app; per-recipient role/scope/threshold/EOD opt-in |
| Admin | None — everything is user-driven inside the app |
| EOD | Manual button + cron 18:00 Africa/Lagos |
| Delivery visibility | Not surfaced in-app; verified on the physical phone |
| Deploy | Render single web service, public HTTPS for webhooks |

## 3. Architecture

```
Browser (Aster Bank UI) ──JSON──▶ Express ──▶ Neon Postgres (oc_* tables)
                                     ├── messaging/twilio.js ──▶ Twilio Sandbox ──▶ phones
                                     ├── POST /api/twilio/inbound  (YES/STOP/RESUME/HELP)
                                     ├── POST /api/twilio/status   (delivery callbacks)
                                     └── cron 18:00 Africa/Lagos
```

## 4. Data model (Neon, all prefixed `oc_`)

- `oc_account` — number, type(individual/joint/corporate), holder, holder_wa, opening_balance, balance
- `oc_recipient` — account_id, name, wa_number, role, consent_status, opt_out, alert_scope, threshold, eod_opt_in
- `oc_consent` — recipient_id, action(opt_in/opt_out/resume), source, created_at (audit)
- `oc_transaction` — account_id, direction, type, amount, party, channel, ref (unique), idempotency_key (unique), status, balance_after, posted_at, business_date
- `oc_message_log` — recipient_id, transaction_id, summary_date, kind, to_number, body, twilio_sid, status, error_*, idem_key (unique)
- `oc_daily_summary` — account_id, business_date, opening, count, volume, inflow, outflow, net, closing — unique(account_id, business_date)

## 5. API

| Method | Route | Purpose |
|---|---|---|
| GET | `/api/health` | config + db status (no PII) |
| POST | `/api/send-test` | sandbox proof-of-delivery |
| GET/PATCH | `/api/account` | read account; switch type |
| POST | `/api/account/reset` | reset demo day |
| GET/POST | `/api/transactions` | statement; post transaction |
| GET/POST/PATCH/DELETE | `/api/recipients` | manage recipients + trigger opt-in |
| POST | `/api/summary/run` | EOD summary (idempotent) |
| POST | `/api/twilio/inbound` | WhatsApp replies (signed) |
| POST | `/api/twilio/status` | delivery callbacks (signed) |

## 6. Frontend

- Aster Bank, Octave dark system (teal/gold, crimson debits; Fraunces/DM Sans/JetBrains Mono).
- Responsive mobile app shell; bottom nav **Home · Transfers · Alerts · More**.
- Opens straight to Home (no landing, no login).
- Actions reuse the existing modal forms + receipt.
- Alerts tab: recipients + consent badges; polls while open.
- More tab: statement, balance, close day, discrete operator panel (type switch, reset).
- Removed: landing page, right column (delivery settings + phone mirror), all in-app message-feed rendering.

## 7. Constraints

- Trial delivers only to numbers that joined the sandbox; 2–3 phones for fan-out.
- Freeform only within the 24h window; a proactive EOD needs a recently active recipient.
- Dynamic content is possible in-window; out-of-window proactive needs an approved template (post-upgrade).
