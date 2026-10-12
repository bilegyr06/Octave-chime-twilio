"use strict";
const config = require("../config");

const naira = (n) =>
  "\u20a6" +
  Number(n || 0).toLocaleString("en-NG", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const nairaPlain = (n) =>
  "NGN " +
  Number(n || 0).toLocaleString("en-NG", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

function businessDate(d = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: config.eod.tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function hhmm(d = new Date()) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: config.eod.tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

function dayLabel(d = new Date()) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: config.eod.tz,
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(d);
}

module.exports = { naira, nairaPlain, businessDate, hhmm, dayLabel };
