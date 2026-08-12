"use strict";

const STORAGE_KEY = "retirement-drawdown-model-v1";
const DEVELOPER_STORAGE_KEY = "developer";
const {
  CARE_RESERVE_AGE,
  MAX_BOOST,
  DEFAULTS: defaults,
  parseLocalDate,
  ageAt,
  scenario,
  balanceAtAge,
  careReserveStatus,
  solveBoostForCareReserve,
  solveRateForCareReserve,
  maxBoostBeforePensionAccess
} = globalThis.RetirementModel;

const form = document.querySelector("#model-form");
const errorBox = document.querySelector("#form-error");
const savedState = document.querySelector("#saved-state");
const summaryGrid = document.querySelector("#summary-grid");
const careGuidance = document.querySelector("#care-guidance");
const earlyIncomePreview = document.querySelector("#early-income-preview");
const tablesGrid = document.querySelector("#tables-grid");
const basis = document.querySelector("#projection-basis");
const canvas = document.querySelector("#balance-chart");
const tooltip = document.querySelector("#chart-tooltip");
const chartDetails = document.querySelector("#chart-details");
const boostOutput = document.querySelector("#boost-output");
const boostInput = document.querySelector("#boost");
const boostLimitNote = document.querySelector("#boost-limit-note");
const developerCorner = document.querySelector("#developer-corner");
const developerTools = document.querySelector("#developer-tools");
const saveDeveloperPresetButton = document.querySelector("#save-developer-preset");
const removeDeveloperPresetButton = document.querySelector("#remove-developer-preset");
const developerStatus = document.querySelector("#developer-status");

const fields = {
  birthDate: "birth-date",
  retirementDate: "retirement-date",
  horizon: "horizon",
  stocks: "stocks",
  isa: "isa",
  cash: "cash",
  pensionOne: "pension-one",
  pensionTwo: "pension-two",
  inheritanceYear: "inheritance-year",
  inheritanceAmount: "inheritance-amount",
  realReturn: "real-return",
  inflation: "inflation",
  pensionAge: "pension-age",
  stateAge: "state-age",
  statePension: "state-pension",
  boostUntilAge: "boost-until-age",
  boost: "boost",
  personalAllowance: "personal-allowance",
  basicBand: "basic-band",
  taxFreeShare: "tax-free-share",
  taxFreeCap: "tax-free-cap"
};

let currentResults = null;
let chartGeometry = null;
let saveTimer = null;
let renderFrame = null;
let resizeFrame = null;
let careJob = null;
let careVersion = 0;
let pointerFrame = null;
let pendingPointer = null;
let tooltipIndex = -1;
let lockedTooltipIndex = -1;
let boostLimitCacheKey = "";
let boostLimitCacheValue = MAX_BOOST;
let developerCloseTimer = null;

const money = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  maximumFractionDigits: 0
});

const compactMoney = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  notation: "compact",
  maximumFractionDigits: 2
});

/** Load persisted form values, applying defaults, aliases, and the developer preset. */
function readSavedValues() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const saved = raw ? JSON.parse(raw) : {};
    const developerAssets = readDeveloperAssets();
    return {
      ...defaults,
      ...saved,
      pensionOne: saved.pensionOne ?? saved.companyPension ?? defaults.pensionOne,
      pensionTwo: saved.pensionTwo ?? saved.sipp ?? defaults.pensionTwo,
      ...developerAssets
    };
  } catch {
    return { ...defaults };
  }
}

/**
 * Read and normalise asset values from the optional developer preset.
 * @returns {Object<string, number>} Valid non-negative values keyed by canonical field name.
 */
