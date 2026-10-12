"use strict";
const express = require("express");
const router = express.Router();
const ledger = require("../services/ledger.service");
const summary = require("../services/summary.service");
const { businessDate } = require("../lib/format");
const ah = require("../lib/asyncHandler");

// POST from the app; GET so Vercel Cron (GET requests) can trigger the same run.
router.all(
  "/run",
  ah(async (req, res) => {
    const id = await ledger.defaultAccountId();
    const date = (req.body && req.body.businessDate) || businessDate();
    const result = await summary.run(id, date);
    res.json({ ok: true, ...result });
  })
);

module.exports = router;
