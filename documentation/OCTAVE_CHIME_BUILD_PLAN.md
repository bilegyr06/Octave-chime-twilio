# Octave Chime — Build Plan (48h, mock-first)

> Companion document to `OCTAVE_CHIME_IMPLEMENTATION_PLAN.md` (the product spec).
> This file records the **approved build decisions**, architecture, scope corrections,
> phase schedule, and risks so the plan survives beyond any single chat session.

**Status:** Approved
**Spec source of truth:** `OCTAVE_CHIME_IMPLEMENTATION_PLAN.md`
**Deadline:** ~48 hours from kickoff, public URL required
**Scope:** Nothing cut — full §17 acceptance criteria of the spec

---

## 1. Locked Decisions

| Decision | Choice |
|---|---|
| Stack | **Next.js (UI only)** + **Express (API / services / cron / webhooks)**, TypeScript throughout, **Prisma + Neon PostgreSQL** |
| Package manager | **pnpm** via corepack — npm 12's resolver wedges (CPU spin, no progress) on this machine; abandoned mid-Phase 0 |
| Prisma version | **6.19.3 pinned** — Prisma 7's dependency tree (studio-core, cloud SDKs) was excessively heavy |
| Location | Inside `octave chime docs\` → `api\` and `web\` folders |
| Messaging | **Termii** behind an adapter: `TERMII_MODE=mock` now, `live` later. Free-form primary, `TERMII_TEMPLATE_ID` fallback if configured |
| Account linking | **Mono** behind an adapter: `MONO_MODE=off` (simulated demo catalog) / `sandbox` (real Connect widget, test keys) now, `live` (same code, prod keys) later — same config-only swap discipline as Termii |
| Chat bot | Fully real inbound bot (webhook-driven), sequential text replies (no interactive buttons) |
| Auth | Email/password for bank admins + platform admin role (JWT httpOnly cookie) |
| Scheduler | Real cron at **21:00 Africa/Lagos** + admin "Run Daily Summary Now" demo action |
| Design direction | Spec §15: fintech-ops style, dashboard-first, WhatsApp green only as accent |
| Deployment | **Vercel (web UI)** + **Render (Express API + cron + webhook)**, managed **Neon** Postgres |
| Enrollment links | Live on the **Vercel UI domain**; UI calls the Render API |
| Chat visibility | Phone only in live mode (no on-screen chat mirror) + **dev-only mock console** when `TERMII_MODE=mock` |
| Recipient numbers | Real customers = whoever messages the bot number and completes onboarding |

---

## 2. Architecture

```
[User phone / Termii]  ←mock: scripts/mock-inbound.js→  Express (Render)
                                          │  POST /webhooks/termii
                                          ├─ BotEngine (dialog state machine)
                                          ├─ Services: bank / customer / account-linking
                                          │            / transaction / notification / summary
                                          ├─ TermiiAdapter: mock (console) | live (fetch)
                                          ├─ node-cron 21:00 Africa/Lagos
                                          └─ Prisma → Neon PostgreSQL

Next.js (Vercel) ── fetch ──→ Express API
  login · dashboard · customers · transactions · notifications · settings
  /enroll/[token] · /consent/[token] · /status   (secure web surfaces only)
