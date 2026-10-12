-- Octave Chime schema (Neon Postgres). Idempotent: safe to run repeatedly.

CREATE TABLE IF NOT EXISTS oc_account (
  id              SERIAL PRIMARY KEY,
  number          TEXT NOT NULL,
  type            TEXT NOT NULL DEFAULT 'corporate',
  currency        TEXT NOT NULL DEFAULT 'NGN',
  holder_name     TEXT NOT NULL,
  holder_wa       TEXT,
  opening_balance NUMERIC(14,2) NOT NULL DEFAULT 0,
  balance         NUMERIC(14,2) NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS oc_recipient (
  id             SERIAL PRIMARY KEY,
  account_id     INTEGER NOT NULL REFERENCES oc_account(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  wa_number      TEXT NOT NULL,
  role           TEXT NOT NULL DEFAULT 'viewer',
  is_holder      BOOLEAN NOT NULL DEFAULT false,
  consent_status TEXT NOT NULL DEFAULT 'pending',
  opt_out        BOOLEAN NOT NULL DEFAULT false,
  alert_scope    TEXT NOT NULL DEFAULT 'all',
  threshold      NUMERIC(14,2) NOT NULL DEFAULT 0,
  eod_opt_in     BOOLEAN NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_oc_recipient_account ON oc_recipient(account_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_oc_recipient_wa ON oc_recipient(account_id, wa_number);

CREATE TABLE IF NOT EXISTS oc_consent (
  id           SERIAL PRIMARY KEY,
  recipient_id INTEGER NOT NULL REFERENCES oc_recipient(id) ON DELETE CASCADE,
  action       TEXT NOT NULL,
  source       TEXT NOT NULL DEFAULT 'whatsapp',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_oc_consent_recipient ON oc_consent(recipient_id);

CREATE TABLE IF NOT EXISTS oc_transaction (
  id              SERIAL PRIMARY KEY,
  account_id      INTEGER NOT NULL REFERENCES oc_account(id) ON DELETE CASCADE,
  direction       TEXT NOT NULL,
  type            TEXT NOT NULL,
  amount          NUMERIC(14,2) NOT NULL,
  party           TEXT NOT NULL,
  channel         TEXT NOT NULL,
  ref             TEXT NOT NULL UNIQUE,
  idempotency_key TEXT UNIQUE,
  status          TEXT NOT NULL DEFAULT 'posted',
  balance_after   NUMERIC(14,2) NOT NULL,
  posted_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  business_date   DATE NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_oc_txn_account_date ON oc_transaction(account_id, business_date);

CREATE TABLE IF NOT EXISTS oc_message_log (
  id             SERIAL PRIMARY KEY,
  recipient_id   INTEGER REFERENCES oc_recipient(id) ON DELETE SET NULL,
  transaction_id INTEGER REFERENCES oc_transaction(id) ON DELETE SET NULL,
  summary_date   DATE,
  kind           TEXT NOT NULL,
  to_number      TEXT NOT NULL,
  body           TEXT NOT NULL,
  twilio_sid     TEXT,
  status         TEXT NOT NULL DEFAULT 'pending',
  error_code     TEXT,
  error_message  TEXT,
  idem_key       TEXT UNIQUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_oc_msg_txn ON oc_message_log(transaction_id);
CREATE INDEX IF NOT EXISTS idx_oc_msg_sid ON oc_message_log(twilio_sid);

CREATE TABLE IF NOT EXISTS oc_daily_summary (
  id            SERIAL PRIMARY KEY,
  account_id    INTEGER NOT NULL REFERENCES oc_account(id) ON DELETE CASCADE,
  business_date DATE NOT NULL,
  opening       NUMERIC(14,2) NOT NULL,
  txn_count     INTEGER NOT NULL,
  volume        NUMERIC(14,2) NOT NULL,
  inflow        NUMERIC(14,2) NOT NULL,
  outflow       NUMERIC(14,2) NOT NULL,
  net           NUMERIC(14,2) NOT NULL,
  closing       NUMERIC(14,2) NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(account_id, business_date)
);