function readDeveloperAssets() {
  try {
    const raw = localStorage.getItem(DEVELOPER_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    const source = parsed && typeof parsed === "object" && parsed.assets && typeof parsed.assets === "object"
      ? parsed.assets
      : parsed;
    const aliases = {
      stocks: "stocks",
      isa: "isa",
      cash: "cash",
      pensionOne: "pensionOne",
      pensionTwo: "pensionTwo",
      companyPension: "pensionOne",
      sipp: "pensionTwo",
      inheritanceYear: "inheritanceYear",
      inheritanceAmount: "inheritanceAmount"
    };
    const assets = {};
    for (const [key, canonical] of Object.entries(aliases)) {
      if (assets[canonical] !== undefined) continue;
      if (source?.[key] == null || source[key] === "") continue;
      if (Number.isFinite(Number(source[key])) && Number(source[key]) >= 0) assets[canonical] = Number(source[key]);
    }
    return assets;
  } catch {
    return {};
  }
}

/**
 * Populate every mapped form control.
 * @param {Object<string, string|number|null>} values Form values keyed by model field name.
 */
function populateForm(values) {
  for (const [key, id] of Object.entries(fields)) {
    const input = document.getElementById(id);
    input.value = values[key] ?? "";
  }
  updateBoostOutput();
}

/** Synchronise the boost range's visible percentage output. */
function updateBoostOutput() {
  const value = boostInput.value;
  boostOutput.value = `${value}%`;
  boostOutput.textContent = `${value}%`;
}

/**
 * Clamp the requested early-income boost to the safe pre-pension bridge limit.
 * @param {Object<string, *>} values Current model values.
 * @returns {Object<string, *>} The original or clamped model values.
 */
function constrainBoost(values) {
  const { boost, ...limitValues } = values;
  const cacheKey = JSON.stringify(limitValues);
  if (cacheKey !== boostLimitCacheKey) {
    boostLimitCacheKey = cacheKey;
    boostLimitCacheValue = maxBoostBeforePensionAccess(values);
  }

  boostInput.max = String(boostLimitCacheValue);
  if (boostLimitCacheValue < MAX_BOOST) {
    boostLimitNote.textContent = `Maximum safe uplift before pension access: ${boostLimitCacheValue}%. Higher values would exhaust stocks, ISA and cash before pensions unlock.`;
  } else {
    boostLimitNote.textContent = "The full 200% slider range is safe against exhausting stocks, ISA and cash before pension access under these assumptions.";
  }

  if (boost <= boostLimitCacheValue) return values;
  boostInput.value = String(boostLimitCacheValue);
  updateBoostOutput();
  return { ...values, boost: boostLimitCacheValue };
}

/**
 * Read mapped controls into the value shape expected by the financial model.
 * @returns {Object<string, string|number|null>} Current form values.
 */
function getValues() {
  const result = {};
  for (const [key, id] of Object.entries(fields)) {
    const input = document.getElementById(id);
    result[key] = input.type === "date" ? input.value : (input.value === "" ? null : Number(input.value));
  }
  return result;
}

/**
 * Validate browser constraints and cross-field model rules.
 * @param {Object<string, *>} values Candidate model values.
 * @param {boolean} [report=false] Whether to show native browser validation messages.
 * @returns {string} An error message, or an empty string when valid.
 */
function validate(values, report = false) {
  const valid = report ? form.reportValidity() : form.checkValidity();
  if (!valid) return "Please correct the highlighted field.";
  const birth = parseLocalDate(values.birthDate);
  const retirement = parseLocalDate(values.retirementDate);
  if (retirement <= birth) return "Retirement must be after the birth date.";
  if (values.stateAge <= values.pensionAge) return "State Pension age must be later than private pension access age.";
  if ((values.inheritanceYear == null) !== (values.inheritanceAmount == null || values.inheritanceAmount === 0)) {
    return "Enter both an inheritance year and amount, or leave both blank.";
  }
  if (values.inheritanceYear != null && values.inheritanceYear < retirement.getFullYear()) {
    return "Inheritance year cannot be before retirement.";
  }
  if (values.realReturn <= -100 || values.inflation <= -100) return "Return and inflation must be greater than -100%.";
  return "";
}

/**
 * Calculate all scenarios and replace the current result views.
 * @param {Object<string, *>} values Valid model values.
 */
function render(values) {
  const three = scenario(values, 0.03);
  const four = scenario(values, 0.04);
  const downsideValues = { ...values, realReturn: 1 };
  const downsideThree = scenario(downsideValues, 0.03);
  const downsideFour = scenario(downsideValues, 0.04);
  currentResults = { three, four, downsideThree, downsideFour, values };

  const total = three.startingBalance;
  const accessible = values.stocks + values.isa + values.cash;
  basis.textContent = `${money.format(total)} starting portfolio · ${values.realReturn}% real return · ${values.horizon} years`;

  summaryGrid.replaceChildren(
    summaryCard("Starting portfolio", money.format(total), {
      main: `${money.format(accessible)} in stocks, ISA & cash · ${money.format(values.pensionOne + values.pensionTwo)} in pensions`
    }),
    summaryCard("3% plan · end balance", money.format(three.rows.at(-1).balance), annualDrawDetail(values, three), "three", downsideWarning(downsideThree)),
    summaryCard("4% plan · end balance", money.format(four.rows.at(-1).balance), annualDrawDetail(values, four), "four", downsideWarning(downsideFour)),
    summaryCard("Inheritance", values.inheritanceAmount ? money.format(values.inheritanceAmount) : "None", {
      main: values.inheritanceAmount ? `Nominal amount in ${values.inheritanceYear}` : "No inheritance included"
    })
  );

  renderEarlyIncomePreview(values, three, four);
  const needsCareRecommendation = renderCareGuidance(values, three, four, false);
  tablesGrid.replaceChildren(renderTable(three), renderTable(four));
  drawChart(three, four, downsideThree, downsideFour, values);
  if (needsCareRecommendation) scheduleCareGuidance(values, three, four);
}

/**
 * Build the standard and optional early annual-draw descriptions for a plan.
 * @param {Object<string, *>} values Current model values.
 * @param {Object} result Calculated plan result.
 * @returns {{main: string, early?: string}} Summary-card detail text.
 */
function annualDrawDetail(values, result) {
  const standard = `${money.format(result.baseAnnualIncome)} standard annual draw`;
  const retirementAge = ageAt(parseLocalDate(values.retirementDate), parseLocalDate(values.birthDate));
  const earlyPhaseActive = retirementAge < values.boostUntilAge && values.boost > 0;
  if (!earlyPhaseActive) return { main: standard };
  const higher = result.baseAnnualIncome * (1 + values.boost / 100);
  return {
    main: standard,
    early: `${money.format(higher)} higher early annual draw until age ${values.boostUntilAge}`
  };
}

/**
 * Describe when a downside scenario first reaches zero.
 * @param {Object} result Calculated downside plan.
 * @returns {string} Warning text, or an empty string when funds remain.
 */
function downsideWarning(result) {
  const zeroRow = result.rows.find(row => row.balance < 0.01);
  return zeroRow ? `This plan reaches £0 in ${zeroRow.year} (age ${zeroRow.age}).` : "";
}

/**
 * Build a result summary card.
 * @param {string} label Card label.
 * @param {string} value Primary formatted value.
 * @param {{main: string, early?: string}} detail Supporting text.
 * @param {string} [colour=""] Optional fixed colour modifier.
 * @param {string} [warning=""] Optional downside warning.
 * @returns {HTMLElement} The complete card element.
 */
function summaryCard(label, value, detail, colour = "", warning = "") {
  const article = document.createElement("article");
  article.className = `summary-card${colour ? ` summary-card--${colour}` : ""}${warning ? " summary-card--warning" : ""}`;

  const labelEl = document.createElement("span");
  labelEl.className = "summary-card__label";
  labelEl.textContent = label;
  article.appendChild(labelEl);

  const valueEl = document.createElement("div");
  valueEl.className = "summary-card__value";
  valueEl.textContent = value;
  article.appendChild(valueEl);

  const detailEl = document.createElement("p");
  detailEl.className = "summary-card__detail";
  detailEl.textContent = detail.main;
  if (detail.early) {
    detailEl.appendChild(document.createElement("br"));
    const earlyEl = document.createElement("span");
    earlyEl.className = "summary-card__early-income";
    earlyEl.textContent = detail.early;
    detailEl.appendChild(earlyEl);
  }
  article.appendChild(detailEl);

  if (warning) {
    const warningEl = document.createElement("p");
    warningEl.className = "summary-card__warning";
    const strongEl = document.createElement("strong");
    strongEl.textContent = "1% return worst-case";
    warningEl.appendChild(strongEl);
    warningEl.appendChild(document.createTextNode(warning));
    article.appendChild(warningEl);
  }

  return article;
}

/**
 * Render first-year income with and without the early-spending uplift.
 * @param {Object<string, *>} values Current model values.
 * @param {Object} three Three-percent plan result.
 * @param {Object} four Four-percent plan result.
 */
function renderEarlyIncomePreview(values, three, four) {
  const birth = parseLocalDate(values.birthDate);
  const retirement = parseLocalDate(values.retirementDate);
  const retirementAge = ageAt(retirement, birth);
  const phaseActive = retirementAge < values.boostUntilAge && values.boost > 0;

  if (!phaseActive) {
    const note = document.createElement("p");
    note.className = "early-income-preview__note";
    note.textContent = `No higher-income phase applies at retirement with these settings. First-year net income would be ${money.format(three.rows[0].netMonthly)}/month at 3% and ${money.format(four.rows[0].netMonthly)}/month at 4%.`;
    earlyIncomePreview.replaceChildren(note);
    return;
  }

  const baselineValues = { ...values, boost: 0 };
  const baselineThree = scenario(baselineValues, 0.03);
  const baselineFour = scenario(baselineValues, 0.04);

  const itemThree = document.createElement("div");
  itemThree.className = "early-income-preview__item early-income-preview__item--three";
  const labelThree = document.createElement("span");
  labelThree.className = "early-income-preview__label";
  labelThree.textContent = "3% plan · net monthly";
  const valueThree = document.createElement("strong");
  valueThree.className = "early-income-preview__value";
  valueThree.textContent = money.format(three.rows[0].netMonthly);
  const baselineLabelThree = document.createElement("span");
  baselineLabelThree.className = "early-income-preview__baseline";
  baselineLabelThree.append("Without uplift: ");
  const baselineValueThree = document.createElement("strong");
  baselineValueThree.textContent = `${money.format(baselineThree.rows[0].netMonthly)}/month`;
  baselineLabelThree.appendChild(baselineValueThree);
  itemThree.append(labelThree, valueThree, baselineLabelThree);

  const itemFour = document.createElement("div");
  itemFour.className = "early-income-preview__item early-income-preview__item--four";
  const labelFour = document.createElement("span");
  labelFour.className = "early-income-preview__label";
  labelFour.textContent = "4% plan · net monthly";
  const valueFour = document.createElement("strong");
  valueFour.className = "early-income-preview__value";
  valueFour.textContent = money.format(four.rows[0].netMonthly);
  const baselineLabelFour = document.createElement("span");
  baselineLabelFour.className = "early-income-preview__baseline";
  baselineLabelFour.append("Without uplift: ");
  const baselineValueFour = document.createElement("strong");
  baselineValueFour.textContent = `${money.format(baselineFour.rows[0].netMonthly)}/month`;
  baselineLabelFour.appendChild(baselineValueFour);
  itemFour.append(labelFour, valueFour, baselineLabelFour);

  const note = document.createElement("p");
  note.className = "early-income-preview__note";
  note.textContent = `Average for the first 12 projection months with a ${values.boost}% uplift, continuing until age ${values.boostUntilAge}.`;

  earlyIncomePreview.replaceChildren(itemThree, itemFour, note);
}

/**
 * Render age-90 reserve guidance and optionally solve spend-more recommendations.
 * @param {Object<string, *>} values Current model values.
 * @param {Object} three Three-percent plan result.
 * @param {Object} four Four-percent plan result.
 * @param {boolean} [calculateRecommendation=true] Whether to run the expensive solvers now.
 * @returns {boolean} Whether a deferred recommendation render is required.
 */
function renderCareGuidance(values, three, four, calculateRecommendation = true) {
  const plans = [three, four].map(result => ({
    result,
    label: `${Math.round(result.rate * 100)}% plan`,
    balance: balanceAtAge(result, CARE_RESERVE_AGE),
    get status() { return this.balance == null ? "unavailable" : careReserveStatus(this.balance); }
  }));

  if (plans.some(plan => plan.balance == null)) {
    updateCareGuidance(
      "care-guidance care-guidance--caution",
      false,
      "Extend the projection to assess care reserves",
      [`The current horizon does not reach age ${CARE_RESERVE_AGE}. Increase it before using the £1m care-reserve guide.`]
    );
    return false;
  }

  const balances = plans.map(plan => ({ strong: `${plan.label}: ${money.format(plan.balance)}` }));
  const surplusPlans = plans.filter(plan => plan.status === "surplus");

  if (surplusPlans.length === 0) {
    const shortfallPlans = plans.filter(plan => plan.status === "shortfall");
    const message = shortfallPlans.length === plans.length
      ? "Neither plan reaches the £1m ten-year care assumption, so the model does not suggest increasing early spending."
      : shortfallPlans.length
        ? `${shortfallPlans.map(plan => plan.label).join(" and ")} falls below the £1m care assumption; no spend-more suggestion is made for that plan.`
        : "Both plans finish exactly on the £1m care-reserve target.";
    updateCareGuidance(
      `care-guidance${shortfallPlans.length ? " care-guidance--caution" : ""}`,
      false,
      "Age-90 care reserve",
      [interleave(balances, " · ").concat("."), message]
    );
    return false;
  }

  if (!calculateRecommendation) {
    updateCareGuidance(
      "care-guidance",
      true,
      "Age-90 care reserve",
      [interleave(balances, " · ").concat("."), "Updating the early-spending suggestion…"]
    );
    return true;
  }

  const bridgeMax = maxBoostBeforePensionAccess(values);
  const recommendations = surplusPlans.map(plan => {
    const suggestedBoost = solveBoostForCareReserve(values, plan.result.rate);
    if (suggestedBoost == null) {
      const suggestedRate = solveRateForCareReserve(values);
      if (suggestedRate == null) return [`${plan.label} remains above £1m even at the model's tested spending limits.`];
      const maximumBoostBalance = balanceAtAge(scenario({ ...values, boost: MAX_BOOST }, plan.result.rate), CARE_RESERVE_AGE);
      return [
        `${plan.label}: even the tested maximum uplift leaves about `,
        { strong: money.format(maximumBoostBalance) },
        " at 90. A broader initial drawdown near ",
        { strong: `${(suggestedRate * 100).toFixed(2)}%` },
        " would target roughly £1m, but the slider is capped at ",
        { strong: `${bridgeMax}%` },
        " to protect the pre-pension bridge."
      ];
    }
    if (suggestedBoost > bridgeMax) {
      return [
        `${plan.label}: reaching £1m at 90 would need an uplift near `,
        { strong: `${Math.round(suggestedBoost)}%` },
        ", but the slider is capped at ",
        { strong: `${bridgeMax}%` },
        " to prevent the non-pension pot running out before pensions unlock."
      ];
    }
    const earlyAnnual = plan.result.startingBalance * plan.result.rate * (1 + suggestedBoost / 100);
    return [
      `${plan.label}: try an early-income uplift near `,
      { strong: `${Math.round(suggestedBoost)}%` },
      ", giving about ",
      { strong: `${money.format(earlyAnnual)} gross a year` },
      ` before age ${values.boostUntilAge}.`
    ];
  });

  const belowTarget = plans.filter(plan => plan.status === "shortfall");
  const paragraphs = [interleave(balances, " · ").concat(".")];
  if (belowTarget.length) {
    paragraphs.push(`${belowTarget.map(plan => plan.label).join(" and ")} is below £1m, so the spend-more suggestion applies only to the plan above the reserve.`);
  }
  paragraphs.push(
    interleave(recommendations, " ").flat(),
    "These are deterministic estimates, so retain additional margin if investment or care-cost uncertainty concerns you."
  );
  updateCareGuidance(
    "care-guidance",
    false,
    "You may be reserving more than ten years of care costs",
    paragraphs
  );
  return false;
}

/**
 * Insert a separator between each item without converting rich-text parts to HTML.
 * @param {Array<*>} items Items to interleave.
 * @param {string} separator Separator text.
 * @returns {Array<*>} Interleaved items.
 */
function interleave(items, separator) {
  return items.flatMap((item, index) => index === 0 ? [item] : [separator, item]);
}

/**
 * Append plain and strongly emphasised text parts using DOM nodes.
 * @param {Node} parent Destination node.
 * @param {string|Object|Array<string|Object>} parts Plain strings or `{strong: string}` values.
 */
function appendRichText(parent, parts) {
  for (const part of Array.isArray(parts) ? parts.flat() : [parts]) {
    if (typeof part === "string") {
      parent.append(part);
    } else {
      const strong = document.createElement("strong");
      strong.textContent = part.strong;
      parent.appendChild(strong);
    }
  }
}

/**
 * Replace the care-guidance panel while preserving its accessibility state.
 * @param {string} className Fixed panel classes.
 * @param {boolean} busy Whether recommendation calculation is pending.
 * @param {string} title Guidance heading.
 * @param {Array<string|Array<*>>} paragraphs Rich-text paragraph definitions.
 */
function updateCareGuidance(className, busy, title, paragraphs) {
  careGuidance.className = className;
  if (busy) careGuidance.setAttribute("aria-busy", "true");
  else careGuidance.removeAttribute("aria-busy");

  const icon = document.createElement("div");
  icon.className = "care-guidance__icon";
  icon.setAttribute("aria-hidden", "true");
  icon.textContent = "90";

  const content = document.createElement("div");
  const heading = document.createElement("h3");
  heading.textContent = title;
  content.appendChild(heading);
  for (const paragraphParts of paragraphs) {
    const paragraph = document.createElement("p");
    appendRichText(paragraph, paragraphParts);
    content.appendChild(paragraph);
  }
  careGuidance.replaceChildren(icon, content);
}

/** Cancel any queued care-recommendation calculation. */
function cancelCareGuidance() {
  careVersion += 1;
  if (!careJob) return;
  if (careJob.type === "idle") window.cancelIdleCallback(careJob.id);
  else clearTimeout(careJob.id);
  careJob = null;
}

/**
 * Defer care-reserve solving until input activity has settled and the browser is idle.
 * @param {Object<string, *>} values Current model values.
 * @param {Object} three Three-percent plan result.
 * @param {Object} four Four-percent plan result.
 */
function scheduleCareGuidance(values, three, four) {
  cancelCareGuidance();
  const version = careVersion;
  const run = () => {
    careJob = null;
    if (version !== careVersion) return;
    renderCareGuidance(values, three, four, true);
  };
  careJob = { type: "timer", id: setTimeout(() => {
    careJob = null;
    if (version !== careVersion) return;
    if ("requestIdleCallback" in window) {
      careJob = { type: "idle", id: window.requestIdleCallback(run, { timeout: 250 }) };
    } else {
      careJob = { type: "timer", id: setTimeout(run, 0) };
    }
  }, 150) };
}

/**
 * Build a complete projection table card for one drawdown plan.
 * @param {Object} result Calculated plan result.
 * @returns {HTMLElement} Projection table card.
 */
function renderTable(result) {
  const rateLabel = `${Math.round(result.rate * 100)}% drawdown`;
  const groupedRows = groupTableRows(result.rows);
  const maxPotTotal = Math.max(result.startingBalance, ...result.rows.map(row => row.balance), 1);
  const openingRow = document.createElement("tr");
  openingRow.className = "opening-row";
  const openingYear = tableCell(`Opening · ${result.startingYear}`);
  openingYear.appendChild(note("Retirement date", "pot-note pot-note--opening"));
  const openingPension = tableCell(money.format(result.startingPension));
  if (!result.pensionAvailableAtStart) openingPension.appendChild(note("Locked", "pot-note"));
  const openingMix = tableCell();
  openingMix.className = "pot-mix-cell";
  openingMix.appendChild(renderPotMix(result.startingPots, result.startingBalance, maxPotTotal, 0));
  openingRow.append(
    openingYear,
    tableCell(String(result.startingAge)),
    tableCell("—"),
    openingPension,
    tableCell(money.format(result.startingAvailablePot)),
    openingMix
  );

  const projectedRows = groupedRows.map(group => {
    const row = group.end;
    const eventRow = group.start;
    const event = eventRow.pensionStarted || eventRow.inheritedThisYear || eventRow.stateStarted;
    const yearRange = group.start.year === row.year ? `${row.year}` : `${group.start.year}–${row.year}`;
    const ageRange = group.start.age === row.age ? `${row.age}` : `${group.start.age}–${row.age}`;
    const tableRow = document.createElement("tr");
    if (event) tableRow.className = "event-row";

    const yearCell = tableCell(yearRange);
    const eventTags = document.createElement("span");
    eventTags.className = "event-tags";
    if (eventRow.pensionStarted) eventTags.appendChild(eventTag("Private pensions", "pension"));
    if (eventRow.inheritedThisYear) eventTags.appendChild(eventTag("Inheritance", "inheritance"));
    if (eventRow.stateStarted) eventTags.appendChild(eventTag("State Pension", "state"));
    if (eventTags.childElementCount) yearCell.appendChild(eventTags);

    const incomeCell = tableCell(money.format(row.netMonthly));
    if (row.stateOnly) incomeCell.appendChild(note("State Pension only", "income-note"));
    const pensionCell = tableCell(money.format(row.pensionBalance));
    if (!row.pensionAvailable) pensionCell.appendChild(note("Locked", "pot-note"));
    const availableCell = tableCell(row.depleted ? "Depleted" : money.format(row.availablePot));
    if (row.depleted) availableCell.className = "depleted";
    const mixCell = tableCell();
    mixCell.className = "pot-mix-cell";
    mixCell.appendChild(renderPotMix({
      stocks: row.stocksBalance,
      isa: row.isaBalance,
      cash: row.cashBalance,
      pensionOne: row.pensionOneBalance,
      pensionTwo: row.pensionTwoBalance
    }, row.balance, maxPotTotal, row.stateIncome));
    tableRow.append(yearCell, tableCell(ageRange), incomeCell, pensionCell, availableCell, mixCell);
    return tableRow;
  });

  const depletedMessage = result.depletedAt
    ? `Funds first become insufficient in ${result.depletedAt.toLocaleDateString("en-GB", { month: "long", year: "numeric" })}.`
    : `Available pot ends with ${money.format(result.rows.at(-1).availablePot)} in today's money.`;

  const article = document.createElement("article");
  article.className = "table-card";
  const heading = document.createElement("div");
  heading.className = "table-card__heading";
  const title = document.createElement("h3");
  title.textContent = rateLabel;
  heading.append(
    title,
    paragraph(`${depletedMessage} Grouped where income is unchanged; the available pot is at range end.`),
    paragraph("The available pot is stocks, ISA and cash before pension access, and includes pensions once unlocked · key events are colour coded")
  );

  const scroll = document.createElement("div");
  scroll.className = "table-scroll";
  scroll.tabIndex = 0;
  scroll.setAttribute("role", "region");
  scroll.setAttribute("aria-label", `${rateLabel} projection table; scroll horizontally to see all columns`);
  const scrollHint = paragraph("Swipe horizontally to see all columns");
  scrollHint.className = "table-scroll-hint";
  const table = document.createElement("table");
  const head = document.createElement("thead");
  const headingRow = document.createElement("tr");
  for (const label of ["Year(s)", "Age(s)", "Net / month", "Pension pot", "Available pot", "Pot mix"]) {
    const cell = document.createElement("th");
    cell.textContent = label;
    headingRow.appendChild(cell);
  }
  head.appendChild(headingRow);
  const body = document.createElement("tbody");
  body.append(openingRow, ...projectedRows);
  table.append(head, body);
  scroll.appendChild(table);
  article.append(heading, scrollHint, scroll, renderPotNarrative(result));
  return article;
}

/**
 * Create a table-data cell containing plain text.
 * @param {string} [text=""] Cell text.
 * @returns {HTMLTableCellElement} Table cell.
 */
function tableCell(text = "") {
  const cell = document.createElement("td");
  cell.textContent = text;
  return cell;
}

/**
 * Create a plain-text paragraph.
 * @param {string} text Paragraph text.
 * @returns {HTMLParagraphElement} Paragraph node.
 */
function paragraph(text) {
  const element = document.createElement("p");
  element.textContent = text;
  return element;
}

/**
 * Create a labelled table note.
 * @param {string} text Note text.
 * @param {string} className Fixed note classes.
 * @returns {HTMLElement} Small-note element.
 */
function note(text, className) {
  const element = document.createElement("small");
  element.className = className;
  element.textContent = text;
  return element;
}

/**
 * Create a colour-coded projection event label.
 * @param {string} text Event label.
 * @param {string} modifier Fixed event colour modifier.
 * @returns {HTMLSpanElement} Event tag.
 */
function eventTag(text, modifier) {
  const element = document.createElement("span");
  element.className = `event-tag event-tag--${modifier}`;
  element.textContent = text;
  return element;
}

/**
 * Build the accessible stacked pot-mix bar graphic for a projection row.
 * @param {Object<string, number>} pots Component balances.
 * @param {number} total Total portfolio balance used in the accessible label.
 * @param {number} scale Shared vertical bar scale.
 * @param {number} stateIncome Annual State Pension income.
 * @returns {HTMLElement} Pot bars or an empty-state marker.
 */
function renderPotMix(pots, total, scale, stateIncome) {
  const entries = [
    ["Stocks", "St", pots.stocks, "stocks", scale],
    ["ISA", "ISA", pots.isa, "isa", scale],
    ["Cash", "Ca", pots.cash, "cash", scale],
    ["Company Pension / SIPP 1", "P1", pots.pensionOne, "pension-one", scale],
    ["Company Pension / SIPP 2", "P2", pots.pensionTwo, "pension-two", scale],
    ["State Pension (annual)", "SP", stateIncome, "state", scale]
  ].filter(([, , value]) => value > 0.005);
  if (entries.length === 0) {
    const empty = document.createElement("span");
    empty.className = "pot-mix-empty";
    empty.textContent = "—";
    return empty;
  }
  const description = entries.map(([label, , value]) => `${label} ${money.format(value)}`).join(", ");
  const bars = document.createElement("div");
  bars.className = "pot-bars";
  bars.style.setProperty("--bar-count", String(entries.length));
  bars.setAttribute("role", "img");
  bars.setAttribute("aria-label", `Pot mix at ${money.format(total)}: ${description}`);
  for (const [label, shortLabel, value, colour, barScale] of entries) {
    const height = Math.min(100, Math.max(0, value / barScale * 100));
    const bar = document.createElement("span");
    bar.className = `pot-bar pot-bar--${colour}`;
    bar.title = `${label}: ${money.format(value)}`;
    const fill = document.createElement("i");
    fill.style.height = `${height.toFixed(2)}%`;
    const abbreviation = document.createElement("b");
    abbreviation.textContent = shortLabel;
    bar.append(fill, abbreviation);
    bars.appendChild(bar);
  }
  return bars;
}

/**
 * Explain the order and timing in which a plan consumes its pots.
 * @param {Object} result Calculated plan result.
 * @returns {HTMLElement} Narrative section.
 */
function renderPotNarrative(result) {
  const pensionStart = result.rows.find(row => row.pensionStarted);
  const stateStart = result.rows.find(row => row.stateStarted);
  const inheritance = result.rows.find(row => row.inheritedThisYear);
  const finalRow = result.rows.at(-1);
  const finalAccessibleDepletionIndex = result.rows.findIndex((row, index, rows) =>
    row.accessibleBalance < 0.01 && rows.slice(index).every(later => later.accessibleBalance < 0.01)
  );
  const finalPensionDepletionIndex = result.startingPension > 0
    ? result.rows.findIndex((row, index, rows) =>
      row.pensionBalance < 0.01 && rows.slice(index).every(later => later.pensionBalance < 0.01)
    )
    : -1;
  const items = [];

  if (result.pensionAvailableAtStart) {
    items.push("Private pensions are available from retirement, so the model can use all pots from the opening year.");
  } else if (pensionStart) {
    items.push(`Until pensions unlock in ${pensionStart.year} (age ${pensionStart.age}), withdrawals come only from stocks, ISA and cash; pensions remain invested but locked.`);
  } else {
    items.push("Throughout this projection, withdrawals come only from stocks, ISA and cash because private pension access falls beyond the selected horizon.");
  }

  if (inheritance) {
    items.push(`The inheritance is added to the non-pension pot in ${inheritance.year}, increasing stocks, ISA and cash rather than the pension pot.`);
  }

  if (pensionStart && stateStart) {
    items.push(`From pension access until State Pension starts in ${stateStart.year} (age ${stateStart.age}), the model draws a tax-efficient pension amount first, then stocks, ISA and cash, then any additional pension needed.`);
  } else if (pensionStart) {
    items.push("After pension access, the model draws a tax-efficient pension amount first, then stocks, ISA and cash, then any additional pension needed.");
  }

  if (stateStart) {
    items.push(`From ${stateStart.year}, State Pension offsets part of the income target. Remaining withdrawals use stocks, ISA and cash first and pensions second; pension income can therefore reduce net monthly income through tax.`);
  }

  if (finalAccessibleDepletionIndex >= 0 && result.startingAccessible > 0) {
    const row = result.rows[finalAccessibleDepletionIndex];
    items.push(`The non-pension pot is finally exhausted in ${row.year} (age ${row.age}); subsequent portfolio withdrawals must come from pensions.`);
  }

  if (finalPensionDepletionIndex >= 0) {
    const row = result.rows[finalPensionDepletionIndex];
    items.push(`The pension pot is finally exhausted in ${row.year} (age ${row.age}).`);
  }

  items.push(`At the end of the projection, ${money.format(finalRow.accessibleBalance)} remains in stocks, ISA and cash, and ${money.format(finalRow.pensionBalance)} remains in pensions.`);

  if (result.depletedAt) {
    items.push({
      strong: `Income first becomes underfunded in ${result.depletedAt.toLocaleDateString("en-GB", { month: "long", year: "numeric" })}; the displayed target income is not fully delivered from that point unless later funds arrive.`
    });
  }

  const narrative = document.createElement("div");
  narrative.className = "pot-narrative";
  const heading = document.createElement("h4");
  heading.textContent = "How this path uses your pots";
  const list = document.createElement("ul");
  for (const item of items) {
    const listItem = document.createElement("li");
    appendRichText(listItem, item);
    list.appendChild(listItem);
  }
  narrative.append(heading, list);
  return narrative;
}

/**
 * Group adjacent projection years with unchanged rounded income and depletion state.
 * @param {Array<Object>} rows Annual projection rows.
 * @returns {Array<{start: Object, end: Object}>} Display row ranges.
 */
function groupTableRows(rows) {
  const grouped = [];
  let index = 0;

  while (index < rows.length) {
    const start = rows[index];
    const startIsEvent = isKeyEvent(start);
    let endIndex = index;

    if (!startIsEvent) {
      while (endIndex + 1 < rows.length) {
        const next = rows[endIndex + 1];
        if (isKeyEvent(next) || Math.round(next.netMonthly) !== Math.round(start.netMonthly) || next.depleted !== start.depleted) break;
        endIndex += 1;
      }
    }

    grouped.push({ start, end: rows[endIndex] });
    index = endIndex + 1;
  }

  return grouped;
}

/**
 * Test whether a projection row must be displayed separately as a key event.
 * @param {Object} row Annual projection row.
 * @returns {boolean} Whether the row contains a key event.
 */
function isKeyEvent(row) {
  return row.pensionStarted || row.inheritedThisYear || row.stateStarted || row.depletionStarted;
}

/**
 * Draw main and downside available-pot paths and cache hover geometry.
 * @param {Object} three Three-percent plan result.
 * @param {Object} four Four-percent plan result.
 * @param {Object} downsideThree Three-percent downside result.
 * @param {Object} downsideFour Four-percent downside result.
 * @param {Object<string, *>} values Current model values.
 */
function drawChart(three, four, downsideThree, downsideFour, values) {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);

  const width = rect.width;
  const height = rect.height;
  const pad = { top: 78, right: 18, bottom: 38, left: width < 520 ? 54 : 72 };
  const plotWidth = width - pad.left - pad.right;
  const plotHeight = height - pad.top - pad.bottom;
  const all = [...three.rows, ...four.rows, ...downsideThree.rows, ...downsideFour.rows];
  const maxAvailablePot = Math.max(three.startingAvailablePot, ...all.map(row => row.availablePot));
  const yMax = niceCeiling(maxAvailablePot);
  const xFor = index => pad.left + (index / Math.max(1, three.rows.length - 1)) * plotWidth;
  const yFor = value => pad.top + plotHeight - (Math.max(0, value) / yMax) * plotHeight;

  ctx.clearRect(0, 0, width, height);
  ctx.font = "12px system-ui, sans-serif";
  ctx.fillStyle = "#64736f";
  ctx.strokeStyle = "#e4e8e1";
  ctx.lineWidth = 1;

  for (let tick = 0; tick <= 4; tick += 1) {
    const value = yMax * tick / 4;
    const y = yFor(value);
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(width - pad.right, y);
    ctx.stroke();
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillText(compactMoney.format(value), pad.left - 9, y);
  }

  const labelEvery = Math.max(1, Math.ceil(three.rows.length / (width < 600 ? 5 : 8)));
  three.rows.forEach((row, index) => {
    if (index % labelEvery !== 0 && index !== three.rows.length - 1) return;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(String(row.year), xFor(index), height - pad.bottom + 12);
  });

  const retirementAge = ageAt(parseLocalDate(values.retirementDate), parseLocalDate(values.birthDate));
  if (retirementAge < values.boostUntilAge && values.boost > 0) drawHigherIncomeBand(ctx, three, xFor, height, pad, values);

  plotLine(ctx, downsideThree.rows, xFor, yFor, "#16735f", [6, 6], 2, "availablePot");
  plotLine(ctx, downsideFour.rows, xFor, yFor, "#dc6f3d", [6, 6], 2, "availablePot");
  plotLine(ctx, three.rows, xFor, yFor, "#16735f", [], 3, "availablePot");
  plotLine(ctx, four.rows, xFor, yFor, "#dc6f3d", [], 3, "availablePot");

  const eventMarkers = [
    { index: three.rows.findIndex(row => row.pensionStarted), label: width < 520 ? "Pensions" : "Private pensions", colour: "#416b9a" },
    { index: three.rows.findIndex(row => row.inheritedThisYear), label: "Inheritance", colour: "#8a7460" },
    { index: three.rows.findIndex(row => row.stateStarted), label: width < 520 ? "State" : "State Pension", colour: "#765a96" }
  ].filter(marker => marker.index >= 0);

  eventMarkers.forEach((marker, markerIndex) => {
    const x = xFor(marker.index);
    const labelY = 12 + markerIndex * 20;
    ctx.save();
    ctx.setLineDash([4, 5]);
    ctx.strokeStyle = marker.colour;
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    ctx.moveTo(x, pad.top - 5);
    ctx.lineTo(x, height - pad.bottom);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = marker.colour;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.font = "700 11px system-ui, sans-serif";
    ctx.fillText(`${marker.label} · ${three.rows[marker.index].year}`, x, labelY);
    ctx.restore();
  });

  chartGeometry = { xFor, yFor, pad, plotWidth, rows: three.rows, three, four, downsideThree, downsideFour, width, height };
  dismissChartSelection();
}

