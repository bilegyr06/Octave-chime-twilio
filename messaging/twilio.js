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

// Send a freeform WhatsApp message (valid inside the Twilio sandbox 24h window).
async function sendMessage({ to, body, statusCallback }) {
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

  const form = new URLSearchParams({
    To,
    From: fromAddress(),
    Body: String(body == null ? "" : body),
  });
  const cb = statusCallback || config.statusCallbackUrl();
  if (cb) form.set("StatusCallback", cb);

  const auth = Buffer.from(
    `${config.twilio.accountSid}:${config.twilio.authToken}`
  ).toString("base64");
  const url = `https://api.twilio.com/2010-04-01/Accounts/${config.twilio.accountSid}/Messages.json`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
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
