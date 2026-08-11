"use strict";

const STORAGE_KEY = "retirement-drawdown-model-v1";
const DEVELOPER_STORAGE_KEY = "developer";
const {
  CARE_RESERVE_AGE,
  CARE_RESERVE,
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
let tooltipWidth = 0;
let boostLimitCacheKey = "";
let boostLimitCacheValue = MAX_BOOST;

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

function populateForm(values) {
  for (const [key, id] of Object.entries(fields)) {
    const input = document.getElementById(id);
    input.value = values[key] ?? "";
  }
  updateBoostOutput();
}

function updateBoostOutput() {
  const value = boostInput.value;
  boostOutput.value = `${value}%`;
  boostOutput.textContent = `${value}%`;
}

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

function getValues() {
  const result = {};
  for (const [key, id] of Object.entries(fields)) {
    const input = document.getElementById(id);
    result[key] = input.type === "date" ? input.value : (input.value === "" ? null : Number(input.value));
  }
  return result;
}

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

  summaryGrid.innerHTML = [
    summaryCard("Starting portfolio", money.format(total), `${money.format(accessible)} in stocks, ISA & cash · ${money.format(values.pensionOne + values.pensionTwo)} in pensions`),
    summaryCard("3% plan · end balance", money.format(three.rows.at(-1).balance), annualDrawDetail(values, three), "three", downsideWarning(downsideThree)),
    summaryCard("4% plan · end balance", money.format(four.rows.at(-1).balance), annualDrawDetail(values, four), "four", downsideWarning(downsideFour)),
    summaryCard("Inheritance", values.inheritanceAmount ? money.format(values.inheritanceAmount) : "None", values.inheritanceAmount ? `Nominal amount in ${values.inheritanceYear}` : "No inheritance included")
  ].join("");

  renderEarlyIncomePreview(values, three, four);
  const needsCareRecommendation = renderCareGuidance(values, three, four, false);
  tablesGrid.innerHTML = [renderTable(three), renderTable(four)].join("");
  drawChart(three, four, downsideThree, downsideFour, values);
  if (needsCareRecommendation) scheduleCareGuidance(values, three, four);
}

function annualDrawDetail(values, result) {
  const standard = `${money.format(result.baseAnnualIncome)} standard annual draw`;
  const retirementAge = ageAt(parseLocalDate(values.retirementDate), parseLocalDate(values.birthDate));
  const earlyPhaseActive = retirementAge < values.boostUntilAge && values.boost > 0;
  if (!earlyPhaseActive) return standard;
  const higher = result.baseAnnualIncome * (1 + values.boost / 100);
  return `${standard}<br><span class="summary-card__early-income">${money.format(higher)} higher early annual draw until age ${values.boostUntilAge}</span>`;
}

function downsideWarning(result) {
  const zeroRow = result.rows.find(row => row.balance < 0.01);
  return zeroRow ? `At a 1% real return, this plan reaches £0 in ${zeroRow.year} (age ${zeroRow.age}).` : "";
}

function summaryCard(label, value, detail, colour = "", warning = "") {
  return `<article class="summary-card ${colour ? `summary-card--${colour}` : ""}${warning ? " summary-card--warning" : ""}">
    <span class="summary-card__label">${label}</span>
    <div class="summary-card__value">${value}</div>
    <p class="summary-card__detail">${detail}</p>
    ${warning ? `<p class="summary-card__warning"><strong>1% worst-case risk</strong>${warning}</p>` : ""}
  </article>`;
}

