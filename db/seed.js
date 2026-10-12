"use strict";
const { query } = require("./pool");

const DEFAULT = {
  number: "0692\u2022\u20224821",
  type: "corporate",
  holder_name: "GreenField Ventures Ltd",
  opening_balance: 380100.55,
};

// Creates the single demo account if the database is empty. Idempotent.
async function seed() {
  const { rows } = await query("SELECT id FROM oc_account ORDER BY id LIMIT 1");
  if (rows.length) return rows[0].id;

  const { rows: created } = await query(
    `INSERT INTO oc_account (number, type, holder_name, opening_balance, balance)
     VALUES ($1, $2, $3, $4, $4) RETURNING id`,
    [DEFAULT.number, DEFAULT.type, DEFAULT.holder_name, DEFAULT.opening_balance]
  );
  return created[0].id;
}

if (require.main === module) {
  seed()
    .then((id) => {
      console.log(`[db] seed complete (account id ${id})`);
      process.exit(0);
    })
    .catch((e) => {
      console.error("[db] seed failed:", e.message);
      process.exit(1);
    });
}

module.exports = { seed };
