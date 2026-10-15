# Twilio WhatsApp Integration — Setup Guide for Developers

This guide walks a developer through the complete Twilio WhatsApp setup for
Octave Chime (Aster Bank): creating the trial account, wiring credentials, and
verifying real message delivery through the app. It also documents the trial
account's hard restrictions, which trip up almost everyone.

---

## 1. How sending works in this app

```
POST /api/transactions ──▶ ledger.service (Neon, row-locked)
                              └──▶ notification.service ──▶ dispatch (idem-keyed)
                                      └──▶ messaging/twilio.js ──▶ Twilio Messages API
                                              └──▶ WhatsApp sandbox ──▶ physical phone
```

- `messaging/twilio.js` `sendMessage({ to, body, kind })` normalises numbers to
  E.164, builds the form, and POSTs to
  `https://api.twilio.com/2010-04-01/Accounts/{SID}/Messages.json`.
- When `TWILIO_CONTENT_SID` is set, every send goes out as that Content
  Template, with `templateVariables(body, kind)` mapping the app's message text
  into the template's `{{1}}…{{4}}` placeholders.
- `kind` is one of `alert`, `optin`, `summary`, `reply`, `test` and determines
  the variable mapping (see `messaging/twilio.js`).
- Delivery status callbacks update `oc_message_log` via `POST /api/twilio/status`.

---

## 2. The trial account — know the restrictions first

A new Twilio account is a **30-day trial**. Trial accounts:

| Restriction | What it means for this app |
|---|---|
| **No freeform text** | Every outbound WhatsApp message must be a pre-approved *trial template*. Custom `Body` text fails with **error 21654 "ContentSid Required"**. |
| **Fixed template content** | The trial template's wording is fixed. Variables passed in `ContentVariables` are **silently ignored** if the template has no placeholders. Custom copy is impossible until upgrade. |
| **Account-scoped ContentSids** | Each account gets its own template SID. SIDs from docs/other accounts fail with **21655**. |
| **Content API disabled** | `GET https://content.twilio.com/v1/Content` returns **20003** on trial — you cannot list templates programmatically. |
| **Verified recipients only** | You can only message numbers verified in the console (up to 5; your signup number is auto-verified). Unverified/not-joined numbers fail with **63015 / 21408**. |
| **Free units** | 100 WhatsApp messages / 30 days, no credit card needed. |

After **upgrading** (add funds):
- Freeform `Body` text works inside the 24-hour customer-service window (the
  recipient must have messaged the sender within 24h). Leave
  `TWILIO_CONTENT_SID` blank for this mode.
- You can create your own templates (Content Template Builder) with `{{1}}`
  variables — set `TWILIO_CONTENT_SID` to that `HX...` SID and the app's
  variable mapping kicks in.
- Sandbox still works as sender; no WhatsApp sender registration needed.

---

## 3. Prerequisites

- Node.js 18+ (verified on Node 24)
- A Neon (or any) Postgres connection string
- A Twilio account (trial is fine)
- 1–3 physical phones with WhatsApp for delivery verification

---

## 4. Twilio setup (step by step)

1. **Sign up** at https://www.twilio.com — no credit card required for trial.
2. In the Twilio Console, grab the API credentials (Dashboard page):
   - **Account SID** (`AC…`)
   - **Auth Token**
3. Go to **Messaging → WhatsApp → Try out WhatsApp** and confirm the terms.
   This activates the trial WhatsApp testing environment.
4. Note from that page:
   - **Sandbox sender number** — e.g. `+1 737 250 8034` (yours may differ).
     This is the `whatsapp:` `From` number for all sends.
   - **Join code** — e.g. `join twilio-trial`. Phones send this to the sandbox
     number to register.
   - **ContentSid** — the `HX…` value in the page's sample request block.
     If the page shows several templates, copy the one you want (see §6).
5. **Join each test phone**: save the sandbox number as a contact, then send
   the join code via WhatsApp. Twilio replies "You are all set!".
6. **Verify the recipient numbers** in the console if prompted (trial flow:
   each `To` number must be verified; your signup number is already).

> The `Try out WhatsApp` page embeds the ContentSid inside its code sample
> (curl/Node/Python). It is NOT in the main dashboard, and the Content API
> cannot list it on trial. If you can't see a sample request, walk the page's
> guided flow ("send your first message") until a code block appears.

---

## 5. Database setup

1. Create a Neon project (neon.tech, free tier).
2. Copy the **pooled** connection string.
3. **Remove `&channel_binding=require`** if present — Node's `pg` does not
   support SCRAM channel binding and connections will fail.

Schema and seed data apply automatically on first boot (idempotent).

---

## 6. Configure the app

```bash
npm install
cp .env.example .env
```

Fill `.env`:

```ini
DATABASE_URL=postgresql://user:pass@host/dbname?sslmode=require
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=your_auth_token
TWILIO_WHATSAPP_FROM=whatsapp:+17372508034      # your sandbox sender
TWILIO_CONTENT_SID=HXxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx  # trial template SID
# PUBLIC_URL=                                     # leave blank locally
# EOD_HOUR=18 / EOD_TZ=Africa/Lagos               # defaults are fine
```

Notes:
- `TWILIO_WHATSAPP_FROM` must include the `whatsapp:` prefix and match the
  sandbox page exactly.
- On a **trial** account, `TWILIO_CONTENT_SID` is mandatory. On an **upgraded**
  account you may leave it blank (freeform in 24h window) or point it at your
  own template.
- `.env` is gitignored — never commit credentials.

---

## 7. Run and verify

```bash
npm start
```

1. Health check:
   ```bash
   curl http://localhost:3000/api/health
   # expect { "db": true, "twilio": true, ... }
   ```
2. Real-message proof (the critical test):
   ```bash
   curl -X POST http://localhost:3000/api/send-test \
     -H "Content-Type: application/json" \
     -d '{"to":"+234XXXXXXXXXX"}'
   # expect { "ok": true, "sid": "MM...", "status": "queued", ... }
   ```
   The phone must receive a WhatsApp message within seconds.
3. Full app flow:
   - Open http://localhost:3000
   - **More → Account holder** → set a joined phone as holder (holder is
     consented automatically, no opt-in needed — important, see §8)
   - **Home / Transfers** → post a debit/credit → the holder's phone receives
     the alert
   - **More → Close day** → EOD summary message

Verify delivery on the **physical phone** and in Twilio Console
(**Monitor → Logs → Messaging**), not in the app. On a trial account the phone
sees the *fixed template text*; the app's real dynamic text is what the API
returns and what is stored in `oc_message_log.body`.

---

## 8. Inbound replies (YES / STOP / RESUME / HELP)

The double opt-in (`Reply YES to accept…`) requires Twilio to POST inbound
messages to `/api/twilio/inbound`, which **cannot reach localhost**. Without it:

- Recipients added in **Alerts** stay `pending` ("Awaiting YES") forever.
- Workaround locally: use the **holder** (auto-`granted`) as the alert target.

To enable full opt-in:

1. Deploy to Vercel (`vercel --prod`) — the whole app runs as one serverless
   function via `api/index.js`.
2. Set env vars in Vercel: `DATABASE_URL`, `TWILIO_ACCOUNT_SID`,
   `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM`, `TWILIO_CONTENT_SID`, and
   `PUBLIC_URL=https://YOUR-APP.vercel.app`.
3. In Twilio's sandbox config ("When a message comes in"), set the webhook to
   `https://YOUR-APP.vercel.app/api/twilio/inbound`.
4. `POST /api/twilio/status` receives delivery-status callbacks; signatures are
   validated against `PUBLIC_URL` (or proxy headers when blank).

Vercel Cron hits `/api/summary/run` at 17:00 UTC (18:00 Africa/Lagos); the
in-process `node-cron` scheduler is disabled when `VERCEL=1`.

---

## 9. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `21654 ContentSid Required` | Trial account + freeform send | Set `TWILIO_CONTENT_SID` to the trial template SID (§4). |
| `21655 ContentSid is Invalid` | SID from another account / typo | Copy the `HX…` SID from **your** Try out WhatsApp page. |
| `20003` on Content API | Content API blocked on trial | Use the SID from the console page; it can't be listed via API. |
| `21408` or `63015` (not in sandbox / not joined) | Phone hasn't joined sandbox or number not verified | Send the join code from the phone; verify number in console. |
| `20003` auth error on sends | Wrong SID/Token or stray spaces | Re-copy credentials exactly. |
| Invalid `From` | Missing `whatsapp:` prefix or wrong sender | Match `TWILIO_WHATSAPP_FROM` to the sandbox page exactly. |
| `db:false` on `/api/health` | Bad `DATABASE_URL` | Check connection string; drop `channel_binding=require`. |
| Message `queued` but phone silent | Not joined / window closed / 3s sandbox rate limit | Re-join phone; check Twilio Logs → Messaging for the error. |
| No alert after posting | Recipient `pending`, below threshold, or opted out | Use holder (auto-granted), or deploy for inbound `YES`. |

---

## 10. Costs & upgrade path

- **Trial**: 100 WhatsApp messages, 30 days, no card. Fixed template text only.
- **Upgraded**: freeform text within the 24h customer-service window
  (Twilio fee ~$0.005/message; Meta service messages inside the window are
  free). Custom templates via Messaging → Content Template Builder for
  business-initiated sends outside the window.
- The app needs **no code changes** for either mode — only the `.env` values
  differ (blank vs set `TWILIO_CONTENT_SID`).
