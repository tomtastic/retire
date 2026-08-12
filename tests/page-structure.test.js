"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
const css = fs.readFileSync(path.join(root, "styles.css"), "utf8");
const model = fs.readFileSync(path.join(root, "model.js"), "utf8");

test("all static HTML ids are unique and the engine loads first", () => {
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(html.indexOf('<script src="model.js">') < html.indexOf('<script src="app.js">'));
  assert.match(html, /<link rel="icon" type="image\/svg\+xml" href="favicon\.svg">/);
});

test("both person tabs host the same reusable workspace implementation", () => {
  assert.match(html, /data-person="personOne"/);
  assert.match(html, /data-person="personTwo"/);
  assert.match(app, /for \(const key of PERSON_KEYS\) buildPersonWorkspace\(key\)/);
  assert.match(app, /const submit = el\("button", \{ className: "button button--primary", type: "submit", text: "Validate and save" \}\)/);
  assert.match(app, /text: "Reset defaults"/);
  assert.match(app, /text: "Clear saved data"/);
  assert.doesNotMatch(app, /el\("h3", \{ text: PERSON_LABELS\[personKey\] \}\)/);
});

test("state uses versioned country profiles and migrates through the model", () => {
  assert.match(app, /const PEOPLE_SCHEMA_VERSION = 3/);
  assert.match(app, /person\.profiles\[context\.profileCountry\] = values/);
  assert.match(app, /person\.selectedCountry = nextCountry/);
  assert.match(app, /profiles: blankProfiles\(\)/);
  assert.match(app, /migratePeopleState\(parsed\)/);
});

test("Person 1 is constrained to UK and Person 2 defaults to USA", () => {
  assert.match(app, /disabled: personKey === "personOne"/);
  assert.match(app, /personKey === "personOne" \? \[\] : \[profile\.fieldset\]/);
  assert.match(app, /personKey === "personOne" \? "UK" : context\.profileCountry/);
  assert.match(model, /personTwo: emptyPerson\("USA"\)/);
});

test("country-specific account metadata contains every UK and USA account", () => {
  for (const label of ["Stocks / general account", "ISA", "Cash", "Company Pension / SIPP 1", "Company Pension / SIPP 2", "401(k)", "Traditional IRA", "Roth IRA", "Taxable brokerage"]) {
    assert.ok(app.includes(label), label);
  }
});