/** Return the nearest plotted year for a viewport x-coordinate. */
function nearestChartIndex(clientX) {
  if (!chartGeometry) return -1;
  const rect = canvas.getBoundingClientRect();
  const relative = (clientX - rect.left - chartGeometry.pad.left) / chartGeometry.plotWidth;
  const index = Math.round(relative * (chartGeometry.rows.length - 1));
  return index >= 0 && index < chartGeometry.rows.length ? index : -1;
}

/** Build the visible and announced details for one chart year. */
function chartSelection(index) {
  const threeRow = chartGeometry.three.rows[index];
  const fourRow = chartGeometry.four.rows[index];
  const threeIncomeNote = threeRow.stateOnly ? " (State Pension only)" : "";
  const fourIncomeNote = fourRow.stateOnly ? " (State Pension only)" : "";
  const heading = `${threeRow.year} · age ${threeRow.age}`;
  const threeText = `3% available: ${money.format(threeRow.availablePot)} · total ${money.format(threeRow.balance)} · ${money.format(threeRow.netMonthly)}/month${threeIncomeNote}`;
  const fourText = `4% available: ${money.format(fourRow.availablePot)} · total ${money.format(fourRow.balance)} · ${money.format(fourRow.netMonthly)}/month${fourIncomeNote}`;
  return { heading, threeText, fourText, threeRow, fourRow };
}

