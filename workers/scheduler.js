"use strict";
const cron = require("node-cron");
const config = require("../config");
const ledger = require("../services/ledger.service");
const summary = require("../services/summary.service");
const { businessDate } = require("../lib/format");

let started = false;

function start() {
  if (started) return;
  started = true;

  const hour = Math.min(Math.max(Number(config.eod.hour) || 18, 0), 23);
  const expr = `0 ${hour} * * *`;

  cron.schedule(
    expr,
    async () => {
      try {
        const id = await ledger.defaultAccountId();
        const date = businessDate();
        const result = await summary.run(id, date);
        console.log(
          `[cron] EOD summary for ${date}: ${result.notifications.length} message(s)`
        );
      } catch (e) {
        console.error("[cron] EOD summary failed:", e.message);
      }
    },
    { timezone: config.eod.tz }
  );

  console.log(`[cron] EOD scheduled daily at ${hour}:00 (${config.eod.tz})`);
}

module.exports = { start };
