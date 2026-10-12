"use strict";
const express = require("express");
const router = express.Router();
const ledger = require("../services/ledger.service");
const recipients = require("../services/recipient.service");
const ah = require("../lib/asyncHandler");

router.get(
  "/",
  ah(async (_req, res) => {
    const id = await ledger.defaultAccountId();
    const account = await ledger.getAccount(id);
    const totals = await ledger.getDayTotals(id);
    res.json({ ok: true, account: { ...account, ...totals } });
  })
);

// Switch account type (individual/joint/corporate) and/or set holder number.
router.patch(
  "/",
  ah(async (req, res) => {
    const id = await ledger.defaultAccountId();
    const body = req.body || {};
    await ledger.updateAccount(id, body);
    if (typeof body.holderWa === "string") {
      await recipients.upsertHolder(id, body.holderWa);
    }
    res.json({ ok: true, account: await ledger.getAccount(id) });
  })
);

// Reset the demo day: clears the day's ledger + summaries, restores opening balance.
router.post(
  "/reset",
  ah(async (_req, res) => {
    const id = await ledger.defaultAccountId();
    const account = await ledger.resetDay(id);
    res.json({ ok: true, account });
  })
);

module.exports = router;
