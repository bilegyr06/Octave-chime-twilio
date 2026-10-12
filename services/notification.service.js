"use strict";
const recipients = require("./recipient.service");
const { dispatch } = require("./dispatch");
const { naira, hhmm, dayLabel } = require("../lib/format");

function buildAlertBody(txn, accountNumber) {
  const isCredit = txn.direction === "credit";
  const when = new Date(txn.postedAt);
  return [
    `Aster Bank \u2014 ${isCredit ? "Credit" : "Debit"} Alert`,
    `Amount: ${naira(txn.amount)}`,
    `${isCredit ? "From" : "To"}: ${txn.party}`,
    `Acct: ${accountNumber}`,
    `Channel: ${txn.channel}`,
    `Ref: ${txn.ref}`,
    `Balance: ${naira(txn.balanceAfter)}`,
    `Time: ${hhmm(when)}, ${dayLabel(when)}`,
    "",
    "Reply HELP for help \u00b7 STOP to opt out",
  ].join("\n");
}

// Fan out a transaction alert to every eligible (consented, in-scope) recipient.
async function notifyTransaction({ accountId, accountNumber, transaction }) {
  const eligible = await recipients.eligibleFor(accountId, transaction.amount);
  const results = [];
  for (const r of eligible) {
    const body = buildAlertBody(transaction, accountNumber);
    const res = await dispatch({
      recipientId: r.id,
      toNumber: r.waNumber,
      kind: "alert",
      body,
      transactionId: transaction.id,
      idemKey: `txn:${transaction.id}:rcpt:${r.id}`,
    });
    results.push({ recipientId: r.id, name: r.name, role: r.role, ...res });
  }
  return results;
}

module.exports = { notifyTransaction, buildAlertBody };
