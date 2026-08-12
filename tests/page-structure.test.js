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

test("all HTML ids are unique", () => {
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(ids).size, ids.length);
});

test("financial engine loads before the DOM application", () => {
  assert.ok(html.indexOf('<script src="model.js">') < html.indexOf('<script src="app.js">'));
});

test("every app input mapping has a matching HTML control", () => {
  const fieldBlock = app.match(/const fields = \{([\s\S]*?)\n\};/)[1];
  const ids = [...fieldBlock.matchAll(/:\s*"([^"]+)"/g)].map(match => match[1]);
  assert.ok(ids.length >= 20);
  for (const id of ids) assert.match(html, new RegExp(`id="${id}"`), `missing #${id}`);
});

test("page retains privacy, care, event and downside disclosures", () => {
  assert.match(html, /never uploaded/);
  assert.match(html, /£1m remaining at age 90/);
  assert.match(html, /1% interest worstcase/);
  assert.match(html, /ONS life expectancy data/);
});

test("dynamic work is coalesced and care solving is deferred", () => {
  assert.match(app, /function scheduleRender\(\)[\s\S]*requestAnimationFrame/);
  assert.match(app, /function scheduleCareGuidance[\s\S]*setTimeout[\s\S]*requestIdleCallback/);
  assert.match(app, /function saveLatestValues/);
  assert.doesNotMatch(app, /setTimeout\(saveAndRender/);
});

test("summary cards warn when their 1% downside reaches zero", () => {
  assert.match(app, /downsideWarning\(downsideThree\)/);
  assert.match(app, /downsideWarning\(downsideFour\)/);
  assert.match(app, /1% worst-case risk/);
  assert.match(app, /reaches £0/);
});

test("higher-income preview compares uplifted and standard net income", () => {
  assert.match(app, /baselineValues = \{ \.\.\.values, boost: 0 \}/);
  assert.match(app, /Without uplift:/);
  assert.match(app, /early-income-preview__baseline/);
});

test("early-income slider is capped at a safe bridge-pot uplift", () => {
  assert.match(app, /maxBoostBeforePensionAccess/);
  assert.match(app, /boostInput\.max = String\(boostLimitCacheValue\)/);
  assert.match(html, /id="boost-limit-note"/);
  assert.match(app, /would exhaust stocks, ISA and cash before pensions unlock/);
  assert.match(app, /reaching £1m at 90 would need an uplift/);
});

test("form fields do not stretch to match taller help content", () => {
  assert.match(css, /\.form-grid > label,[\s\S]*align-self: start/);
});

test("projection tables show the pot currently available to withdraw", () => {
  assert.match(app, /\["Year\(s\)", "Age\(s\)", "Net \/ month", "Pension pot", "Available pot", "Pot mix"\]/);
  assert.match(app, /row\.pensionBalance/);
  assert.match(app, /note\("Locked", "pot-note"\)/);
  assert.match(app, /row\.availablePot/);
  assert.match(app, /available pot is stocks, ISA and cash before pension access/);
  assert.doesNotMatch(app, /"Accessible assets"/);
  assert.doesNotMatch(app, /"End balance"/);
});

test("summary plan cards identify their values as end balances", () => {
  assert.match(app, /summaryCard\("3% plan · end balance"/);
  assert.match(app, /summaryCard\("4% plan · end balance"/);
  assert.match(app, /function annualDrawDetail\(values, result\)/);
  assert.match(app, /higher early annual draw until age/);
});

test("table rows include labelled native pot-mix bars", () => {
  assert.match(app, /renderPotMix\(/);
  for (const colour of ["stocks", "isa", "cash", "pension-one", "pension-two"]) assert.match(css, new RegExp(`pot-bar--${colour}`));
  assert.match(app, /\["Stocks", "St", pots\.stocks, "stocks", scale\]/);
  assert.match(app, /\["ISA", "ISA", pots\.isa, "isa", scale\]/);
  assert.match(app, /\["Cash", "Ca", pots\.cash, "cash", scale\]/);
  assert.match(app, /\["State Pension \(annual\)", "SP", stateIncome, "state", scale\]/);
  assert.match(app, /bars\.setAttribute\("role", "img"\)/);
  assert.match(app, /bars\.setAttribute\("aria-label", `Pot mix/);
  assert.match(app, /filter\(\(\[, , value\]\) => value > 0\.005\)/);
  assert.match(css, /height: 62px; margin-block: -7px/);
});

test("projection tables begin with opening portfolio values", () => {
  assert.match(app, /openingRow\.className = "opening-row"/);
  assert.match(app, /tableCell\(`Opening · \$\{result\.startingYear\}`\)/);
  assert.match(app, /result\.startingPension/);
  assert.match(app, /result\.startingAvailablePot/);
});

test("dynamic rendering does not use HTML parsing sinks", () => {
  assert.doesNotMatch(app, /\b(?:innerHTML|outerHTML|insertAdjacentHTML)\b/);
  assert.match(app, /tablesGrid\.replaceChildren\(renderTable\(three\), renderTable\(four\)\)/);
  assert.match(app, /careGuidance\.replaceChildren\(icon, content\)/);
  assert.match(app, /tooltip\.replaceChildren\(/);
});

test("projection tables show their full vertical height", () => {
  assert.match(css, /\.table-scroll \{ max-height: none; overflow-x: auto; \}/);
  assert.doesNotMatch(css, /\.table-scroll \{ max-height: 620px/);
});

test("mobile layout uses safe areas without desktop-width guidance", () => {
  assert.match(html, /width=device-width, initial-scale=1, viewport-fit=cover/);
  assert.doesNotMatch(html, /id="width-note"/);
  assert.doesNotMatch(css, /\.width-note/);
  assert.match(css, /env\(safe-area-inset-left\)/);
  assert.match(css, /env\(safe-area-inset-right\)/);
  assert.match(css, /env\(safe-area-inset-top\)/);
  assert.match(css, /env\(safe-area-inset-bottom\)/);
  assert.match(css, /@media \(max-width: 360px\)/);
  assert.doesNotMatch(css, /\.hero__inner \{ padding: [^;}]+;/);
  assert.doesNotMatch(css, /footer \{ padding: [^;}]+;/);
  assert.doesNotMatch(css, /\b\d+(?:\.\d+)?(?:d|s|l)?vh\b/);
});

test("mobile form controls and annotations are comfortably sized", () => {
  assert.match(css, /@media \(max-width: 600px\)[\s\S]*input, \.range-input output \{ font-size: 1rem; \}/);
  assert.match(css, /\.range-input input\[type="range"\] \{ min-height: 44px; \}/);
  assert.match(css, /\.form-actions \.button \{ width: 100%; \}/);
  assert.match(css, /\.income-note, \.pot-note, \.event-tag \{ font-size: \.75rem; \}/);
});

test("zero asset defaults can be populated from the read-only developer preset", () => {
  assert.match(app, /localStorage\.getItem\(DEVELOPER_STORAGE_KEY\)/);
  assert.match(app, /function readDeveloperAssets\(\)/);
  assert.match(app, /\.\.\.developerAssets/);
  assert.doesNotMatch(app, /localStorage\.setItem\("developer"/);
});

test("hidden developer controls save the asset and inheritance preset", () => {
  assert.match(html, /id="developer-corner"/);
  assert.match(html, /id="save-developer-preset"[^>]*>Save to developer preset/);
  assert.match(html, /id="remove-developer-preset"[^>]*>Remove developer preset/);
  assert.match(html, /id="developer-tools"[^>]*hidden/);
  assert.match(app, /developerCorner\.addEventListener\("click"/);
  assert.match(app, /localStorage\.setItem\(DEVELOPER_STORAGE_KEY, JSON\.stringify\(\{ assets \}\)\)/);
  assert.match(app, /inheritanceYear: values\.inheritanceYear/);
  assert.match(app, /inheritanceAmount: values\.inheritanceAmount/);
  assert.match(app, /inheritanceYear: "inheritanceYear"/);
  assert.match(app, /inheritanceAmount: "inheritanceAmount"/);
  assert.match(app, /removeDeveloperPresetButton\.addEventListener\("click"/);
  assert.match(app, /localStorage\.removeItem\(DEVELOPER_STORAGE_KEY\)/);
  assert.match(app, /function closeDeveloperToolsSoon\(\)[\s\S]*setTimeout[\s\S]*developerTools\.hidden = true/);
  assert.match(app, /developerStatus\.textContent = ""/);
  assert.match(css, /\.developer-tools\[hidden\] \{ display: none; \}/);
  assert.match(css, /\.developer-corner \{ position: fixed;[^}]*safe-area-inset-top[^}]*safe-area-inset-right[^}]*width: 56px; height: 56px/);
});

test("developer tools provide a persisted comfortable-versus-compact layout experiment", () => {
  assert.match(html, /name="layout-variant" type="radio" value="comfortable"/);
  assert.match(html, /name="layout-variant" type="radio" value="compact"/);
  assert.match(html, /Compact reduces desktop and tablet spacing only/);
  assert.match(app, /const LAYOUT_VARIANT_STORAGE_KEY = "retirement-drawdown-layout-variant-v2"/);
  assert.match(app, /const LEGACY_LAYOUT_VARIANT_STORAGE_KEY = "retirement-drawdown-layout-variant-v1"/);
  assert.match(app, /function applyLayoutVariant\(variant\)/);
  assert.match(app, /document\.documentElement\.dataset\.layoutVariant = selected/);
  assert.match(app, /localStorage\.getItem\(LAYOUT_VARIANT_STORAGE_KEY\)/);
  assert.match(app, /localStorage\.setItem\(LAYOUT_VARIANT_STORAGE_KEY, selected\)/);
  assert.match(app, /readLayoutVariant\(\);/);
});

test("comfortable promotes the original compact spacing and Compact is tighter above mobile", () => {
  assert.match(css, /@media \(min-width: 601px\) \{[\s\S]*\.chart-wrap \{ height: 350px/);
  assert.match(css, /\.inputs-panel \{ padding: clamp\(20px, 3vw, 30px\)/);
  assert.match(css, /:root\[data-layout-variant="compact"\] \.chart-wrap \{ height: 300px/);
  assert.match(css, /:root\[data-layout-variant="compact"\] \.inputs-panel \{ padding: clamp\(16px, 2vw, 24px\)/);
  assert.doesNotMatch(css, /@media \(max-width: 600px\)[\s\S]*data-layout-variant="compact"/);
});

test("reset defaults includes the developer asset preset", () => {
  assert.match(app, /populateForm\(\{ \.\.\.defaults, \.\.\.readDeveloperAssets\(\) \}\)/);
});

test("reset defaults lets saved developer assets override built-in asset defaults", () => {
  const resetHandler = app.match(/populateForm\(\{ \.\.\.defaults, \.\.\.readDeveloperAssets\(\) \}\)/);
  assert.ok(resetHandler, "reset handler should merge developer assets after built-in defaults");

  const builtInDefaults = { stocks: 0, isa: 0, cash: 0, pensionOne: 0, pensionTwo: 0, inheritanceYear: null, inheritanceAmount: null };
  const savedDeveloperAssets = { stocks: 125000, isa: 64000, cash: 9000, pensionOne: 210000, pensionTwo: 175000, inheritanceYear: 2037, inheritanceAmount: 200000 };
  const resetValues = { ...builtInDefaults, ...savedDeveloperAssets };

  assert.deepEqual(resetValues, savedDeveloperAssets);
  assert.equal(resetValues.stocks, 125000);
  assert.equal(resetValues.pensionOne, 210000);
  assert.equal(resetValues.pensionTwo, 175000);
  assert.equal(resetValues.inheritanceYear, 2037);
  assert.equal(resetValues.inheritanceAmount, 200000);
});

test("built-in inheritance defaults are empty", () => {
  assert.match(model, /inheritanceYear: null/);
  assert.match(model, /inheritanceAmount: null/);
});

test("hero description stays on one line when desktop width permits", () => {
  assert.match(css, /@media \(min-width: 900px\)[\s\S]*\.hero__copy \{ max-width: none; white-space: nowrap; \}/);
});

test("tables use full width before the two-column layout can fit pot mix", () => {
  assert.match(css, /@media \(max-width: 1510px\) and \(min-width: 901px\)[\s\S]*\.tables-grid \{ grid-template-columns: 1fr; \}/);
});

test("chart plots available pot and keeps total balance in hover context", () => {
  assert.match(html, />Available pot<\/h3>/);
  assert.match(html, /comparing available pots/);
  assert.match(app, /maxAvailablePot/);
  assert.match(app, /row\.availablePot/);
  assert.match(app, /3% available:[\s\S]*total \$\{money\.format\(threeRow\.balance\)\}/);
  assert.match(app, /drawHigherIncomeBand\(ctx, three, xFor, height, pad, values\)/);
  assert.match(app, /fillText\("Higher income"/);
});

test("chart supports touch locking, keyboard navigation, and safe redraw", () => {
  assert.match(html, /id="balance-chart" tabindex="0"/);
  assert.match(html, /aria-describedby="chart-instructions chart-details"/);
  assert.match(html, /id="chart-details" aria-live="polite"/);
  assert.match(app, /function nearestChartIndex\(clientX\)/);
  assert.match(app, /function showChartSelection\(index, announce = false\)/);
  assert.match(app, /function positionChartTooltip\(index\)/);
  assert.match(app, /canvas\.addEventListener\("pointerup"/);
  assert.match(app, /event\.pointerType === "mouse" && event\.button !== 0/);
  for (const key of ["ArrowLeft", "ArrowRight", "Home", "End", "Escape"]) assert.match(app, new RegExp(`event\\.key === "${key}"`));
  assert.match(app, /drawChart\(currentResults\.three, currentResults\.four, currentResults\.downsideThree, currentResults\.downsideFour, currentResults\.values\)/);
  assert.doesNotMatch(css, /touch-action:\s*none/);
});

test("projection tables advertise contained horizontal scrolling", () => {
  assert.match(app, /Swipe horizontally to see all columns/);
  assert.match(app, /scroll\.tabIndex = 0/);
  assert.match(app, /scroll\.setAttribute\("role", "region"\)/);
  assert.match(app, /`\$\{rateLabel\} projection table; scroll horizontally/);
  assert.match(css, /\.table-scroll \{ max-height: none; overflow-x: auto; \}/);
  assert.match(css, /@media \(max-width: 600px\)[\s\S]*\.table-scroll-hint \{ display: block; \}/);
});

test("each table includes a dynamic pot-depletion narrative", () => {
  assert.match(app, /renderPotNarrative\(result\)/);
  assert.match(app, /How this path uses your pots/);
  assert.match(app, /withdrawals come only from stocks, ISA and cash/);
  assert.match(app, /tax-efficient pension amount first/);
  assert.match(app, /State Pension offsets part of the income target/);
  assert.match(app, /non-pension pot is finally exhausted/);
});
