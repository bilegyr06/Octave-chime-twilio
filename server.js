"use strict";
const path = require("path");
const express = require("express");
const config = require("./config");
const { migrate } = require("./db/migrate");
const { seed } = require("./db/seed");

const app = express();

app.set("trust proxy", true);
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Ensure the schema exists once (idempotent) before the first DB-touching request.
// Shared promise so the boot path and per-request middleware never run DDL twice.
let dbReady = null;
async function initDatabase() {
  if (!config.dbConfigured) return;
  await migrate();
  return seed();
}
function ensureDb() {
  if (!config.dbConfigured) return Promise.resolve();
  if (!dbReady) {
    dbReady = initDatabase().catch((e) => {
      dbReady = null; // allow a later retry
      throw e;
    });
  }
  return dbReady;
}
app.use(async (_req, _res, next) => {
  try {
    await ensureDb();
  } catch (e) {
    console.error("[db] init failed:", e.message);
  }
  next();
});

app.get("/", (_req, res) => res.sendFile(path.join(__dirname, "index.html")));

app.use("/api", require("./routes/system"));
app.use("/api/account", require("./routes/account"));
app.use("/api/transactions", require("./routes/transactions"));
app.use("/api/recipients", require("./routes/recipients"));
app.use("/api/summary", require("./routes/summary"));
app.use("/api/twilio", require("./routes/twilio"));

app.use((req, res, next) => {
  if (req.path.startsWith("/api")) {
    return res.status(404).json({ ok: false, error: "Not found." });
  }
  next();
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  const status = err.statusCode || err.status || 500;
  if (status >= 500) console.error("[error]", err);
  res.status(status).json({ ok: false, error: err.message || "Server error." });
});

const isServerless = () => String(process.env.VERCEL || "").toLowerCase() === "1";

if (require.main === module) {
  (async () => {
    if (config.dbConfigured) {
      try {
        await ensureDb();
        console.log("[db] schema ready and seeded");
      } catch (e) {
        console.error("[db] initialization failed:", e.message);
      }
    } else {
      console.warn("[db] DATABASE_URL not set \u2014 database routes will fail until configured.");
    }
    if (!config.twilio.configured) {
      console.warn("[twilio] credentials incomplete \u2014 WhatsApp sending is disabled.");
    } else if (!config.twilio.publicUrl) {
      console.warn("[twilio] PUBLIC_URL not set \u2014 status callbacks disabled.");
    }
    if (isServerless()) {
      console.warn("[cron] Vercel detected \u2014 rely on Vercel Cron (vercel.json), not node-cron.");
    } else {
      require("./workers/scheduler").start();
    }
    app.listen(config.port, () => {
      console.log(`[server] Aster Bank listening on http://localhost:${config.port}`);
    });
  })();
}

module.exports = { app, initDatabase };