test("both people receive the same accessible early-income slider and preview", () => {
  assert.match(app, /input\(context, "boost", "range", \{ min: "0", max: "200", step: "5"/);
  assert.match(app, /input\(context, "boostUntilAge", "number", \{ min: "40", max: "120", step: "1"/);
  assert.match(app, /context\.boostOutput = el\("output"/);
  assert.match(app, /renderEarlyIncomePreview\(context, values, three, four, format\)/);
  assert.match(app, /baselineThree = scenario\(\{ \.\.\.values, boost: 0 \}, 0\.03\)/);
  assert.match(css, /\.range-input input\[type="range"\] \{ min-height: 44px; \}/);
});

test("early-income increases are blocked when the 3% bridge becomes unsafe", () => {
  assert.match(app, /enforceEarlyIncomeBridge\(context, event\.target\)/);
  assert.match(app, /bridgeSafe = earlyIncomeBridgeSafe\(formValues\(context\)\)/);
  assert.match(app, /extending && !bridgeSafe/);
  assert.match(app, /target\.value = String\(previous\)/);
  assert.match(app, /That increase was blocked because the 3% plan/);
});

test("percentage assumptions use in-box suffixes while ages use plain inputs", () => {
  for (const key of ["realReturn", "inflation", "traditionalTaxableShare", "taxableWithdrawalShare"]) {
    assert.match(app, new RegExp(`suffixInput\\(context, "${key}", "%"`));
  }
  for (const key of ["penaltyFreeAccessAge", "rmdStartAge"]) {
    assert.match(app, new RegExp(`input\\(context, "${key}", "number"`));
    assert.doesNotMatch(app, new RegExp(`suffixInput\\(context, "${key}"`));
  }
});

test("render contexts isolate currency, chart geometry, tooltip and keyboard state", () => {
  assert.match(app, /const contexts = \{\}/);
  assert.match(app, /context\.results = \{ values, format, three, four, downsideThree, downsideFour \}/);
  assert.match(app, /context\.chart = \{ canvas, tooltip, details, geometry: null, lockedIndex: -1, hoverIndex: -1 \}/);
  assert.match(app, /ArrowLeft/);
  assert.match(app, /ArrowRight/);
  assert.match(app, /event\.pointerType !== "touch"/);
  assert.match(css, /\.chart-wrap canvas \{ width: 100%; height: 100%; \}/);
});

test("USA and UK charts use country-appropriate markers", () => {
  assert.match(app, /values\.country === "USA" \? "Account access" : "Private pensions"/);
  assert.match(app, /if \(values\.country === "UK"\) markers\.push/);
  assert.match(app, /label: "Inheritance"/);
});

test("projection tables are currency-aware, account-aware and horizontally scrollable", () => {
  assert.match(app, /ACCOUNT_META\[values\.country\]/);
  assert.match(app, /\["Traditional", "accounts"\]/);
  assert.match(app, /\["Pension", "pot"\]/);
  assert.match(app, /Swipe horizontally to see all columns/);
  assert.match(app, /tabIndex: 0, role: "region"/);
  assert.match(css, /\.table-scroll \{ max-height: none; overflow-x: auto; \}/);
  assert.match(css, /@media \(max-width: 600px\)[\s\S]*\.table-scroll-hint \{ display: block; \}/);
});

test("projection tables group unchanged years and wrap the wide USA headings", () => {
  assert.match(app, /groupTableRows\(result\.rows\)/);
  assert.match(app, /Math\.round\(next\.netMonthly\) !== Math\.round\(start\.netMonthly\)/);
  assert.match(app, /isKeyEvent\(next\)/);
  assert.match(app, /\["Traditional", "accounts"\]/);
  assert.match(app, /\["Available", "pot"\]/);
  assert.match(css, /\.table-heading--wrapped \{[^}]*white-space: normal/);
  assert.match(app, /in today's money\.`, el\("br"\), "Grouped where/);
});

test("care guidance sits between the early-income controls and preview cards", () => {
  assert.match(app, /boost\.fieldset\.append\(context\.boostNote, context\.careGuidance, context\.earlyPreview\)/);
  assert.doesNotMatch(app, /context\.countryNote, context\.careGuidance/);
});

test("both people receive full deferred care-reserve guidance", () => {
  assert.match(app, /renderCareGuidance\(context, values, three, four, format, false\)/);
  assert.match(app, /scheduleCareGuidance\(context, values, three, four, format\)/);
  assert.match(app, /solveBoostForCareReserve/);
  assert.match(app, /solveRateForCareReserve/);
  assert.match(app, /context\.careGuidance\.hidden = false/);
  assert.match(app, /care-guidance--caution/);
  assert.match(app, /You may be reserving more than ten years of care costs/);
});

test("methodology remains country appropriate", () => {
  assert.match(app, /USA scope\./);
  assert.match(app, /Social Security, Medicare, state taxes, joint filing/);
  assert.match(app, /State Pension offsets part of the income target/);
  assert.match(html, /£1m remaining at age 90/);
});

test("Person 2 enable state is independent from clearing its profiles", () => {
  const clearBlock = app.match(/function clearPerson\(context\) \{([\s\S]*?)\n\}/)[1];
  assert.doesNotMatch(clearBlock, /personTwoEnabled/);
  assert.match(app, /peopleState\.personTwoEnabled = !peopleState\.personTwoEnabled/);
  assert.match(app, /Person 2 retained but hidden/);
});

test("dynamic DOM rendering avoids HTML parsing sinks", () => {
  assert.doesNotMatch(app, /\b(?:innerHTML|outerHTML|insertAdjacentHTML)\b/);
  assert.match(app, /replaceChildren/);
});

test("mobile layout retains safe areas, large controls and a 320px-compatible single column", () => {
  assert.match(html, /width=device-width, initial-scale=1, viewport-fit=cover/);
  assert.match(css, /env\(safe-area-inset-left\)/);
  assert.match(css, /env\(safe-area-inset-right\)/);
  assert.match(css, /@media \(max-width: 360px\)/);
  assert.match(css, /@media \(max-width: 600px\)[\s\S]*\.form-grid[\s\S]*grid-template-columns: 1fr/);
  assert.match(css, /\.form-actions \.button \{ width: 100%; \}/);
});

test("developer preset remains scoped to Person 1 UK reset", () => {
  assert.match(app, /context\.personKey === "personOne" \? \{ \.\.\.base, \.\.\.readDeveloperAssets\(\), country: "UK"/);
  assert.match(html, /Save Person 1 assets to developer preset/);
  assert.match(app, /localStorage\.setItem\(DEVELOPER_STORAGE_KEY/);
});