/** Clamp and place the chart tooltip above its point, or below when space is tight. */
function positionChartTooltip(index) {
  const { threeRow, fourRow } = chartSelection(index);
  const anchorX = chartGeometry.xFor(index);
  const anchorY = Math.min(chartGeometry.yFor(threeRow.availablePot), chartGeometry.yFor(fourRow.availablePot));
  const tooltipWidth = tooltip.offsetWidth;
  const tooltipHeight = tooltip.offsetHeight;
  const left = Math.min(chartGeometry.width - tooltipWidth - 8, Math.max(8, anchorX - tooltipWidth / 2));
  const above = anchorY - tooltipHeight - 12;
  const below = Math.min(chartGeometry.height - tooltipHeight - 8, anchorY + 12);
  tooltip.style.left = `${Math.max(8, left)}px`;
  tooltip.style.top = `${Math.max(8, above >= 8 ? above : below)}px`;
}

/** Render a transient or locked chart selection and optionally announce it. */
function showChartSelection(index, announce = false) {
  if (!chartGeometry || index < 0 || index >= chartGeometry.rows.length) return;
  const selection = chartSelection(index);
  if (index !== tooltipIndex) {
    const heading = document.createElement("strong");
    heading.textContent = selection.heading;
    tooltip.replaceChildren(
      heading,
      document.createElement("br"),
      document.createTextNode(selection.threeText),
      document.createElement("br"),
      document.createTextNode(selection.fourText)
    );
    tooltipIndex = index;
  }
  tooltip.hidden = false;
  positionChartTooltip(index);
  if (announce) chartDetails.textContent = `${selection.heading}. ${selection.threeText}. ${selection.fourText}.`;
}