function renderEarlyIncomePreview(values, three, four) {
  const birth = parseLocalDate(values.birthDate);
  const retirement = parseLocalDate(values.retirementDate);
  const retirementAge = ageAt(retirement, birth);
  const phaseActive = retirementAge < values.boostUntilAge && values.boost > 0;

  if (!phaseActive) {
    earlyIncomePreview.innerHTML = `<p class="early-income-preview__note">No higher-income phase applies at retirement with these settings. First-year net income would be ${money.format(three.rows[0].netMonthly)}/month at 3% and ${money.format(four.rows[0].netMonthly)}/month at 4%.</p>`;
    return;
  }

  const baselineValues = { ...values, boost: 0 };
  const baselineThree = scenario(baselineValues, 0.03);
  const baselineFour = scenario(baselineValues, 0.04);

  earlyIncomePreview.innerHTML = `
    <div class="early-income-preview__item early-income-preview__item--three">
      <span class="early-income-preview__label">3% plan · net monthly</span>
      <strong class="early-income-preview__value">${money.format(three.rows[0].netMonthly)}</strong>
      <span class="early-income-preview__baseline">Without uplift: <strong>${money.format(baselineThree.rows[0].netMonthly)}/month</strong></span>
    </div>
    <div class="early-income-preview__item early-income-preview__item--four">
      <span class="early-income-preview__label">4% plan · net monthly</span>
      <strong class="early-income-preview__value">${money.format(four.rows[0].netMonthly)}</strong>
      <span class="early-income-preview__baseline">Without uplift: <strong>${money.format(baselineFour.rows[0].netMonthly)}/month</strong></span>
    </div>
    <p class="early-income-preview__note">Average for the first 12 projection months with a ${values.boost}% uplift, continuing until age ${values.boostUntilAge}.</p>`;
}

function renderCareGuidance(values, three, four, calculateRecommendation = true) {
  const plans = [three, four].map(result => ({
    result,
    label: `${Math.round(result.rate * 100)}% plan`,
    balance: balanceAtAge(result, CARE_RESERVE_AGE),
    get status() { return this.balance == null ? "unavailable" : careReserveStatus(this.balance); }
  }));

  if (plans.some(plan => plan.balance == null)) {
    careGuidance.className = "care-guidance care-guidance--caution";
    careGuidance.removeAttribute("aria-busy");
    careGuidance.innerHTML = `<div class="care-guidance__icon" aria-hidden="true">90</div><div><h3>Extend the projection to assess care reserves</h3><p>The current horizon does not reach age ${CARE_RESERVE_AGE}. Increase it before using the £1m care-reserve guide.</p></div>`;
    return false;
  }

  const balances = plans.map(plan => `<strong>${plan.label}: ${money.format(plan.balance)}</strong>`).join(" · ");
  const surplusPlans = plans.filter(plan => plan.status === "surplus");

  if (surplusPlans.length === 0) {
    const shortfallPlans = plans.filter(plan => plan.status === "shortfall");
    careGuidance.className = `care-guidance${shortfallPlans.length ? " care-guidance--caution" : ""}`;
    careGuidance.removeAttribute("aria-busy");
    const message = shortfallPlans.length === plans.length
      ? "Neither plan reaches the £1m ten-year care assumption, so the model does not suggest increasing early spending."
      : shortfallPlans.length
        ? `${shortfallPlans.map(plan => plan.label).join(" and ")} falls below the £1m care assumption; no spend-more suggestion is made for that plan.`
        : "Both plans finish exactly on the £1m care-reserve target.";
    careGuidance.innerHTML = `<div class="care-guidance__icon" aria-hidden="true">90</div><div><h3>Age-90 care reserve</h3><p>${balances}.</p><p>${message}</p></div>`;
    return false;
  }

  if (!calculateRecommendation) {
    careGuidance.className = "care-guidance";
    careGuidance.setAttribute("aria-busy", "true");
    careGuidance.innerHTML = `<div class="care-guidance__icon" aria-hidden="true">90</div><div><h3>Age-90 care reserve</h3><p>${balances}.</p><p>Updating the early-spending suggestion…</p></div>`;
    return true;
  }

  const bridgeMax = maxBoostBeforePensionAccess(values);
  const recommendations = surplusPlans.map(plan => {
    const suggestedBoost = solveBoostForCareReserve(values, plan.result.rate);
    if (suggestedBoost == null) {
      const suggestedRate = solveRateForCareReserve(values);
      if (suggestedRate == null) return `${plan.label} remains above £1m even at the model's tested spending limits.`;
      const maximumBoostBalance = balanceAtAge(scenario({ ...values, boost: MAX_BOOST }, plan.result.rate), CARE_RESERVE_AGE);
      return `${plan.label}: even the tested maximum uplift leaves about <strong>${money.format(maximumBoostBalance)}</strong> at 90. A broader initial drawdown near <strong>${(suggestedRate * 100).toFixed(2)}%</strong> would target roughly £1m, but the slider is capped at <strong>${bridgeMax}%</strong> to protect the pre-pension bridge.`;
    }
    if (suggestedBoost > bridgeMax) {
      return `${plan.label}: reaching £1m at 90 would need an uplift near <strong>${Math.round(suggestedBoost)}%</strong>, but the slider is capped at <strong>${bridgeMax}%</strong> to prevent the non-pension pot running out before pensions unlock.`;
    }
    const earlyAnnual = plan.result.startingBalance * plan.result.rate * (1 + suggestedBoost / 100);
    return `${plan.label}: try an early-income uplift near <strong>${Math.round(suggestedBoost)}%</strong>, giving about <strong>${money.format(earlyAnnual)} gross a year</strong> before age ${values.boostUntilAge}.`;
  }).join(" ");

  careGuidance.className = "care-guidance";
  careGuidance.removeAttribute("aria-busy");
  const belowTarget = plans.filter(plan => plan.status === "shortfall");
  const mixedMessage = belowTarget.length
    ? `<p>${belowTarget.map(plan => plan.label).join(" and ")} is below £1m, so the spend-more suggestion applies only to the plan above the reserve.</p>`
    : "";
  careGuidance.innerHTML = `<div class="care-guidance__icon" aria-hidden="true">90</div><div><h3>You may be reserving more than ten years of care costs</h3><p>${balances}.</p>${mixedMessage}<p>${recommendations}</p><p>These are deterministic estimates, so retain additional margin if investment or care-cost uncertainty concerns you.</p></div>`;
  return false;
}

