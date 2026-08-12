"use strict";

const path = require("node:path");
const { version } = require("eslint/package.json");

module.exports = function formatSarif(results, context = {}) {
  const cwd = context.cwd || process.cwd();
  const rulesMeta = context.rulesMeta || {};
  const ruleIds = new Set();

  for (const result of results) {
    for (const message of result.messages) {
      ruleIds.add(message.ruleId || "eslint/fatal");
    }
  }

  const rules = [...ruleIds].sort().map(id => {
    const metadata = rulesMeta[id];
    const rule = {
      id,
      shortDescription: {
        text: metadata?.docs?.description || id,
      },
    };
    if (metadata?.docs?.url) rule.helpUri = metadata.docs.url;
    return rule;
  });
  const ruleIndexes = new Map(rules.map((rule, index) => [rule.id, index]));

  const sarifResults = results.flatMap(result => {
    const uri = path.relative(cwd, result.filePath).split(path.sep).join("/");
    return result.messages.map(message => {
      const ruleId = message.ruleId || "eslint/fatal";
      const region = {
        startLine: message.line || 1,
        startColumn: message.column || 1,
      };
      if (message.endLine) region.endLine = message.endLine;
      if (message.endColumn) region.endColumn = message.endColumn;

      return {
        ruleId,
        ruleIndex: ruleIndexes.get(ruleId),
        level: message.fatal || message.severity === 2 ? "error" : "warning",
        message: { text: message.message },
        locations: [
          {
            physicalLocation: {
              artifactLocation: { uri },
              region,
            },
          },
        ],
      };
    });
  });

  return JSON.stringify({
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: {
            name: "ESLint",
            semanticVersion: version,
            informationUri: "https://eslint.org",
            rules,
          },
        },
        results: sarifResults,
      },
    ],
  });
};