/** Clear locked and transient chart details. */
function dismissChartSelection() {
  lockedTooltipIndex = -1;
  tooltipIndex = -1;
  pendingPointer = null;
  tooltip.hidden = true;
  chartDetails.textContent = "No chart year selected.";
}

/**
 * Draw the early higher-income interval below the chart axis.
 * @param {CanvasRenderingContext2D} ctx Canvas drawing context.
 * @param {Object} result Calculated plan result.
 * @param {Function} xFor Convert a row index to an x-coordinate.
 * @param {number} height Canvas display height.
 * @param {Object<string, number>} pad Chart padding.
 * @param {Object<string, *>} values Current model values.
 */
function drawHigherIncomeBand(ctx, result, xFor, height, pad, values) {
  const endIndex = result.rows.findIndex(row => row.age >= values.boostUntilAge);
  const lastIndex = result.rows.length - 1;
  const index = endIndex >= 0 ? endIndex : lastIndex;
  if (index <= 0) return;
  const startX = xFor(0);
  const endX = xFor(index);
  const bandY = height - pad.bottom + 2;
  ctx.save();
  ctx.fillStyle = "#d39a3c";
  ctx.globalAlpha = 0.9;
  ctx.fillRect(startX, bandY, Math.max(2, endX - startX), 8);
  ctx.globalAlpha = 1;
  ctx.fillStyle = "#8a6226";
  ctx.font = "700 10px system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "bottom";
  ctx.fillText("Higher income", startX, bandY - 2);
  ctx.restore();
}

