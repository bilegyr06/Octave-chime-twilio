"use strict";
const fs = require("fs");
const path = require("path");
const { pool } = require("./pool");

async function migrate() {
  if (!pool) throw new Error("DATABASE_URL is not set; cannot migrate.");
  const sql = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
  await pool.query(sql);
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
