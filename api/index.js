"use strict";
// Vercel entry point: the whole Aster Bank app runs as one serverless function.
const { app } = require("../server");
module.exports = app;