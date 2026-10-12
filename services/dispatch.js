"use strict";
const { query } = require("../db/pool");
const { sendMessage } = require("../messaging/twilio");

// Persist-then-send. The unique idem_key makes dispatch idempotent: a retried
// event that would produce the same message is skipped instead of re-sent.
async function dispatch({
  recipientId = null,
  toNumber,
  kind,
  body,
  transactionId = null,
  summaryDate = null,
  idemKey = null,
}) {
  let logId;
  try {
    const { rows } = await query(
      `INSERT INTO oc_message_log
        (recipient_id, transaction_id, summary_date, kind, to_number, body, status, idem_key)
       VALUES ($1,$2,$3,$4,$5,$6,'pending',$7) RETURNING id`,
      [recipientId, transactionId, summaryDate, kind, toNumber, body, idemKey]
    );
    logId = rows[0].id;
  } catch (e) {
    if (e.code === "23505") return { skipped: true, reason: "duplicate" };
    throw e;
  }

  try {
    const data = await sendMessage({ to: toNumber, body });
    await query(
      "UPDATE oc_message_log SET twilio_sid=$1, status=$2, updated_at=now() WHERE id=$3",
      [data.sid || null, data.status || "queued", logId]
    );
    return { ok: true, sid: data.sid || null, status: data.status || "queued" };
  } catch (e) {
    await query(
      "UPDATE oc_message_log SET status='failed', error_code=$1, error_message=$2, updated_at=now() WHERE id=$3",
      [String((e.details && e.details.code) || ""), e.message, logId]
    );
    return {
      ok: false,
      error: e.message,
      code: e.details && e.details.code,
      statusCode: e.statusCode || 502,
    };
  }
}

module.exports = { dispatch };
