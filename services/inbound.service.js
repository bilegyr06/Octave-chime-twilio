"use strict";
const recipients = require("./recipient.service");
const { dispatch } = require("./dispatch");
const { toE164 } = require("../messaging/twilio");

const HELP =
  "Aster Bank alerts:\n" +
  "YES \u2013 accept alerts\n" +
  "STOP \u2013 opt out\n" +
  "RESUME \u2013 turn alerts back on\n" +
  "HELP \u2013 this message";

async function handleInbound({ from, body }) {
  const wa = toE164(from);
  const keyword = String(body || "").trim().split(/\s+/)[0].toUpperCase();
  const recipient = await recipients.findByWa(wa);

  let action = "ignored";
  let reply = "";

  if (!recipient) {
    action = "unknown";
    reply =
      "This number isn't set up for Aster Bank alerts. Ask the account holder to add you in the app.";
  } else if (keyword === "YES" || keyword === "START") {
    await recipients.markConsent(recipient.id, "opt_in");
    action = "opt_in";
    reply = "You're all set \u2014 you'll now receive Aster Bank transaction alerts. Reply STOP to opt out.";
  } else if (keyword === "STOP") {
    await recipients.markConsent(recipient.id, "opt_out");
    action = "opt_out";
    reply = "You've opted out of Aster Bank alerts. Reply RESUME to turn them back on.";
  } else if (keyword === "RESUME") {
    await recipients.markConsent(recipient.id, "resume");
    action = "resume";
    reply = "Aster Bank alerts are back on.";
  } else {
    action = "help";
    reply = HELP;
  }

  const sent = await dispatch({
    recipientId: recipient ? recipient.id : null,
    toNumber: wa,
    kind: "reply",
    body: reply,
  });

  return { action, reply, sent };
}

module.exports = { handleInbound, HELP };
