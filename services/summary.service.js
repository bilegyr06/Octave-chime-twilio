"use strict";
const { query } = require("../db/pool");
const ledger = require("./ledger.service");
const recipients = require("./recipient.service");
const { dispatch } = require("./dispatch");
const { naira, dayLabel } = require("../lib/format");

// Opening is derived (closing - net) since we do not store per-move balances.
async function compute(accountId, date) {
  const acc = await ledger.getAccount(accountId);
  if (!acc) {
    const e = new Error("Account not found.");
    e.statusCode = 404;
    throw e;
  }
  const totals = await ledger.getDayTotals(accountId, date);
  const net = totals.inflow - totals.outflow;
  const closing = acc.balance;
  const opening = closing - net;
  const volume = totals.inflow + totals.outflow;
  return {
    accountId,
    accountNumber: acc.number,
    businessDate: date,
    opening,
    txnCount: totals.txnCount,
    volume,
    inflow: totals.inflow,
    outflow: totals.outflow,
    net,
    closing,
  };
}

function buildSummaryBody(s) {
  const sign = s.net < 0 ? "-" : "+";
  const d = new Date(`${s.businessDate}T12:00:00Z`);
  return [
    "Aster Bank \u2014 Daily Summary",
    dayLabel(d),
    `Acct: ${s.accountNumber}`,
    "",
    `Opening balance: ${naira(s.opening)}`,
    `Inflows: ${naira(s.inflow)}`,
    `Outflows: ${naira(s.outflow)}`,
    `Net movement: ${sign}${naira(Math.abs(s.net))}`,
    `Closing balance: ${naira(s.closing)}`,
    "",
    `Transactions: ${s.txnCount}`,
    `Volume (gross): ${naira(s.volume)}`,
  ].join("\n");
}

// Idempotent per account/business date: the summary row is upserted and each
// recipient message is de-duplicated by its idem_key.
async function run(accountId, date) {
  const summary = await compute(accountId, date);
  await query(
    `INSERT INTO oc_daily_summary
       (account_id,business_date,opening,txn_count,volume,inflow,outflow,net,closing)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (account_id, business_date) DO UPDATE SET
       opening=EXCLUDED.opening, txn_count=EXCLUDED.txn_count, volume=EXCLUDED.volume,
       inflow=EXCLUDED.inflow, outflow=EXCLUDED.outflow, net=EXCLUDED.net, closing=EXCLUDED.closing`,
    [
      accountId,
      date,
      summary.opening,
      summary.txnCount,
      summary.volume,
      summary.inflow,
      summary.outflow,
      summary.net,
      summary.closing,
    ]
  );

  const list = await recipients.eligibleForSummary(accountId);
  const body = buildSummaryBody(summary);
  const notifications = [];
  for (const r of list) {
    const res = await dispatch({
      recipientId: r.id,
      toNumber: r.waNumber,
      kind: "summary",
      body,
      summaryDate: date,
      idemKey: `summary:${accountId}:${date}:rcpt:${r.id}`,
    });
    notifications.push({ recipientId: r.id, name: r.name, ...res });
  }
  return { summary, notifications };
}

module.exports = { compute, run, buildSummaryBody };
