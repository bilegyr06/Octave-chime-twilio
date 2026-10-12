"use strict";
const express = require("express");
const router = express.Router();
const config = require("../config");
const { validateSignature, requestUrl } = require("../messaging/twilio");
const { handleInbound } = require("../services/inbound.service");
const { query } = require("../db/pool");
const ah = require("../lib/asyncHandler");

function signatureOk(req) {
  if (!config.twilio.authToken) return true; // unconfigured (dev): skip validation
  const sig = req.headers["x-twilio-signature"];
  return validateSignature(requestUrl(req), req.body || {}, sig);
}

// Inbound WhatsApp replies: YES / STOP / RESUME / HELP
router.post(
  "/inbound",
  ah(async (req, res) => {
    if (!signatureOk(req)) return res.status(403).send("Invalid signature");
    await handleInbound({ from: req.body.From, body: req.body.Body });
    res.status(200).type("text/xml").send("<Response/>");
  })
);

// Delivery-status callback: update the message log by Twilio SID.
router.post(
  "/status",
  ah(async (req, res) => {
    if (!signatureOk(req)) return res.status(403).send("Invalid signature");
    const sid = req.body && req.body.MessageSid;
    if (sid) {
      await query(
        `UPDATE oc_message_log
            SET status=$1, error_code=$2, error_message=$3, updated_at=now()
          WHERE twilio_sid=$4`,
        [req.body.MessageStatus || "unknown", req.body.ErrorCode || null, req.body.ErrorMessage || null, sid]
      );
    }
    res.sendStatus(204);
  })
);

module.exports = router;
