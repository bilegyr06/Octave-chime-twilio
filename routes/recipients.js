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
    res.json({ ok: true, recipients: await recipients.list(id) });
  })
);

// Add a recipient and trigger the real WhatsApp double opt-in.
router.post(
  "/",
  ah(async (req, res) => {
    const id = await ledger.defaultAccountId();
    const recipient = await recipients.add(id, req.body || {});
    res.status(201).json({ ok: true, recipient });
  })
);

router.patch(
  "/:id",
  ah(async (req, res) => {
    const recipient = await recipients.update(Number(req.params.id), req.body || {});
    res.json({ ok: true, recipient });
  })
);

router.delete(
  "/:id",
  ah(async (req, res) => {
    await recipients.remove(Number(req.params.id));
    res.json({ ok: true });
  })
);

module.exports = router;