/**
 * Plot one series on the balance chart.
 * @param {CanvasRenderingContext2D} ctx Canvas drawing context.
 * @param {Array<Object>} rows Projection rows.
 * @param {Function} xFor Convert a row index to an x-coordinate.
 * @param {Function} yFor Convert a value to a y-coordinate.
 * @param {string} colour Stroke colour.
 * @param {number[]} [dash=[]] Canvas dash pattern.
 * @param {number} [lineWidth=3] Stroke width.
 * @param {string} [valueKey="availablePot"] Row property to plot.
 */
function plotLine(ctx, rows, xFor, yFor, colour, dash = [], lineWidth = 3, valueKey = "availablePot") {
  ctx.save();
  ctx.strokeStyle = colour;
  ctx.lineWidth = lineWidth;
  ctx.setLineDash(dash);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.beginPath();
  rows.forEach((row, index) => {
    const x = xFor(index);
    const y = yFor(row[valueKey]);
    if (index === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.stroke();
  ctx.restore();
}

/**
 * Round a chart maximum up to a readable half-magnitude boundary.
 * @param {number} value Unrounded maximum.
 * @returns {number} Rounded axis ceiling.
 */
function niceCeiling(value) {
  const magnitude = 10 ** Math.floor(Math.log10(Math.max(1, value)));
  return Math.ceil(value / magnitude * 2) / 2 * magnitude;
}

/**
 * Validate, persist, and render the latest form values.
 * @param {boolean} [report=false] Whether to show native validation messages.
 */
function saveAndRender(report = false) {
  let values = getValues();
  const error = validate(values, report);
  errorBox.textContent = error;
  if (error) return;
  values = constrainBoost(values);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(values));
    savedState.textContent = "Saved locally";
  } catch {
    savedState.textContent = "Browser storage unavailable";
  }
  render(values);
}

/** Coalesce rapid form changes into one animation-frame render. */
function scheduleRender() {
  if (renderFrame != null) cancelAnimationFrame(renderFrame);
  renderFrame = requestAnimationFrame(() => {
    renderFrame = null;
    const values = getValues();
    const error = validate(values);
    errorBox.textContent = error;
    if (!error) render(constrainBoost(values));
  });
}

/** Persist valid values after the input save debounce expires. */
function saveLatestValues() {
  saveTimer = null;
  const values = getValues();
  if (validate(values)) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(values));
    savedState.textContent = "Saved locally";
  } catch {
    savedState.textContent = "Browser storage unavailable";
  }
}

