"use strict";
// Vercel entry point: the whole Aster Bank app runs as one serverless function.
// @vercel/node requires an explicit request handler.
const { app } = require("../server");

module.exports = (req, res) => app(req, res);