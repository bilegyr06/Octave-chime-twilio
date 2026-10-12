"use strict";
require("dotenv").config();

const str = (v) => String(v == null ? "" : v).trim();

// Treat template placeholders as unset so health checks are truthful.
const isReal = (v) => {
  const s = str(v);
  if (!s) return false;
  return !/your[-_ ]|placeholder|changeme|^xxx|example|<|replace\b/i.test(s);
};

const config = {
  port: Number(process.env.PORT || 3000),

  databaseUrl: str(process.env.DATABASE_URL),

  twilio: {
    accountSid: str(process.env.TWILIO_ACCOUNT_SID),
    authToken: str(process.env.TWILIO_AUTH_TOKEN),
    whatsappFrom: str(process.env.TWILIO_WHATSAPP_FROM),
    contentSid: str(process.env.TWILIO_CONTENT_SID),
    publicUrl: str(process.env.PUBLIC_URL).replace(/\/+$/, ""),
    statusCallbackUrl: str(process.env.TWILIO_STATUS_CALLBACK_URL),
  },

  eod: {
    hour: Number(process.env.EOD_HOUR || 18),
    tz: str(process.env.EOD_TZ) || "Africa/Lagos",
  },
};

config.twilio.configured = Boolean(
  isReal(config.twilio.accountSid) &&
    isReal(config.twilio.authToken) &&
    isReal(config.twilio.whatsappFrom)
);

config.dbConfigured = isReal(config.databaseUrl);

config.statusCallbackUrl = () =>
  config.twilio.statusCallbackUrl ||
  (config.twilio.publicUrl ? `${config.twilio.publicUrl}/api/twilio/status` : "");

module.exports = config;
