"use strict";
const express = require("express");
const router = express.Router();
const config = require("../config");
const { healthy } = require("../db/pool");
const { sendMessage } = require("../messaging/twilio");
const ah = require("../lib/asyncHandler");

router.get(
  "/health",
  ah(async (_req, res) => {
    res.json({
      ok: true,
      db: await healthy(),
      twilio: config.twilio.configured,
      publicUrl: Boolean(config.twilio.publicUrl),
      eod: { hour: config.eod.hour, tz: config.eod.tz },
    });
  })
);

// Sandbox proof-of-delivery. Sends one real WhatsApp message.
router.post(
  "/send-test",
  ah(async (req, res) => {
    const to = req.body && req.body.to;
    const data = await sendMessage({
      to,
      body: "Aster Bank test message \u2014 your WhatsApp alerts are connected.",
    });
    res.json({ ok: true, sid: data.sid, status: data.status, to: data.to });
  })
);

module.exports = router;