```

### Folder layout (FastAPI-style layering)

The API is organised like a FastAPI application — every folder exists for a
reason, and the import rules below keep it that way.

```
octave chime docs\
├── OCTAVE_CHIME_IMPLEMENTATION_PLAN.md    # product spec (unchanged)
├── OCTAVE_CHIME_BUILD_PLAN.md             # this file
├── octave-chime-platform.html             # design reference only
├── octave-chime-whatsapp.zip              # prior Express/WhatsApp reference only
├── api\
│   ├── prisma\
│   │   ├── schema.prisma                  # DB source of truth
│   │   ├── migrations\
│   │   └── seed.ts
│   ├── scripts\
│   │   ├── mock-inbound.js                # pushes Termii inbound payloads
│   │   └── e2e-acceptance.js
│   └── src\
│       ├── server.ts                      # entrypoint (≈ uvicorn)
│       ├── app.ts                         # createApp(): middleware + routers (≈ create_app)
│       ├── core\                          # config, logger, errors, security(jwt), constants
│       ├── db\                            # prisma.ts client singleton, tenantScope.ts
│       ├── models\                        # domain types, enums, Prisma→domain mappers
│       ├── schemas\                       # zod request/response validation (≈ Pydantic)
│       ├── services\                      # business logic (no Express types)
│       │   ├── bank.service.ts
│       │   ├── customer.service.ts
│       │   ├── accountLinking.service.ts
│       │   ├── transaction.service.ts
│       │   ├── notification.service.ts
│       │   ├── summary.service.ts
│       │   └── bot\                        # dialog engine + handlers (≈ bot routers)
│       ├── routes\                        # thin Express Routers (parse → service → respond)
│       ├── adapters\                      # termii.adapter.ts (mock|live), mono.adapter.ts
│       └── workers\                       # scheduler.ts (node-cron 21:00 Lagos), summary.worker.ts
├── web\                                   # Next.js — idiomatic App Router structure
│   └── src\{app, components, lib}\         # not FastAPI-layered
```

**FastAPI → Express mapping**

| FastAPI | Express API | Holds |
|---|---|---|
| `app/main.py` + `create_app()` | `src/server.ts` + `src/app.ts` | entrypoint + app factory with middleware mount order |
| `app/core/` | `src/core/` | config/env, logger, error handler, JWT/security, constants |
| `app/db/` + session/deps | `src/db/` | Prisma client singleton, tenant-scoping helpers |
| `app/models/` (SQLAlchemy) | `prisma/schema.prisma` + `src/models/` | DB truth in Prisma; domain types/enums/mappers in `src/models/` |
| `app/schemas/` (Pydantic) | `src/schemas/` | Zod schemas + `z.infer` TS types |
| `app/services/` | `src/services/` | business logic only |
| `app/routes/` (APIRouter) | `src/routes/` | one Express Router per resource |
| `app/workers/` | `src/workers/` | cron scheduler, summary job, retries |
| `app/integrations/` | `src/adapters/` | Termii (mock/live), Mono (off/sandbox/live) |

### Repository model (single repo, monorepo deploy)

One git repository tracks the plan docs, `api/`, and `web/` together
(`main` + `develop` per §7). `api/` carries its own nested `.gitignore`
(git honours nested ignore files). Deployment splits by root directory:

- **Vercel** → Root Directory = `web`
- **Render** → Root Directory = `api` (web service + cron)

**Import rules (folders are not decorative):**

- `routes/` may import `schemas/` + `services/` only — **never Prisma directly**.
- `services/` may import `models/`, `schemas/`, `db/`, `adapters/` — **never Express**.
- `services/` return **domain objects** (via mappers), not raw Prisma types.
- `workers/` only call `services/` — the cron job is just a service caller.
- `adapters/` is the only place with outbound HTTP.
- Every cross-tenant query goes through `db/tenantScope`.
- `web/` follows idiomatic Next.js: `app/` routes, `components/`, `lib/`
  (API client + local types); the layering discipline applies to the API only.

### Environment template

```bash
DATABASE_URL=postgresql://...                 # Neon
TERMII_MODE=mock                              # mock | live
TERMII_API_KEY=placeholder
TERMII_BASE_URL=https://api.termii.com
TERMII_DEVICE_ID=dev-placeholder
TERMII_TEMPLATE_ID=                           # optional; enables proactive template path
SESSION_SECRET=
APP_URL=https://<vercel-domain>               # enrollment links live here
API_URL=https://<render-domain>
PORT=4000
```

---

## 3. Termii Mock Strategy (critical path)

The project is built and validated **locally against a mocked Termii** before any
money is spent or any plan is upgraded.

1. **Placeholder config** — `.env` ships with `TERMII_DEVICE_ID=dev-placeholder`
   and empty `TERMII_TEMPLATE_ID`; all code paths exist but no live calls are made.
2. **Inbound simulator** — `node scripts/mock-inbound.js "START"` POSTs Termii's
   exact inbound webhook JSON to the local server:

   ```json
   {
     "type": "inbound",
     "id": "8248611476370959318",
     "message_id": "3905204342778053556",
     "receiver": "12022214836",
     "sender": "2348030000000",
     "message": "START",
     "received_at": "2026-10-07T10:51:03.000000Z",
     "cost": null,
     "command": "Received",
     "status": "Received",
     "channel": "whatsapp"
   }
   ```

   Endpoint is idempotent on `message_id`. This lets us inject keywords, menus,
   PAUSE/STOP flows, etc. exactly as a real user would send them.

3. **Outbound stub** — `TermiiAdapter` in mock mode logs the formatted bot reply
   to the console **and** still writes the `Notification` / message record, so
   delivery logs, dashboards, and status transitions behave identically to live.
   Live mode swaps in a `fetch` to `TERMII_BASE_URL/api/whatsapp/freeform`
   (or `/api/send/template` when `TERMII_TEMPLATE_ID` is set) with **no code change**.
4. **Neon from day 1** — local-first development, same DB connection style in dev
   and deployed environments.

### Going live later (config only, no code change)

1. Buy/provision a Termii WhatsApp device → set `TERMII_DEVICE_ID`, `TERMII_MODE=live`.
2. Paste the Render webhook URL (`https://<render>/webhooks/termii`) into
   `accounts.termii.com/#/account/webhook/config`.
