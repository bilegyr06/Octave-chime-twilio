"use strict";
const { Pool } = require("pg");
const config = require("../config");

let pool = null;

if (config.dbConfigured) {
  const needsSsl = !/localhost|127\.0\.0\.1/.test(config.databaseUrl);
  // Strip sslmode so pg doesn't warn; SSL is configured explicitly below.
  const clean = config.databaseUrl.replace(/([?&])sslmode=[^&]*/i, "").replace(/[?&]+$/, "");
  pool = new Pool({
    connectionString: clean,
    ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
    max: 5,
  });
  pool.on("error", (e) => console.error("[db] pool error:", e.message));
}

async function query(text, params) {
  if (!pool) throw new Error("Database is not configured (DATABASE_URL missing).");
  return pool.query(text, params);
}

async function healthy() {
  if (!pool) return false;
  try {
    await pool.query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}

module.exports = { pool, query, healthy };