function cancelCareGuidance() {
  careVersion += 1;
  if (!careJob) return;
  if (careJob.type === "idle") window.cancelIdleCallback(careJob.id);
  else clearTimeout(careJob.id);
  careJob = null;
}

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

function renderTable(result) {
  const rateLabel = `${Math.round(result.rate * 100)}% drawdown`;
  const groupedRows = groupTableRows(result.rows);
  const maxPotTotal = Math.max(result.startingBalance, ...result.rows.map(row => row.balance), 1);
  const openingRow = `<tr class="opening-row">
      <td>Opening · ${result.startingYear}<small class="pot-note pot-note--opening">Retirement date</small></td>
      <td>${result.startingAge}</td>
      <td>—</td>
      <td>${money.format(result.startingPension)}${result.pensionAvailableAtStart ? "" : '<small class="pot-note">Locked</small>'}</td>
      <td>${money.format(result.startingAvailablePot)}</td>
      <td class="pot-mix-cell">${renderPotMix(result.startingPots, result.startingBalance, maxPotTotal, 0)}</td>
    </tr>`;
  const projectedRows = groupedRows.map(group => {
    const row = group.end;
    const eventRow = group.start;
    const event = eventRow.pensionStarted || eventRow.inheritedThisYear || eventRow.stateStarted;
    const yearRange = group.start.year === row.year ? `${row.year}` : `${group.start.year}–${row.year}`;
    const ageRange = group.start.age === row.age ? `${row.age}` : `${group.start.age}–${row.age}`;
    const eventTags = [
      eventRow.pensionStarted ? '<span class="event-tag event-tag--pension">Private pensions</span>' : "",
      eventRow.inheritedThisYear ? '<span class="event-tag event-tag--inheritance">Inheritance</span>' : "",
      eventRow.stateStarted ? '<span class="event-tag event-tag--state">State Pension</span>' : ""
    ].filter(Boolean).join("");
    return `<tr class="${event ? "event-row" : ""}">
      <td>${yearRange}${eventTags ? `<span class="event-tags">${eventTags}</span>` : ""}</td>
      <td>${ageRange}</td>
      <td>${money.format(row.netMonthly)}${row.stateOnly ? '<small class="income-note">State Pension only</small>' : ""}</td>
      <td>${money.format(row.pensionBalance)}${row.pensionAvailable ? "" : '<small class="pot-note">Locked</small>'}</td>
      <td class="${row.depleted ? "depleted" : ""}">${row.depleted ? "Depleted" : money.format(row.availablePot)}</td>
      <td class="pot-mix-cell">${renderPotMix({ stocks: row.stocksBalance, isa: row.isaBalance, cash: row.cashBalance, pensionOne: row.pensionOneBalance, pensionTwo: row.pensionTwoBalance }, row.balance, maxPotTotal, row.stateIncome)}</td>
    </tr>`;
  }).join("");
  const rows = openingRow + projectedRows;

  const depletedMessage = result.depletedAt
    ? `Funds first become insufficient in ${result.depletedAt.toLocaleDateString("en-GB", { month: "long", year: "numeric" })}.`
    : `Available pot ends with ${money.format(result.rows.at(-1).availablePot)} in today's money.`;

  return `<article class="table-card">
    <div class="table-card__heading">
      <h3>${rateLabel}</h3>
      <p>${depletedMessage} Grouped where income is unchanged; the available pot is at range end.</p>
      <p>The available pot is stocks, ISA and cash before pension access, and includes pensions once unlocked · key events are colour coded</p>
      <p>Pot mix bars: Stocks · ISA · Cash · Pension/SIPP 1 · Pension/SIPP 2. Withdrawals within each group are allocated proportionally.</p>
    </div>
    <div class="table-scroll">
      <table>
        <thead><tr><th>Year(s)</th><th>Age(s)</th><th>Net / month</th><th>Pension pot</th><th>Available pot</th><th>Pot mix</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    ${renderPotNarrative(result)}
  </article>`;
}

