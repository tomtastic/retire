"use strict";

const fs = require("node:fs");

const [, , reportPath, outputPath] = process.argv;
if (!reportPath || !outputPath) {
  console.error("Usage: node scripts/make-coverage-badge.js REPORT OUTPUT");
  process.exit(1);
}

const report = fs.readFileSync(reportPath, "utf8");
const match = report.match(/model\.js\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)/);
if (!match) {
  throw new Error("Could not find model.js coverage in the test report.");
}

const [, lines, branches, functions] = match;
const message = `${lines}% lines · ${branches}% branches · ${functions}% functions`;
const badge = {
  schemaVersion: 1,
  label: "coverage",
  message,
  color: Number(lines) >= 90 ? "brightgreen" : Number(lines) >= 75 ? "yellow" : "red"
};

fs.mkdirSync(require("node:path").dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(badge)}\n`);
