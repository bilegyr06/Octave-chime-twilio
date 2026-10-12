"use strict";
const express = require("express");
const router = express.Router();
const ledger = require("../services/ledger.service");
const notification = require("../services/notification.service");
const ah = require("../lib/asyncHandler");

router.get(
  "/",
  ah(async (req, res) => {
    const id = await ledger.defaultAccountId();
    const transactions = await ledger.listTransactions(id, req.query.limit);
    res.json({ ok: true, transactions });
  })
);

// Post a transaction, then fan out real alerts to eligible recipients.
router.post(
  "/",
  ah(async (req, res) => {
    const id = await ledger.defaultAccountId();
    const account = await ledger.getAccount(id);
    const { transaction, duplicate } = await ledger.postTransaction({
      accountId: id,
      ...(req.body || {}),
    });

    let notifications = [];
    if (!duplicate) {
      notifications = await notification.notifyTransaction({
        accountId: id,
        accountNumber: account.number,
        transaction,
      });
    }

    res.json({ ok: true, transaction, notifications, duplicate });
  })
);

module.exports = router;