function renderPotMix(pots, total, scale, stateIncome) {
  const entries = [
    ["Stocks", "St", pots.stocks, "stocks", scale],
    ["ISA", "ISA", pots.isa, "isa", scale],
    ["Cash", "Ca", pots.cash, "cash", scale],
    ["Company Pension / SIPP 1", "P1", pots.pensionOne, "pension-one", scale],
    ["Company Pension / SIPP 2", "P2", pots.pensionTwo, "pension-two", scale],
    ["State Pension (annual)", "SP", stateIncome, "state", scale]
  ].filter(([, , value]) => value > 0.005);
  if (entries.length === 0) return '<span class="pot-mix-empty">—</span>';
  const description = entries.map(([label, , value]) => `${label} ${money.format(value)}`).join(", ");
  const bars = entries.map(([label, shortLabel, value, colour, barScale]) => {
    const height = Math.min(100, Math.max(0, value / barScale * 100));
    return `<span class="pot-bar pot-bar--${colour}" title="${label}: ${money.format(value)}"><i style="height:${height.toFixed(2)}%"></i><b>${shortLabel}</b></span>`;
  }).join("");
  return `<div class="pot-bars" style="--bar-count:${entries.length}" role="img" aria-label="Pot mix at ${money.format(total)}: ${description}">${bars}</div>`;
}

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
    items.push(`<strong>Income first becomes underfunded in ${result.depletedAt.toLocaleDateString("en-GB", { month: "long", year: "numeric" })}; the displayed target income is not fully delivered from that point unless later funds arrive.</strong>`);
  }

  return `<div class="pot-narrative">
    <h4>How this path uses your pots</h4>
    <ul>${items.map(item => `<li>${item}</li>`).join("")}</ul>
  </div>`;
}

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

