"use strict";
const fs = require("fs");
const path = require("path");
const { pool } = require("./pool");

async function migrate(retries = 3) {
  if (!pool) throw new Error("DATABASE_URL is not set; cannot migrate.");
  const sql = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
  try {
    await pool.query(sql);
  } catch (e) {
    // Concurrent instances can collide on DDL; retry once the other wins.
    if (retries > 0 && /duplicate key|already exists/i.test(e.message)) {
      await new Promise((r) => setTimeout(r, 1500));
      return migrate(retries - 1);
    }
    throw e;
  }
}

if (require.main === module) {
  migrate()
    .then(() => {
      console.log("[db] schema applied");
      process.exit(0);
    })
    .catch((e) => {
      console.error("[db] migrate failed:", e.message);
      process.exit(1);
    });
}

module.exports = { migrate };