3. Optionally approve a WhatsApp template and set `TERMII_TEMPLATE_ID` for
   proactive out-of-window messages (transaction alerts / 9 PM summaries more
   than 24h after the customer's last inbound message).

**Termii constraint to remember:** free-form messages only work inside the
24-hour customer-service window (started when the customer messages first).
Proactive messages outside that window require an approved template.

Full provisioning + deployment flow lives in §8 (Phase 8 Deployment Runbook).

---

## 4. Spec Corrections (ambiguities resolved in the product spec)

These amendments override/clarify `OCTAVE_CHIME_IMPLEMENTATION_PLAN.md`:

1. **New field `Customer.serviceStatus`** holds the five service states
   (`pending_link | active | paused | opted_out | link_expired`).
   `consentStatus` and `enrollmentStatus` remain separate fields.
2. **`Notification.transactionId` is nullable** — `daily_summary` notifications
   have no transaction.
3. **Alert-disabled message wording fixed:**
   > WhatsApp alerts are currently paused for this account.
   > Reply RESUME on WhatsApp to turn them back on.
   (The original text pointed to a "dashboard" that does not exist for customers.)
4. **Add a `BALANCE` WhatsApp command** — spec §7 promises customers can view
   their balance, and there is no customer dashboard; the bot answers with the
   linked account's current balance (masked account number only).
5. **Chat identity capture = full name only**, plus bank choice and consent.
   No email, phone confirmation from webhook `sender`, never credentials.
6. **Bank admin "add/invite customer"** = admin creates a `pending_link`
   customer record and the system generates the standard secure enrollment
   link, surfaced as a copyable field in the UI.
7. **Secure links**: signed, single-purpose, short-lived (30-min TTL),
   one-time-use tokens. Enrollment, re-consent, and relink share one
   `/enroll/[token]` route with different modes.
8. **Bot number on dashboard**: surfaced (with the Termii device number) when
   `TERMII_MODE=live`; shows a `Not configured` badge with the placeholder in
   mock mode.
9. **Mono Connect is real (sandbox) in the MVP** — account linking runs the
   actual Mono Connect widget in sandbox/test mode (fake banks, `user_good` /
   `123456` test credentials); the backend exchanges the widget auth `code` for
   a permanent Mono account ID via `POST /v2/accounts/auth`. Spec §8's "never
   ask real banking credentials" still holds — sandbox credentials are fake.
   `MONO_MODE=off` keeps the simulated demo-account catalog for key-less /
   offline runs; `mono_simulated` remains for seeded customers.
10. **Daily summary numbers are derived, not stored per-move** — the schema has
    no `balanceBefore` column, so the opening balance in each `DailySummary` is
    computed as `closing − net(credits − debits)` for the Lagos-day window;
    closing equals the linked account's persisted `currentBalance` at run time.
    No migration.
11. **RELINK/reconsent = a new account** — completing a `relink` or `reconsent`
    token creates a brand-new `LinkedAccount` (provider exchange), sets the
    previous active account to `disconnected`, and preserves each account's
    transaction history/notifications. `enroll` remains first-link-only.
12. **Mono Connect init must not send an inline `data.customer`** — the current
    sandbox/frontend widget rejects any inline customer object with a
    "Validation Failed" modal. The widget links with `key` + `scope: "auth"` +
    `reference` only; the customer name/email are omitted.
13. **Mono v2 payload + units** — `GET /v2/accounts/:id` returns
    `data.account{ id, name, account_number, currency, balance, institution }`
    and balances/amounts are minor units (kobo); the adapter maps the nested
    envelope and converts to Naira before persisting. (Committed as
    `fix(mono)` / `fix(enroll)`.)
14. **Phase 6 UI is hand-rolled Tailwind v4** — screens, shells, sidebar and
    login are built with plain Tailwind classes + native `fetch`/cookie
    sessions. **No new dependencies**: no shadcn/ui, no component library, no
    charts library; the 9 tiles render numbers with status accents only.
15. **Dashboard login is a standard form only** — email + password via
    `POST /api/auth/login` (httpOnly cookie session). No demo-bank quick-login
    cards.
16. **New admin API surface for Phase 6** —
    `GET /api/transactions` (tenant-scoped, paginated, filterable) backs the
    Transactions screen, and `GET/PATCH /api/bank/profile` (bank name/logo)
    backs the Settings screen. Both are added ahead of their UI commits.
17. **Dev Console is a hidden `/dev` route** — reachable by direct URL only; it
    is **not** in the sidebar/nav and has no public link. Reuses the mock
    Termii/Mono patterns for demoing only.
    > **Superseded by amendment 18 (Phase 7).**
18. **Dev Console = its own login-gated zone (Phase 7).** Replaces the
    ride-on-admin-session approach in 17:
    - New `dev` `AdminRole` + `AuditActorType`, seeded as
      `dev@octavechime.test` / `Password123!`, independent of bank/platform
      admins.
    - Own session cookie `oc_dev_session`, own `/dev/login` page, and a `/dev`
      route group **outside** `(dashboard)`. The admin cookie never unlocks
      `/dev`; the dev cookie never unlocks `/overview` or the admin screens.
      `requireDevAuth` guards a dedicated **`/api/dev/*` surface** (auth/me,
      banks, customers, transactions/simulate, summary/run, metrics, message
      transcript, session reset). Admin endpoints are untouched.
    - **Smart simulation**: the simulate form has linked Bank ↔ Customer
      selectors — the bank list narrows customers to that bank (`?bankId=`),
      and picking a customer sets Bank to the customer's own bank. `simulate`
      accepts an optional `bankId` that the server validates against the
      customer's bank (authoritative "which bank it is sent to").
    - **WhatsApp simulator**: dev-only panel that drives the *real* inbound
      path — it POSTs the exact Termii webhook shape to `/webhooks/termii`
      (proxied by a Next `/webhooks/*` rewrite) and reads the thread back from
      `botMessage`. Sender phone defaults to a fresh number (`2348030000000`)
      for clean enrollments, with quick-fill for seeded customers.
      Quick-command chips (`START · 1–4 · YES · PAUSE · RESUME · STOP · NO ·
      HELP`) fill the input, never auto-send. The panel is disabled with a
      warning when `TERMII_MODE=live` so it cannot message real numbers.
      Transcript polls every ~2s; bot-issued enroll links render clickable.
    - **Phase 7 runbook**: drive the full 24-step demo flow (§9) using the
      WhatsApp simulator as the customer surface + the admin UI/API as the
      bank surface; script each §17 acceptance item; sweep empty/loading/error
      states across every screen. Gate: every §17 item passes **without manual
      DB edits**.

---

## 5. Confirmed Assumptions

- **Dev-only console** at a hidden `/dev` route (no nav/sidebar entry, direct
  URL only) — renders live views of the mocked inbound/outbound bot
  conversation, transaction simulation, and summary run for debugging and demo
  fallback. Not linked from any visible surface.
- **Seed data**: 4 banks (Zenith, Access, GTBank, UBA), 4 bank admins,
  4 customers pre-linked with seeded transactions/notifications (Adaeze Okafor,
  Tunde Balogun, Chiamaka Eze, Ibrahim Musa) so dashboards are never empty —
  plus real customers arriving via the bot.
- **Auth**: JWT in httpOnly cookie; roles limited to `platform_admin` vs
  `bank_admin` (no MFA/RBAC depth in the MVP).
- **Git**: `git init` in the project root to track progress and allow reverts.
- **Live Termii switch** requires no code change — config only.
- **Live Mono switch** requires no code change — config only (`MONO_MODE`).
- **API folder structure follows FastAPI-style layering** (core/db/models/schemas/
  services/routes/workers/adapters) with enforced import rules — see §2.
  `src/models/` = domain types + enums + Prisma→domain mappers (Prisma schema
  stays the DB source of truth). `web/` stays idiomatic Next.js.

---

## 6. Phase-by-Phase Build (mapped to spec §14)

| # | Phase | Deliverables | Acceptance gate | Est. |
|---|---|---|---|---|
| 0 | Scaffold | FastAPI-style `api/src/` tree (§2) + `web/` + `api/scripts/`, Prisma init, Neon connected, `.env.example`, basic layout/navigation, git init | both apps `pnpm dev`, DB ping succeeds | 2h |
| 1 | Data layer | 8 schemas (+ §4 corrections), migration, seeds (banks/admins/customers/transactions/notifications) | Prisma Studio shows seeded tenants | 3h |
| 2 | Admin API + auth | login, JWT, platform admin, tenant isolation, dashboard metrics, customers CRUD, notifications list | admin can only query own bank's rows | 5h |
| 3 | Termii + bot | adapter (mock/live), `POST /webhooks/termii`, bot engine state machine, secure token service, `scripts/mock-inbound.js` | `mock-inbound.js START` → full enrollment → secure link issued, replies logged | 6h |
| 4 | Mono sandbox + txns | real Connect linking (widget `code` exchange → `LinkedAccount mono_live`), minimal `/enroll/[token]` page, `off`-mode demo catalog fallback, debit/credit triggers | sandbox link → account active → trigger debit → notification row `sent` | 5h |
| 5 | Controls + summary | `PAUSE/RESUME/STOP/START/HELP/PRIVACY/RELINK/BALANCE`, confirmation prompts, re-consent link, cron 21:00 Lagos, Run Now, audit log | opted-out receives no alerts; summary deduped per customer/date | 5h |
| 6 | UI (all screens) | login, dashboard (9 required tiles), customers, transactions, notifications, settings, `/enroll`, `/consent`, `/status`, dev console | mobile responsiveness check, §15 style compliance | 10h |
| 7 | E2E + polish | script through all 24 demo steps + full §17 checklist; empty/loading/error states | every §17 item passes without manual DB edits | 5h |
| 8 | Deploy | Vercel web, Render API (blueprint + cron), Neon `production` branch, env vars, README, webhook handoff — runbook §8 | public enrollment link works end-to-end | 4h |

**Total ≈ 45h with buffer.** Critical path depends on external readiness:
Neon connection string, Render/Vercel accounts connected, and (later) Termii
device + webhook configuration.

---

## 7. Git & GitHub Workflow

### Branches

- **`main`** — production-ready only. Advances only at phase milestones when the
  build is demo-ready. No broken or unreviewed code lands here.
- **`develop`** — default working branch; integration target for all work
  (features, bug fixes, hotfixes, updates, refactors — list not exhaustive).
- **`type/short-description`** — cut from `develop` per unit of work whenever
  the situation requires it:
  - `feature/` — new capability
  - `fix/` — bug fix
  - `hotfix/` — urgent production fix
  - `refactor/` — restructuring without behaviour change
  - `update/` — dependency/config/doc updates
  - `chore/` — scaffolding, tooling, housekeeping

### Branch lifecycle

1. Cut from an up-to-date `develop`.
2. Commit incrementally with Conventional Commits.
3. Merge back into `develop` when the unit of work passes its acceptance gate.
4. Delete the branch after merge.
5. `main` advances only at milestones (end of phase / deploy-ready state).

### Merge decision rule (into `develop`)

- **Merge commit** — branch history is clean and logical AND changes are large
  enough to warrant preserving the detailed steps (e.g. a whole phase's work).
- **Squash merge** — changes are minor, or history is littered with tiny
  incremental commits (chores, typo fixes, WIP cleanup) — keep history tidy.
- Judged case by case at merge time.

### Commit messages — Conventional Commits

```
type(scope): message
```
Types: `feat`, `fix`, `chore`, `refactor`, `docs`, `test`, `style`,
`perf`, `build`, `ci`

Examples:
```
feat(auth): bank admin email/password login with JWT cookie
fix(summary): prevent duplicate daily summary per customer/date
chore(env): add Termii placeholder env template
```

### Review gate (mandatory)

No commit happens without user sign-off.

1. At each checkpoint I stop and notify: branch, scope of work, planned
   commit message(s).
2. The user reviews the changes directly in their code editor — no
   AI-generated review write-up.
3. Feedback → I revise and re-present. Approval → I commit and continue.
4. Checkpoints occur at meaningful sub-task boundaries and before any
   branch merge — not after every single commit.

### Suggested phase → branch mapping

| Phase | Branch |
|---|---|
| 0 Scaffold | `chore/scaffold` |
| 1 Data layer | `feature/data-layer` |
| 2 Admin API + auth | `feature/admin-api-auth` |
| 3 Termii + bot | `feature/whatsapp-bot` |
| 4 Mono sandbox + txns | `feature/mono-sandbox` |
| 5 Controls + summary | `feature/customer-controls-summary` |
| 6 Admin UI | `feature/admin-ui` |
| 7 E2E + polish | `fix/e2e-acceptance` |
| 8 Deploy | `chore/deploy` |

`fix/`, `hotfix/`, `refactor/` branches cut as needed within any phase.

---

## 8. Phase 8 Deployment Runbook

Phase 8 is config/ops-heavy by design: **deploying requires no provider-code
rewrite** — every provider sits behind an adapter and an env switch (Termii
`TERMII_MODE`, Mono `MONO_MODE`, DB via `DATABASE_URL`). Nothing below depends on
code changes beyond the small `chore/deploy` commit in §8.4.

### 8.1 Scope and gate

- **Branch:** `chore/deploy`, cut from an accepted `develop` (Phases 5–7 complete).
- **Gate:** "public enrollment link works end-to-end" — a real browser opens a
  Vercel-hosted enrollment link, links a bank account (sandbox or `off`), and the
  admin triggers a debit that produces a `sent` notification.
- **Budget:** all free tiers (Vercel, Render, Neon). Accepted trade-offs: Render
  free web service sleeps (~50 s cold start on first hit) and free cron runs at
  most once per day (fits the 21:00 daily summary); Neon free compute autosuspends
  when idle.

### 8.2 Target topology & wiring

```
Browser ──▶ Vercel (web: /enroll/[token], bank admin UI)
               │  NEXT_PUBLIC_API_URL = https://<render>.onrender.com
               ▼
          Render (Express API: /api/*, /webhooks/termii, /cron/daily-summary)
               │  DATABASE_URL (Neon pooled)
               ▼
          Neon Postgres ("silent-bread-91848118", branch "production")

Render Cron Job (free, once/day 21:00) ──▶ POST /cron/daily-summary
       Authorization: Bearer CRON_SECRET
```

- Enrollment links are minted with `config.appUrl` (`services/bot.ts`) →
  **`APP_URL` must be the Vercel domain**.
- Production auth cookie is `secure` + `SameSite=None` (`core/security.ts`) —
  cross-site HTTPS works; the admin UI must fetch with `credentials: "include"`.

### 8.3 Environment contract

**`api` (Render dashboard):**

| Var | Value |
|---|---|
| `NODE_ENV` | `production` |
| `APP_URL` | `https://<vercel>.vercel.app` (CORS + enroll links + cookie) |
| `API_URL` | `https://<render>.onrender.com` |
| `DATABASE_URL` | Neon **pooled** conn string (`production` branch; host contains `-pooler`) |
| `DATABASE_URL_UNPOOLED` | Neon **direct** conn string (used by Prisma Migrate) |
| `SESSION_SECRET`, `JWT_SECRET` | freshly generated random strings (not placeholders) |
| `TERMII_MODE` | `mock` for the demo; `live` + `TERMII_API_KEY`/`TERMII_DEVICE_ID` at go-live |
| `MONO_MODE` | `off` (key-less demo) or `sandbox`/`live` (Mono keys) |
| `MONO_PUBLIC_KEY`, `MONO_SECRET_KEY` | Mono Connect app keys |
| `CRON_SECRET` | shared bearer token for the cron endpoint |
| `PORT` | set by Render |

**`web` (Vercel dashboard):**

| Var | Value |
|---|---|
| `NEXT_PUBLIC_API_URL` | `https://<render>.onrender.com` |
| `NEXT_PUBLIC_MONO_PUBLIC_KEY` | Mono Connect **public** key (browser-safe); empty = simulated linking |

### 8.4 Code/artifact deliverables (`chore/deploy` commit)

1. `api/package.json`: add `"engines": { "node": ">=22" }`; change build →
   `"build": "prisma generate && tsc -p tsconfig.json"` (guarantees client
   regeneration on the Render build host).
2. `web/package.json`: matching `engines` (Next 16 requires modern Node).
3. `api/render.yaml` blueprint (committed IaC):
   - **Web service** (root `api`, Node 22 via Corepack):
     - build: `corepack enable && pnpm install --frozen-lockfile && pnpm build`
     - `preDeployCommand: pnpm db:deploy`
     - start: `node dist/server.js`; health check path `/api/health`
   - **Cron job** (free, 1/day): schedule `0 21 * * *`, command
     `curl -m 60 -X POST https://<render>/cron/daily-summary -H "Authorization: Bearer $CRON_SECRET"`
     (endpoint delivered by Phase 5).
4. Root `README.md` (setup + env tables + deploy + ops verification) — replaces
   boilerplate `web/README.md` as the entry doc.

### 8.5 Infrastructure steps

1. **GitHub:** `gh repo create <name> --private --source . --remote origin --push`
   → `develop` published (push-to-deploy source for Vercel + Render).
2. **Neon:** `neon branches create production` in existing project
   `silent-bread-91848118` (`.neon` already links it) → copy pooled + direct URLs.
3. **Vercel:** import repo, root directory `web`, Framework Next.js, set web env
   vars. Free plan.
4. **Render:** apply `render.yaml` blueprint; key the API service to `api`; paste
   the `api` env table; deploy.

### 8.6 First deploy + seed

- Apply blueprint → verify `GET /api/health` → `{ ok: true, db: "ok" }`.
- Migrations run via `preDeployCommand` (`pnpm db:deploy`).
- Seed exactly **once manually** with prod env (`pnpm db:seed`) so the four demo
  banks/admins/customers exist — seeding is never chained to deploys.
- Deploy Vercel → confirm `/enroll/<token>` renders (ƒ dynamic route) and a bank
  admin login round-trips with the production cookie.

### 8.7 Verification checklist (acceptance gate)

- [ ] `/api/health` ok + Render logs show boot and mock-adapter outbound lines.
- [ ] `mock-inbound.js` against the **Render** URL → bot replies and mints a
      token → `https://<vercel>/enroll/<token>` opens in a browser → sandbox/`off`
      link completes → `LinkedAccount` row `active`.
- [ ] Admin simulates a debit on prod → `Transaction` created, balance updated,
      `Notification` status `sent`.
- [ ] Cron job fires (or manual trigger) → deduped `DailySummary` rows created.
- [ ] Final handoff: paste `https://<render>/webhooks/termii` into the Termii
      console webhook config (no-op while `TERMII_MODE=mock`).

### 8.8 Sequencing

Front-loadable **now** (not blocked by Phases 5–7): GitHub repo + remote,
Vercel/Render/Neon accounts, `production` branch, secret generation. The
`chore/deploy` commit and the deploy itself run only after Phase 7 acceptance;
then `main` advances at the milestone.

---

## 9. Demo Flow Coverage

The 24-step presentation script (spec §9) maps to:

- Steps 1–5 → Phase 2 (login, dashboard, multi-bank seed)
- Steps 6–16 → Phases 3–4 (real WhatsApp bot enrollment → secure link → Mono sandbox link → active)
- Steps 17–20 → Phase 4 (debit/credit triggers + real/mock alerts)
- Steps 21–22 → Phase 5 (Run Daily Summary Now + summary contents)
- Steps 23–24 → Phases 5–7 (STOP → START re-consent + dashboard delivery logs)

---

## 10. Risks

- **Free-tier flakiness** — Render free web service sleeps (cold start) and runs
  cron at most once/day; Neon autosuspend adds latency on idle wakes. Acceptable
  for the demo; a Render Starter instance removes them.
- **48 hours with no scope cuts** — Phase 6 (UI) is the largest single block.
  If we slip, a cut-list will be presented and approved **before** anything is cut.
- **No live WhatsApp until a Termii device is provisioned** — real delivery is
  untestable until then; mock mode makes every other flow fully demonstrable.
- **24-hour free-form window** — proactive alerts/summaries sent outside the
  window will fail unless `TERMII_TEMPLATE_ID` is configured; notifications will
  correctly record `failed` status in that case.
- **Two-service deploy** (Vercel + Render) — must be completed late in the
  schedule; local E2E must pass first.
- **Mono sandbox keys are external** — linking needs a free app.mono.com
  `Connect` app's test public/secret keys; sandbox API calls are free, the
  live wallet/KYB only matters at go-live. `MONO_MODE=off` keeps the demo
  self-contained if Mono is unreachable.

---

## 11. Reference Material

| File | Role |
|---|---|
| `OCTAVE_CHIME_IMPLEMENTATION_PLAN.md` | Product spec: data model, message templates, security rules, demo script, acceptance criteria |
| `octave-chime-platform.html` | Earlier single-bank prototype — visual/interaction reference only |
| `octave-chime-whatsapp.zip` | Prior Express WhatsApp sender — structural reference only (Meta API, superseded by Termii) |
| Termii docs | `developer.termii.com` — free-form, templates, incoming webhook payloads |
