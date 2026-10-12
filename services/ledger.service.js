"use strict";
const { query, pool } = require("../db/pool");
const { businessDate } = require("../lib/format");
const { httpError } = require("../lib/errors");

const num = (v) => (v == null ? 0 : Number(v));

function mapAccount(a) {
  if (!a) return null;
  return {
    id: a.id,
    number: a.number,
    type: a.type,
    currency: a.currency,
    holderName: a.holder_name,
    holderWa: a.holder_wa,
    openingBalance: num(a.opening_balance),
    balance: num(a.balance),
  };
}

function mapTxn(t) {
  return {
    id: t.id,
    direction: t.direction,
    type: t.type,
    amount: num(t.amount),
    party: t.party,
    channel: t.channel,
    ref: t.ref,
    status: t.status,
    balanceAfter: num(t.balance_after),
    postedAt: t.posted_at,
    businessDate: t.business_date,
  };
}

async function defaultAccountId() {
  const { rows } = await query("SELECT id FROM oc_account ORDER BY id LIMIT 1");
  if (!rows.length) throw httpError("No account found. Run `npm run db:setup`.", 500);
  return rows[0].id;
}

async function getAccount(accountId) {
  const { rows } = await query("SELECT * FROM oc_account WHERE id=$1", [accountId]);
  return mapAccount(rows[0]);
}

async function getDayTotals(accountId, date = businessDate()) {
  const { rows } = await query(
    `SELECT
       COUNT(*)::int AS txn_count,
       COALESCE(SUM(CASE WHEN direction='credit' THEN amount ELSE 0 END),0) AS inflow,
       COALESCE(SUM(CASE WHEN direction='debit'  THEN amount ELSE 0 END),0) AS outflow
     FROM oc_transaction WHERE account_id=$1 AND business_date=$2`,
    [accountId, date]
  );
  const r = rows[0];
  return { txnCount: r.txn_count, inflow: num(r.inflow), outflow: num(r.outflow) };
}

async function listTransactions(accountId, limit = 50) {
  const lim = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const { rows } = await query(
    `SELECT * FROM oc_transaction WHERE account_id=$1 ORDER BY posted_at DESC, id DESC LIMIT $2`,
    [accountId, lim]
  );
  return rows.map(mapTxn);
}

function genRef(direction, type) {
  const prefix =
    type === "bill" ? "BIL" : type === "airtime" ? "AIR" : direction === "credit" ? "CR" : "TRF";
  return `${prefix}-${Math.floor(1000000 + Math.random() * 8999999)}`;
}

async function postTransaction(input) {
  const accountId = input.accountId || (await defaultAccountId());
  const direction = input.direction === "credit" ? "credit" : "debit";
  const type = ["transfer", "bill", "airtime", "credit"].includes(input.type)
    ? input.type
    : "transfer";
  const amount = Number(input.amount);
  if (!(amount > 0)) throw httpError("Amount must be greater than zero.", 400);
  const party = String(input.party || "-").slice(0, 120);
  const channel = String(input.channel || "Transaction").slice(0, 60);
  const ref = input.ref ? String(input.ref).slice(0, 60) : null;
  const idem = input.idempotencyKey ? String(input.idempotencyKey).slice(0, 120) : null;

  if (idem || ref) {
    const { rows } = await query(
      `SELECT * FROM oc_transaction
        WHERE ($1::text IS NOT NULL AND idempotency_key=$1)
           OR ($2::text IS NOT NULL AND ref=$2)
        LIMIT 1`,
      [idem, ref]
    );
    if (rows.length) return { transaction: mapTxn(rows[0]), duplicate: true };
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: accRows } = await client.query(
      "SELECT * FROM oc_account WHERE id=$1 FOR UPDATE",
      [accountId]
    );
    if (!accRows.length) throw httpError("Account not found.", 404);
    let balance = num(accRows[0].balance);
    if (direction === "debit") {
      if (balance < amount) {
        throw httpError(`Insufficient balance. Available ${balance.toFixed(2)}.`, 409);
      }
      balance -= amount;
    } else {
      balance += amount;
    }
    const finalRef = ref || genRef(direction, type);
    const bdate = businessDate();
    const { rows: ins } = await client.query(
      `INSERT INTO oc_transaction
        (account_id,direction,type,amount,party,channel,ref,idempotency_key,status,balance_after,business_date)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'posted',$9,$10) RETURNING *`,
      [accountId, direction, type, amount, party, channel, finalRef, idem, balance, bdate]
    );
    await client.query("UPDATE oc_account SET balance=$1 WHERE id=$2", [balance, accountId]);
    await client.query("COMMIT");
    return { transaction: mapTxn(ins[0]), duplicate: false };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

async function updateAccount(accountId, patch) {
  const sets = [];
  const vals = [];
  let i = 1;
  if (patch.type && ["individual", "joint", "corporate"].includes(patch.type)) {
    sets.push(`type=$${i++}`);
    vals.push(patch.type);
  }
  if (typeof patch.holderWa === "string") {
    sets.push(`holder_wa=$${i++}`);
    vals.push(patch.holderWa.trim() || null);
  }
  if (sets.length) {
    vals.push(accountId);
    await query(`UPDATE oc_account SET ${sets.join(", ")} WHERE id=$${i}`, vals);
  }
  return getAccount(accountId);
}

async function resetDay(accountId) {
  const acc = await getAccount(accountId);
  if (!acc) throw httpError("Account not found.", 404);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "DELETE FROM oc_message_log WHERE transaction_id IN (SELECT id FROM oc_transaction WHERE account_id=$1)",
      [accountId]
    );
    await client.query("DELETE FROM oc_daily_summary WHERE account_id=$1", [accountId]);
    await client.query("DELETE FROM oc_transaction WHERE account_id=$1", [accountId]);
    await client.query("UPDATE oc_account SET balance=opening_balance WHERE id=$1", [accountId]);
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
  return getAccount(accountId);
}

module.exports = {
  defaultAccountId,
  getAccount,
  getDayTotals,
  listTransactions,
  postTransaction,
  updateAccount,
  resetDay,
  mapAccount,
  mapTxn,
  num,
};