form.addEventListener("submit", event => {
  event.preventDefault();
  clearTimeout(saveTimer);
  if (renderFrame != null) cancelAnimationFrame(renderFrame);
  renderFrame = null;
  saveAndRender(true);
});

form.addEventListener("input", () => {
  updateBoostOutput();
  savedState.textContent = "Unsaved changes";
  cancelCareGuidance();
  scheduleRender();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveLatestValues, 400);
});

document.querySelector("#reset-defaults").addEventListener("click", () => {
  populateForm({ ...defaults, ...readDeveloperAssets() });
  saveAndRender();
});

document.querySelector("#clear-data").addEventListener("click", () => {
  clearTimeout(saveTimer);
  cancelCareGuidance();
  localStorage.removeItem(STORAGE_KEY);
  populateForm(defaults);
  render(defaults);
  savedState.textContent = "Saved data cleared";
  errorBox.textContent = "";
});

window.addEventListener("resize", () => {
  if (!currentResults) return;
  if (resizeFrame != null) cancelAnimationFrame(resizeFrame);
  resizeFrame = requestAnimationFrame(() => {
    resizeFrame = null;
    drawChart(currentResults.three, currentResults.four, currentResults.downsideThree, currentResults.downsideFour, currentResults.values);
  });
});

canvas.addEventListener("pointermove", event => {
  if (event.pointerType === "touch" || lockedTooltipIndex >= 0) return;
  pendingPointer = { clientX: event.clientX, clientY: event.clientY };
  if (!chartGeometry || pointerFrame != null) return;
  pointerFrame = requestAnimationFrame(() => {
    pointerFrame = null;
    if (!pendingPointer || !chartGeometry || lockedTooltipIndex >= 0) return;
    const index = nearestChartIndex(pendingPointer.clientX);
    if (index < 0 || index >= chartGeometry.rows.length) {
      tooltip.hidden = true;
      return;
    }
    showChartSelection(index);
  });
});

