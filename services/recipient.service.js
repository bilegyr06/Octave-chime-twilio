"use strict";
const { query } = require("../db/pool");
const { httpError } = require("../lib/errors");
const { toE164 } = require("../messaging/twilio");
const { dispatch } = require("./dispatch");

const num = (v) => (v == null ? 0 : Number(v));
const ROLES = ["owner", "joint-holder", "signatory", "accountant", "guardian", "viewer"];

function mapRecipient(r) {
  if (!r) return null;
  return {
    id: r.id,
    accountId: r.account_id,
    name: r.name,
    waNumber: r.wa_number,
    role: r.role,
    isHolder: r.is_holder,
    consentStatus: r.consent_status,
    optOut: r.opt_out,
    alertScope: r.alert_scope,
    threshold: num(r.threshold),
    eodOptIn: r.eod_opt_in,
  };
}

async function list(accountId) {
  const { rows } = await query(
    "SELECT * FROM oc_recipient WHERE account_id=$1 ORDER BY is_holder DESC, id",
    [accountId]
  );
  return rows.map(mapRecipient);
}

async function get(id) {
  const { rows } = await query("SELECT * FROM oc_recipient WHERE id=$1", [id]);
  return mapRecipient(rows[0]);
}

async function findByWa(waInput) {
  const wa = toE164(waInput);
  if (!wa) return null;
  const { rows } = await query(
    "SELECT * FROM oc_recipient WHERE wa_number=$1 ORDER BY id LIMIT 1",
    [wa]
  );
  return mapRecipient(rows[0]);
}

function optInBody(holderName) {
  return (
    `Aster Bank: ${holderName} wants to send you account transaction alerts on WhatsApp.\n` +
    `Reply YES to accept, STOP to decline. Reply HELP for help.`
  );
}

async function add(accountId, input) {
  const name = String(input.name || "").trim().slice(0, 80);
  const wa = toE164(input.waNumber);
  if (!name) throw httpError("Recipient name is required.", 400);
  if (!wa) throw httpError("A valid WhatsApp number is required.", 400);
  const role = ROLES.includes(input.role) ? input.role : "viewer";
  const scope = input.alertScope === "threshold" ? "threshold" : "all";
  const threshold = num(input.threshold);
  const eod = input.eodOptIn === false ? false : true;

  let row;
  try {
    const { rows } = await query(
      `INSERT INTO oc_recipient
        (account_id,name,wa_number,role,consent_status,alert_scope,threshold,eod_opt_in)
       VALUES ($1,$2,$3,$4,'pending',$5,$6,$7) RETURNING *`,
      [accountId, name, wa, role, scope, threshold, eod]
    );
    row = rows[0];
  } catch (e) {
    if (e.code === "23505") {
      throw httpError("That WhatsApp number is already a recipient on this account.", 409);
    }
    throw e;
  }

  const { rows: accRows } = await query("SELECT holder_name FROM oc_account WHERE id=$1", [accountId]);
  const holderName = (accRows[0] && accRows[0].holder_name) || "the account holder";
  await dispatch({
    recipientId: row.id,
    toNumber: row.wa_number,
    kind: "optin",
    body: optInBody(holderName),
    idemKey: `optin:${row.id}`,
  });

  return mapRecipient(row);
}

async function update(id, patch) {
  const sets = [];
  const vals = [];
  let i = 1;
  if (typeof patch.name === "string" && patch.name.trim()) {
    sets.push(`name=$${i++}`);
    vals.push(patch.name.trim().slice(0, 80));
  }
  if (patch.role && ROLES.includes(patch.role)) {
    sets.push(`role=$${i++}`);
    vals.push(patch.role);
  }
  if (patch.alertScope && ["all", "threshold"].includes(patch.alertScope)) {
    sets.push(`alert_scope=$${i++}`);
    vals.push(patch.alertScope);
  }
  if (patch.threshold != null) {
    sets.push(`threshold=$${i++}`);
    vals.push(num(patch.threshold));
  }
  if (typeof patch.eodOptIn === "boolean") {
    sets.push(`eod_opt_in=$${i++}`);
    vals.push(patch.eodOptIn);
  }
  if (sets.length) {
    sets.push("updated_at=now()");
    vals.push(id);
    const { rows } = await query(
      `UPDATE oc_recipient SET ${sets.join(", ")} WHERE id=$${i} RETURNING *`,
      vals
    );
    if (!rows.length) throw httpError("Recipient not found.", 404);
    return mapRecipient(rows[0]);
  }
  return get(id);
}

async function remove(id) {
  const { rowCount } = await query("DELETE FROM oc_recipient WHERE id=$1", [id]);
  if (!rowCount) throw httpError("Recipient not found.", 404);
  return { ok: true };
}

async function markConsent(id, action) {
  const optedOut = action === "opt_out";
  await query(
    `UPDATE oc_recipient
        SET consent_status=$1, opt_out=$2, updated_at=now()
      WHERE id=$3`,
    [optedOut ? "opted_out" : "granted", optedOut, id]
  );
  await query("INSERT INTO oc_consent (recipient_id, action, source) VALUES ($1,$2,'whatsapp')", [
    id,
    action,
  ]);
  return get(id);
}

async function upsertHolder(accountId, waInput) {
  const wa = toE164(waInput);
  if (!wa) return null;
  const { rows: accRows } = await query("SELECT holder_name FROM oc_account WHERE id=$1", [accountId]);
  const name = (accRows[0] && accRows[0].holder_name) || "Account holder";
  const { rows } = await query(
    `INSERT INTO oc_recipient
        (account_id,name,wa_number,role,is_holder,consent_status,eod_opt_in)
     VALUES ($1,$2,$3,'owner',true,'granted',true)
     ON CONFLICT (account_id, wa_number) DO UPDATE
        SET is_holder=true, role='owner', consent_status='granted', opt_out=false, updated_at=now()
     RETURNING *`,
    [accountId, name, wa]
  );
  await query(
    "UPDATE oc_recipient SET is_holder=false WHERE account_id=$1 AND wa_number<>$2 AND is_holder=true",
    [accountId, wa]
  );
  return mapRecipient(rows[0]);
}

// Recipients eligible for a transaction alert of the given amount.
async function eligibleFor(accountId, amount) {
  const { rows } = await query(
    `SELECT * FROM oc_recipient
      WHERE account_id=$1 AND opt_out=false AND consent_status='granted'`,
    [accountId]
  );
  return rows
    .map(mapRecipient)
    .filter((r) => r.alertScope !== "threshold" || Number(amount) >= r.threshold);
}

async function eligibleForSummary(accountId) {
  const { rows } = await query(
    `SELECT * FROM oc_recipient
      WHERE account_id=$1 AND opt_out=false AND consent_status='granted' AND eod_opt_in=true`,
    [accountId]
  );
  return rows.map(mapRecipient);
}

module.exports = {
  ROLES,
  mapRecipient,
  list,
  get,
  findByWa,
  add,
  update,
  remove,
  markConsent,
  upsertHolder,
  eligibleFor,
  eligibleForSummary,
};
