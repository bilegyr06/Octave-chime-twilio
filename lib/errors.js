"use strict";

function httpError(message, status = 400, details) {
  const e = new Error(message);
  e.statusCode = status;
  if (details) e.details = details;
  return e;
}

module.exports = { httpError };
