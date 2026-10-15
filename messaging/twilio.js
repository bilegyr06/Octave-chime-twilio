"use strict";
const crypto = require("crypto");
const config = require("../config");

// Normalise any local / international style number to E.164 ("+234...").
function toE164(value) {
  let s = String(value || "").trim();
  if (!s) return "";
  s = s.replace(/^whatsapp:/i, "").replace(/[\s()-]/g, "");
  if (s.startsWith("00")) s = "+" + s.slice(2);
  if (!s.startsWith("+")) {
    if (s.startsWith("234")) s = "+" + s;
    else if (s.startsWith("0")) s = "+234" + s.slice(1);
    else s = "+" + s;
  }
  return s;
}

function whatsappAddress(value) {
  const n = toE164(value);
  return n ? `whatsapp:${n}` : "";
}

function fromAddress() {
  const s = String(config.twilio.whatsappFrom || "").trim();
  return /^whatsapp:/i.test(s) ? s : whatsappAddress(s);
}

function configured() {
  return config.twilio.configured;
}

// Codes that mean "freeform text is not allowed here \u2014 send a Content Template instead".
const NEEDS_TEMPLATE = /^(21654|21655|92005|63016)$/;

const todayLabel = () =>
  new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(new Date());

// Trial accounts must send every WhatsApp message as a Content Template. Map the
// app's multi-line message text onto the sandbox's pre-approved
// "Order Notifications" template: "Your {{1}} order of {{2}} has shipped and
// should be delivered on {{3}}. Details: {{4}}".
function templateVariables(body, kind) {
  const text = String(body || "");
  const lines = text.split("\n").map((l) => l.trim());
  const value = (key) => {
    const line = lines.find((l) => l.toLowerCase().startsWith(key.toLowerCase() + ":"));
    return line ? line.slice(line.indexOf(":") + 1).trim() : "";
  };
  const detail = (parts) => parts.filter(Boolean).join(", ");

  if (kind === "alert") {
    const title = (lines.find(Boolean) || "").replace(/^Aster Bank\s*[-\u2014]\s*/i, "");
    const partyKey = /credit/i.test(title) ? "From" : "To";
    return {
      "1": "Aster Bank",
      "2": `${title}: ${value("Amount")} ${value(partyKey)}`,
      "3": value("Time"),
      "4": detail([`Acct ${value("Acct")}`, value("Channel"), `Ref ${value("Ref")}`, `Balance ${value("Balance")}`]),
    };
  }
  if (kind === "summary") {
    return {
      "1": "Aster Bank",
      "2": `Daily Summary (${value("Transactions")} transactions)`,
      "3": lines[1] || todayLabel(),
      "4": detail([
        `Acct ${value("Acct")}`,
        `Opening ${value("Opening balance")}`,
        `Closing ${value("Closing balance")}`,
        `Net ${value("Net movement")}`,
      ]),
    };
  }
  if (kind === "optin") {
    const holder = (text.match(/^Aster Bank:\s*(.*?)\s+wants to send/i) || [])[1] || "the account holder";
    return {
      "1": "Aster Bank",
      "2": `account alerts from ${holder}`,
      "3": todayLabel(),
      "4": "Reply YES to accept, STOP to decline.",
    };
  }
  if (kind === "test") {
    return {
      "1": "Aster Bank",
      "2": "WhatsApp alerts connectivity test",
      "3": todayLabel(),
      "4": "Your Aster Bank WhatsApp alerts are connected.",
    };
  }
  return {
    "1": "Aster Bank",
    "2": "account alert update",
    "3": todayLabel(),
    "4": text.replace(/\s*\n\s*/g, " "),
  };
}

// Send a WhatsApp message. Freeform Body text only works inside the 24h
// conversation window; when Twilio demands a template (or TWILIO_CONTENT_SID is
// configured for business-initiated sends), fall back to ContentSid + variables.
async function sendMessage({ to, body, statusCallback, contentSid, contentVariables, kind = "reply" }) {
  if (!configured()) {
    const e = new Error(
      "Twilio is not configured. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_WHATSAPP_FROM in .env."
    );
    e.statusCode = 400;
    throw e;
  }
  const To = whatsappAddress(to);
  if (!To || To === "whatsapp:+") {
    const e = new Error("Recipient WhatsApp number is missing or invalid.");
    e.statusCode = 400;
    throw e;
  }
  const text = String(body == null ? "" : body);
  const sid = String(contentSid || config.twilio.contentSid || "").trim();
  const cb = statusCallback || config.statusCallbackUrl();

  const auth = Buffer.from(
    `${config.twilio.accountSid}:${config.twilio.authToken}`
  ).toString("base64");
  const headers = {
    Authorization: `Basic ${auth}`,
    Accept: "application/json",
  };

  const post = async (form) => {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    const url = `https://api.twilio.com/2010-04-01/Accounts/${config.twilio.accountSid}/Messages.json`;
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: form.toString(),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const e = new Error(data.message || `Twilio API responded with HTTP ${res.status}`);
      e.statusCode = 502;
      e.details = { code: data.code, status: res.status, moreInfo: data.more_info };
      throw e;
    }
    return data;
  };

  const makeForm = (extra) => {
    const form = new URLSearchParams({ To, From: fromAddress(), ...extra });
    if (cb) form.set("StatusCallback", cb);
    return form;
  };

  // Caller explicitly asked for a template send \u2014 no freeform attempt.
  if (contentSid) {
    return post(
      makeForm({
        ContentSid: sid,
        ContentVariables: JSON.stringify(contentVariables || templateVariables(text, kind)),
      })
    );
  }

  // A configured template means this account sends templates only (no freeform).
  if (sid) {
    return post(
      makeForm({
        ContentSid: sid,
        ContentVariables: JSON.stringify(contentVariables || templateVariables(text, kind)),
      })
    );
  }

  // No template configured: try freeform (works inside the 24h window on
  // sandbox accounts that still allow it), then fall back if Twilio demands one.
  try {
    return await post(makeForm({ Body: text }));
  } catch (e) {
    const code = String((e.details && e.details.code) || "");
    if (sid && NEEDS_TEMPLATE.test(code)) {
      return post(
        makeForm({
          ContentSid: sid,
          ContentVariables: JSON.stringify(contentVariables || templateVariables(text, kind)),
        })
      );
    }
    throw e;
  }
}

// Validate the X-Twilio-Signature header per Twilio's documented algorithm.
function validateSignature(url, params, signature) {
  if (!config.twilio.authToken || !signature) return false;
  let data = url;
  if (params) {
    Object.keys(params)
      .sort()
      .forEach((k) => {
        data += k + params[k];
      });
  }
  const expected = crypto
    .createHmac("sha1", config.twilio.authToken)
    .update(Buffer.from(data, "utf8"))
    .digest("base64");
  const a = Buffer.from(expected);
  const b = Buffer.from(String(signature));
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

// Reconstruct the public URL Twilio used, honouring proxy headers.
function requestUrl(req) {
  if (config.twilio.publicUrl) return config.twilio.publicUrl + req.originalUrl;
  const proto = req.headers["x-forwarded-proto"] || req.protocol || "https";
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  return `${proto}://${host}${req.originalUrl}`;
}

module.exports = {
  toE164,
  whatsappAddress,
  fromAddress,
  configured,
  sendMessage,
  validateSignature,
  requestUrl,
};