canvas.addEventListener("pointerleave", () => {
  pendingPointer = null;
  if (lockedTooltipIndex >= 0) return;
  tooltipIndex = -1;
  tooltip.hidden = true;
});

canvas.addEventListener("pointerup", event => {
  if (!event.isPrimary || (event.pointerType === "mouse" && event.button !== 0)) return;
  const index = nearestChartIndex(event.clientX);
  if (index < 0) return;
  if (lockedTooltipIndex === index) {
    dismissChartSelection();
    return;
  }
  lockedTooltipIndex = index;
  showChartSelection(index, true);
});

canvas.addEventListener("keydown", event => {
  if (!chartGeometry) return;
  let index = lockedTooltipIndex;
  if (event.key === "Escape") {
    if (index >= 0) {
      event.preventDefault();
      dismissChartSelection();
    }
    return;
  }
  if (event.key === "Home") index = 0;
  else if (event.key === "End") index = chartGeometry.rows.length - 1;
  else if (event.key === "ArrowLeft") index = index < 0 ? chartGeometry.rows.length - 1 : Math.max(0, index - 1);
  else if (event.key === "ArrowRight") index = index < 0 ? 0 : Math.min(chartGeometry.rows.length - 1, index + 1);
  else return;
  event.preventDefault();
  lockedTooltipIndex = index;
  showChartSelection(index, true);
});

document.addEventListener("pointerdown", event => {
  if (lockedTooltipIndex >= 0 && event.target !== canvas) dismissChartSelection();
});

/** Collapse the developer preset controls shortly after an action completes. */
function closeDeveloperToolsSoon() {
  clearTimeout(developerCloseTimer);
  developerCloseTimer = setTimeout(() => {
    developerCloseTimer = null;
    developerCorner.setAttribute("aria-expanded", "false");
    developerTools.hidden = true;
    developerCorner.focus();
  }, 1500);
}

developerCorner.addEventListener("click", () => {
  clearTimeout(developerCloseTimer);
  developerCloseTimer = null;
  const expanded = developerCorner.getAttribute("aria-expanded") === "true";
  developerCorner.setAttribute("aria-expanded", String(!expanded));
  developerTools.hidden = expanded;
  if (!expanded) {
    developerStatus.textContent = "";
    saveDeveloperPresetButton.focus();
  }
});

saveDeveloperPresetButton.addEventListener("click", () => {
  const values = getValues();
  const error = validate(values, true);
  if (error) {
    developerStatus.textContent = "Correct the highlighted fields first.";
    closeDeveloperToolsSoon();
    return;
  }
  const assets = {
    stocks: values.stocks,
    isa: values.isa,
    cash: values.cash,
    pensionOne: values.pensionOne,
    pensionTwo: values.pensionTwo,
    inheritanceYear: values.inheritanceYear,
    inheritanceAmount: values.inheritanceAmount
  };
  try {
    localStorage.setItem(DEVELOPER_STORAGE_KEY, JSON.stringify({ assets }));
    developerStatus.textContent = "Developer preset saved.";
  } catch {
    developerStatus.textContent = "Browser storage unavailable.";
  }
  closeDeveloperToolsSoon();
});

removeDeveloperPresetButton.addEventListener("click", () => {
  try {
    localStorage.removeItem(DEVELOPER_STORAGE_KEY);
    developerStatus.textContent = "Developer preset removed.";
  } catch {
    developerStatus.textContent = "Browser storage unavailable.";
  }
  closeDeveloperToolsSoon();
});

populateForm(readSavedValues());
saveAndRender();