function isKeyEvent(row) {
  return row.pensionStarted || row.inheritedThisYear || row.stateStarted || row.depletionStarted;
}

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
    { index: three.rows.findIndex(row => row.pensionStarted), label: "Private pensions", colour: "#416b9a" },
    { index: three.rows.findIndex(row => row.inheritedThisYear), label: "Inheritance", colour: "#8a7460" },
    { index: three.rows.findIndex(row => row.stateStarted), label: "State Pension", colour: "#765a96" }
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

  chartGeometry = { xFor, pad, plotWidth, rows: three.rows, three, four, downsideThree, downsideFour, width, height };
  tooltipIndex = -1;
  tooltip.hidden = true;
}

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

function niceCeiling(value) {
  const magnitude = 10 ** Math.floor(Math.log10(Math.max(1, value)));
  return Math.ceil(value / magnitude * 2) / 2 * magnitude;
}

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
    drawChart(currentResults.three, currentResults.four, currentResults.downsideThree, currentResults.downsideFour);
  });
});

canvas.addEventListener("pointermove", event => {
  pendingPointer = { clientX: event.clientX, clientY: event.clientY };
  if (!chartGeometry || pointerFrame != null) return;
  pointerFrame = requestAnimationFrame(() => {
    pointerFrame = null;
    if (!pendingPointer || !chartGeometry) return;
    const rect = canvas.getBoundingClientRect();
    const x = pendingPointer.clientX - rect.left;
    const relative = (x - chartGeometry.pad.left) / chartGeometry.plotWidth;
    const index = Math.round(relative * (chartGeometry.rows.length - 1));
    if (index < 0 || index >= chartGeometry.rows.length) {
      tooltip.hidden = true;
      return;
    }
    if (index !== tooltipIndex) {
      const threeRow = chartGeometry.three.rows[index];
      const fourRow = chartGeometry.four.rows[index];
      const threeIncomeNote = threeRow.stateOnly ? " (State Pension only)" : "";
      const fourIncomeNote = fourRow.stateOnly ? " (State Pension only)" : "";
  tooltip.innerHTML = `<strong>${threeRow.year} · age ${threeRow.age}</strong><br>` +
    `3% available: ${money.format(threeRow.availablePot)} · total ${money.format(threeRow.balance)} · ${money.format(threeRow.netMonthly)}/month${threeIncomeNote}<br>` +
    `4% available: ${money.format(fourRow.availablePot)} · total ${money.format(fourRow.balance)} · ${money.format(fourRow.netMonthly)}/month${fourIncomeNote}`;
      tooltipIndex = index;
      tooltip.hidden = false;
      tooltipWidth = tooltip.offsetWidth;
    }
    tooltip.style.top = `${Math.max(80, pendingPointer.clientY - rect.top)}px`;
    tooltip.hidden = false;
    const halfTooltip = tooltipWidth / 2;
    const tooltipX = Math.min(chartGeometry.width - halfTooltip - 8, Math.max(halfTooltip + 8, chartGeometry.xFor(index)));
    tooltip.style.left = `${tooltipX}px`;
  });
});

canvas.addEventListener("pointerleave", () => {
  pendingPointer = null;
  tooltipIndex = -1;
  tooltip.hidden = true;
});

developerCorner.addEventListener("click", () => {
  const expanded = developerCorner.getAttribute("aria-expanded") === "true";
  developerCorner.setAttribute("aria-expanded", String(!expanded));
  developerTools.hidden = expanded;
  if (!expanded) saveDeveloperPresetButton.focus();
});

saveDeveloperPresetButton.addEventListener("click", () => {
  const values = getValues();
  const error = validate(values, true);
  if (error) {
    developerStatus.textContent = "Correct the highlighted fields first.";
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
});

removeDeveloperPresetButton.addEventListener("click", () => {
  try {
    localStorage.removeItem(DEVELOPER_STORAGE_KEY);
    developerStatus.textContent = "Developer preset removed.";
  } catch {
    developerStatus.textContent = "Browser storage unavailable.";
  }
});

populateForm(readSavedValues());
saveAndRender();
