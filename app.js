"use strict";

const STORAGE_KEY = "retirement-drawdown-model-v1";
const DEVELOPER_STORAGE_KEY = "developer";
const PEOPLE_SCHEMA_VERSION = 3;
const {
  CARE_RESERVE_AGE,
  CARE_RESERVE,
  MAX_BOOST,
  DEFAULTS,
  USA_DEFAULTS,
  parseLocalDate,
  ageAt,
  scenario,
  balanceAtAge,
  careReserveStatus,
  solveBoostForCareReserve,
  solveRateForCareReserve,
  maxBoostBeforePensionAccess,
  earlyIncomeBridgeSafe,
  normalizePerson,
  migratePeopleState
} = globalThis.RetirementModel;

const PERSON_KEYS = ["personOne", "personTwo"];
const PERSON_LABELS = { personOne: "Person 1", personTwo: "Person 2" };
const ACCOUNT_META = {
  UK: [
    ["stocks", "Stocks / general account", "St", "stocks"],
    ["isa", "ISA", "ISA", "isa"],
    ["cash", "Cash", "Ca", "cash"],
    ["pensionOne", "Company Pension / SIPP 1", "P1", "pension-one"],
    ["pensionTwo", "Company Pension / SIPP 2", "P2", "pension-two"]
  ],
  USA: [
    ["account401k", "401(k)", "401k", "pension-one"],
    ["traditionalIRA", "Traditional IRA", "IRA", "pension-two"],
    ["rothIRA", "Roth IRA", "Roth", "roth"],
    ["taxableBrokerage", "Taxable brokerage", "Tax", "taxable"]
  ]
};

let peopleState = loadState();
let activeTab = "personOne";
let resizeFrame = null;
const contexts = {};

function el(tag, options = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(options)) {
    if (key === "className") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key === "dataset") Object.assign(node.dataset, value);
    else if (key in node && key !== "list") node[key] = value;
    else node.setAttribute(key, value);
  }
  node.append(...children.filter(child => child != null));
  return node;
}

function blankProfiles() {
  return { UK: normalizePerson(DEFAULTS), USA: normalizePerson(USA_DEFAULTS) };
}

function loadState() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    return migratePeopleState(parsed);
  } catch {
    return migratePeopleState({});
  }
}

function persistState(personKey, statusText = "Saved locally") {
  peopleState.version = PEOPLE_SCHEMA_VERSION;
  const context = contexts[personKey];
  if (context) context.status.textContent = statusText;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(peopleState));
  } catch {
    if (context) context.status.textContent = "Browser storage unavailable";
  }
}

function currencyContext(values) {
  const currency = values.country === "USA" ? "USD" : "GBP";
  const locale = currency === "USD" ? "en-US" : "en-GB";
  return {
    currency,
    symbol: currency === "USD" ? "$" : "£",
    money: new Intl.NumberFormat(locale, { style: "currency", currency, maximumFractionDigits: 0 }),
    compactMoney: new Intl.NumberFormat(locale, { style: "currency", currency, notation: "compact", maximumFractionDigits: 2 })
  };
}

function fieldLabel(text, control, help = "") {
  const label = el("label", {}, text, control);
  if (help) label.append(el("small", { text: help }));
  return label;
}

function input(context, key, type = "number", attributes = {}) {
  const id = `${context.prefix}-${key.replace(/[A-Z]/g, char => `-${char.toLowerCase()}`)}`;
  const control = el("input", { id, name: key, type, ...attributes });
  context.inputs[key] = control;
  return control;
}

function suffixInput(context, key, suffix, attributes = {}) {
  return el("span", { className: "input-suffix" }, input(context, key, "number", attributes), el("span", { text: suffix }));
}

function moneyInput(context, key, attributes = {}) {
  return el("span", { className: "money-input" }, el("span", { className: "currency-symbol", text: "£" }), input(context, key, "number", { min: "0", step: "any", inputMode: "decimal", ...attributes }));
}

function makeFieldset(legendText, className = "form-grid") {
  const grid = el("div", { className });
  return { fieldset: el("fieldset", {}, el("legend", { text: legendText }), grid), grid };
}

function buildPersonWorkspace(personKey) {
  const workspace = document.querySelector(`[data-person="${personKey}"]`);
  const prefix = personKey === "personOne" ? "person-one" : "person-two";
  const form = el("form", { id: `${prefix}-form`, className: "person-form" });
  const context = {
    personKey, prefix, workspace, form, inputs: {}, chart: {}, results: null,
    renderFrame: null, careJob: null, careVersion: 0, earlyControlValues: null,
    profileCountry: peopleState.people[personKey].selectedCountry
  };
  contexts[personKey] = context;

  const heading = el("div", { className: "section-heading person-heading" },
    el("h3", { text: PERSON_LABELS[personKey] }),
    context.status = el("div", { id: `${prefix}-saved-state`, className: "saved-state", role: "status", "aria-live": "polite", text: "Saved locally" })
  );
  form.append(heading);

  const profile = makeFieldset("Profile", "form-grid form-grid--dates");
  const country = el("select", { id: `${prefix}-country`, name: "country", disabled: personKey === "personOne" },
    el("option", { value: "UK", text: "UK" }),
    ...(personKey === "personTwo" ? [el("option", { value: "USA", text: "USA" })] : [])
  );
  context.inputs.country = country;
  profile.grid.append(
    fieldLabel("Country", el("span", { className: "country-choice" }, context.flag = el("span", { className: "country-badge", "aria-hidden": "true", text: "GB" }), country)),
    fieldLabel("Native display currency", context.currencyLabel = el("span", { className: "currency-label", text: "GBP (£)" }))
  );

  const dates = makeFieldset("Dates", "form-grid form-grid--dates");
  dates.grid.append(
    fieldLabel("Birth date", input(context, "birthDate", "date", { required: true })),
    fieldLabel("Retirement date", input(context, "retirementDate", "date", { required: true })),
    fieldLabel("Projection length", suffixInput(context, "horizon", "years", { min: "1", max: "100", step: "1", required: true }))
  );

  const assets = makeFieldset("Initial assets");
  context.assetsGrid = assets.grid;

  const inheritance = makeFieldset("Optional inheritance", "form-grid form-grid--inheritance");
  inheritance.grid.append(
    fieldLabel("Year received", input(context, "inheritanceYear", "number", { min: "2027", max: "2200", step: "1", placeholder: "Leave blank" })),
    fieldLabel("Amount at that date", moneyInput(context, "inheritanceAmount", { placeholder: "0" }))
  );
  inheritance.fieldset.append(el("p", { className: "field-help", text: "The future amount is converted to retirement-year purchasing power using the inflation assumption." }));

  const boost = makeFieldset("Higher early income", "form-grid form-grid--inheritance");
  const range = input(context, "boost", "range", { min: "0", max: "200", step: "5", required: true, "aria-describedby": `${prefix}-boost-note` });
  context.boostOutput = el("output", { for: range.id, text: "40%" });
  boost.grid.append(
    fieldLabel("Higher income until age", input(context, "boostUntilAge", "number", { min: "40", max: "80", step: "1", required: true })),
    fieldLabel("Early-income uplift", el("span", { className: "range-input" }, range, context.boostOutput))
  );
  context.boostNote = el("p", { id: `${prefix}-boost-note`, className: "field-help", text: "0–200% in 5-point steps. The uplift applies to both drawdown scenarios until the selected birthday." });
  context.careGuidance = el("aside", { id: `${prefix}-care-guidance`, className: "care-guidance", "aria-live": "polite" });
  context.earlyPreview = el("div", { id: `${prefix}-early-income-preview`, className: "early-income-preview", "aria-live": "polite" });
  boost.fieldset.append(context.careGuidance, context.earlyPreview, context.boostNote);

  context.assumptionsDetails = el("details", {}, el("summary", { text: "Modelling assumptions" }), context.assumptionsGrid = el("div", { className: "assumptions-grid" }));
  context.countryNote = el("p", { className: "field-help country-method-note" });

  const submit = el("button", { className: "button button--primary", type: "submit", text: "Validate and save" });
  const reset = el("button", { id: `${prefix}-reset-defaults`, className: "button button--quiet", type: "button", text: "Reset defaults" });
  const clear = el("button", { id: `${prefix}-clear-data`, className: "button button--danger", type: "button", text: "Clear saved data" });
  context.error = el("p", { id: `${prefix}-form-error`, className: "form-error", role: "alert" });
  form.append(...(personKey === "personOne" ? [] : [profile.fieldset]), dates.fieldset, assets.fieldset, inheritance.fieldset, boost.fieldset, context.assumptionsDetails, context.countryNote,
    el("div", { className: "form-actions" }, submit, reset, clear), context.error);

  workspace.querySelector(".person-form-host").replaceChildren(form);
  context.resultsHost = workspace.querySelector(".person-results-host");
  configureCountryFields(context, context.profileCountry);
  populateForm(context, currentProfile(personKey));

  form.addEventListener("submit", event => {
    event.preventDefault();
    validateSaveAndRender(context, true);
  });
  form.addEventListener("input", event => {
    if (event.target === country) return;
    if (!enforceEarlyIncomeBridge(context, event.target)) return;
    context.status.textContent = "Unsaved changes";
    cancelCareGuidance(context);
    context.boostOutput.value = `${range.value}%`;
    context.boostOutput.textContent = `${range.value}%`;
    scheduleRender(context);
  });
  country.addEventListener("change", () => switchCountry(context, country.value));
  reset.addEventListener("click", () => resetActiveProfile(context));
  clear.addEventListener("click", () => clearPerson(context));
  return context;
}

function currentProfile(personKey) {
  const person = peopleState.people[personKey];
  return person.profiles[person.selectedCountry];
}

function configureCountryFields(context, country) {
  context.profileCountry = country;
  context.inputs.country.value = country;
  context.flag.textContent = country === "USA" ? "US" : "GB";
  context.currencyLabel.textContent = country === "USA" ? "USD ($)" : "GBP (£)";
  context.workspace.dataset.country = country;

  for (const key of Object.keys(context.inputs)) {
    if (!["country", "birthDate", "retirementDate", "horizon", "inheritanceYear", "inheritanceAmount", "boostUntilAge", "boost"].includes(key)) delete context.inputs[key];
  }
  context.assetsGrid.replaceChildren();
  for (const [key, label] of ACCOUNT_META[country]) context.assetsGrid.append(fieldLabel(label, moneyInput(context, key, { required: true })));
  context.assumptionsGrid.replaceChildren(
    fieldLabel("Real annual return", suffixInput(context, "realReturn", "%", { min: "-10", max: "20", step: "0.1", required: true })),
    fieldLabel("Annual inflation", suffixInput(context, "inflation", "%", { min: "0", max: "20", step: "0.1", required: true }))
  );
  if (country === "UK") {
    context.assumptionsGrid.append(
      fieldLabel("Pension access age", input(context, "pensionAge", "number", { min: "50", max: "75", step: "1", required: true })),
      fieldLabel("State Pension age", input(context, "stateAge", "number", { min: "55", max: "80", step: "1", required: true })),
      fieldLabel("Full State Pension", moneyInput(context, "statePension", { step: "0.01", required: true }), "annual, in today's money"),
      fieldLabel("Personal Allowance", moneyInput(context, "personalAllowance", { step: "10", required: true })),
      fieldLabel("Basic-rate band after allowance", moneyInput(context, "basicBand", { step: "100", required: true })),
      fieldLabel("Pension tax-free share", suffixInput(context, "taxFreeShare", "%", { min: "0", max: "100", step: "1", required: true })),
      fieldLabel("Lifetime tax-free cash cap", moneyInput(context, "taxFreeCap", { step: "1", required: true }))
    );
    context.countryNote.textContent = "UK modelling includes State Pension and simplified pension income tax assumptions.";
  } else {
    context.assumptionsGrid.append(
      fieldLabel("Penalty-free access age", input(context, "penaltyFreeAccessAge", "number", { min: "0", max: "100", step: "0.5", required: true })),
      fieldLabel("Traditional taxable-withdrawal share", suffixInput(context, "traditionalTaxableShare", "%", { min: "0", max: "100", step: "1", required: true })),
      fieldLabel("Optional RMD start age", input(context, "rmdStartAge", "number", { min: "0", max: "120", step: "1", placeholder: "None" })),
      fieldLabel("Taxable brokerage withdrawal/gains share", suffixInput(context, "taxableWithdrawalShare", "%", { min: "0", max: "100", step: "1", required: true }))
    );
    context.countryNote.textContent = "USA rules are configurable illustrative assumptions. Social Security, Medicare, state taxes and joint filing are outside this version.";
  }
  context.assetsGrid.querySelectorAll(".currency-symbol").forEach(node => { node.textContent = country === "USA" ? "$" : "£"; });
  context.form.querySelectorAll(".currency-symbol").forEach(node => { node.textContent = country === "USA" ? "$" : "£"; });
  context.careGuidance.hidden = false;
  if (context.personKey === "personTwo") {
    document.querySelector(".person-two-flag").textContent = country === "USA" ? "US" : "GB";
  }
}

function formValues(context) {
  const values = { country: context.profileCountry };
  for (const [key, control] of Object.entries(context.inputs)) {
    if (key === "country") continue;
    values[key] = control.type === "date" ? control.value : control.value === "" ? null : Number(control.value);
  }
  if (values.country === "USA") {
    values.accounts = [
      { type: "401k", balance: values.account401k || 0 },
      { type: "traditionalIRA", balance: values.traditionalIRA || 0 },
      { type: "rothIRA", balance: values.rothIRA || 0 },
      { type: "taxableBrokerage", balance: values.taxableBrokerage || 0 }
    ];
  }
  return normalizePerson(values);
}

function populateForm(context, rawValues) {
  const values = normalizePerson(rawValues);
  const byType = Object.fromEntries((values.accounts || []).map(account => [account.type || account.kind, Number(account.balance) || 0]));
  const aliases = { account401k: byType["401k"], traditionalIRA: byType.traditionalIRA, rothIRA: byType.rothIRA, taxableBrokerage: byType.taxableBrokerage };
  for (const [key, control] of Object.entries(context.inputs)) {
    if (key === "country") control.value = context.profileCountry;
    else control.value = aliases[key] ?? values[key] ?? "";
  }
  context.boostOutput.value = `${context.inputs.boost.value}%`;
  context.boostOutput.textContent = `${context.inputs.boost.value}%`;
  context.earlyControlValues = {
    boost: Number(context.inputs.boost.value),
    boostUntilAge: Number(context.inputs.boostUntilAge.value)
  };
  updateEarlyIncomeLimitNote(context);
  context.status.textContent = "Saved locally";
  context.error.textContent = "";
}

function enforceEarlyIncomeBridge(context, target) {
  const key = target === context.inputs.boost ? "boost" : target === context.inputs.boostUntilAge ? "boostUntilAge" : null;
  if (!key) {
    updateEarlyIncomeLimitNote(context);
    return true;
  }
  const previous = context.earlyControlValues[key];
  const requested = Number(target.value);
  if (!Number.isFinite(requested)) return true;
  const extending = Number.isFinite(previous) && requested > previous;
  let bridgeSafe;
  try {
    bridgeSafe = earlyIncomeBridgeSafe(formValues(context));
  } catch {
    return true;
  }
  if (extending && !bridgeSafe) {
    target.value = String(previous);
    context.boostOutput.value = `${context.inputs.boost.value}%`;
    context.boostOutput.textContent = `${context.inputs.boost.value}%`;
    updateEarlyIncomeLimitNote(context, true);
    return false;
  }
  context.earlyControlValues[key] = requested;
  updateEarlyIncomeLimitNote(context);
  return true;
}

function updateEarlyIncomeLimitNote(context, blocked = false) {
  const values = formValues(context);
  const milestone = values.country === "USA"
    ? `traditional-account access at age ${values.penaltyFreeAccessAge}`
    : `private-pension access and State Pension at age ${values.stateAge}`;
  context.boostNote.textContent = blocked
    ? `That increase was blocked because the 3% plan would deplete its available pot before ${milestone}. Reduce the uplift or its duration first.`
    : `0–200% in 5-point steps. Increases are blocked if the 3% plan would deplete its available pot before ${milestone}.`;
  context.boostNote.classList.toggle("field-help--warning", blocked);
}

function validate(context, values, report = false) {
  if (!(report ? context.form.reportValidity() : context.form.checkValidity())) return "Please correct the highlighted field.";
  let birth;
  let retirement;
  try { birth = parseLocalDate(values.birthDate); retirement = parseLocalDate(values.retirementDate); } catch { return "Enter valid birth and retirement dates."; }
  if (retirement <= birth) return "Retirement must be after the birth date.";
  if (values.country === "UK" && values.stateAge <= values.pensionAge) return "State Pension age must be later than private pension access age.";
  const hasYear = values.inheritanceYear != null;
  const hasAmount = values.inheritanceAmount != null && values.inheritanceAmount !== 0;
  if (hasYear !== hasAmount) return "Enter both an inheritance year and amount, or leave both blank.";
  if (hasYear && values.inheritanceYear < retirement.getFullYear()) return "Inheritance year cannot be before retirement.";
  return "";
}

function validateSaveAndRender(context, report = false) {
  const values = formValues(context);
  const error = validate(context, values, report);
  context.error.textContent = error;
  if (error) return false;
  const person = peopleState.people[context.personKey];
  person.selectedCountry = context.profileCountry;
  person.profiles[context.profileCountry] = values;
  persistState(context.personKey);
  renderPerson(context, values);
  renderHousehold();
  return true;
}

function scheduleRender(context) {
  if (context.renderFrame != null) cancelAnimationFrame(context.renderFrame);
  context.renderFrame = requestAnimationFrame(() => {
    context.renderFrame = null;
    const values = formValues(context);
    const error = validate(context, values);
    context.error.textContent = error;
    if (!error) renderPerson(context, values);
  });
}

function switchCountry(context, nextCountry) {
  if (context.personKey === "personOne" || nextCountry === context.profileCountry) return;
  const outgoing = formValues(context);
  if (!validate(context, outgoing)) peopleState.people[context.personKey].profiles[context.profileCountry] = outgoing;
  const person = peopleState.people[context.personKey];
  person.selectedCountry = nextCountry;
  configureCountryFields(context, nextCountry);
  populateForm(context, person.profiles[nextCountry]);
  persistState(context.personKey);
  if (activeTab === context.personKey) document.querySelector("#uk-longevity-note").hidden = nextCountry !== "UK";
  renderPerson(context, formValues(context));
  renderHousehold();
}

function resetActiveProfile(context) {
  const base = context.profileCountry === "USA" ? normalizePerson(USA_DEFAULTS) : normalizePerson(DEFAULTS);
  const reset = context.personKey === "personOne" ? { ...base, ...readDeveloperAssets(), country: "UK", currency: "GBP" } : base;
  peopleState.people[context.personKey].profiles[context.profileCountry] = reset;
  populateForm(context, reset);
  persistState(context.personKey, "Defaults restored");
  renderPerson(context, reset);
  renderHousehold();
}

function clearPerson(context) {
  const selectedCountry = context.personKey === "personOne" ? "UK" : context.profileCountry;
  peopleState.people[context.personKey] = { selectedCountry, profiles: blankProfiles() };
  configureCountryFields(context, selectedCountry);
  populateForm(context, peopleState.people[context.personKey].profiles[selectedCountry]);
  persistState(context.personKey, "Saved data cleared");
  renderPerson(context, formValues(context));
  renderHousehold();
}

function renderPerson(context, rawValues) {
  cancelCareGuidance(context);
  const values = normalizePerson(rawValues);
  const format = currencyContext(values);
  const three = scenario(values, 0.03);
  const four = scenario(values, 0.04);
  const downsideValues = { ...values, realReturn: 1 };
  const downsideThree = scenario(downsideValues, 0.03);
  const downsideFour = scenario(downsideValues, 0.04);
  context.results = { values, format, three, four, downsideThree, downsideFour };

  const basis = el("p", { id: `${context.prefix}-projection-basis`, className: "projection-basis", text: `${format.money.format(three.startingBalance)} starting portfolio · ${values.realReturn}% real return · ${values.horizon} years` });
  const heading = el("div", { className: "section-heading results-heading" },
    el("div", {}, el("p", { className: "eyebrow", text: `${PERSON_LABELS[context.personKey]} projection` }), el("h2", { text: "Your two drawdown paths" })), basis);
  const accessibleText = values.country === "UK"
    ? `${format.money.format(three.startingAccessible)} in stocks, ISA & cash · ${format.money.format(three.startingPension)} in pensions`
    : `${format.money.format(three.startingAccessible)} in Roth IRA & taxable brokerage · ${format.money.format(three.startingPension)} in traditional accounts`;
  const summary = el("div", { id: `${context.prefix}-summary-grid`, className: "summary-grid" },
    summaryCard("Starting portfolio", format.money.format(three.startingBalance), accessibleText),
    summaryCard("3% plan · end balance", format.money.format(three.rows.at(-1).balance), annualDrawDetail(values, three, format), "three", downsideWarning(downsideThree, format)),
    summaryCard("4% plan · end balance", format.money.format(four.rows.at(-1).balance), annualDrawDetail(values, four, format), "four", downsideWarning(downsideFour, format)),
    summaryCard("Inheritance", values.inheritanceAmount ? format.money.format(values.inheritanceAmount) : "None", values.inheritanceAmount ? `Nominal amount in ${values.inheritanceYear}` : "No inheritance included")
  );
  renderEarlyIncomePreview(context, values, three, four, format);
  const needsCareRecommendation = renderCareGuidance(context, values, three, four, format, false);
  if (needsCareRecommendation) scheduleCareGuidance(context, values, three, four, format);
  const chart = buildChart(context, values);
  const tables = el("div", { id: `${context.prefix}-tables-grid`, className: "tables-grid" },
    renderTable(three, values, format), renderTable(four, values, format));
  const methodology = renderMethodology(values);
  context.resultsHost.replaceChildren(heading, summary, chart, tables, methodology);
  requestAnimationFrame(() => drawChart(context));
}

function summaryCard(label, value, detail, colour = "", warning = "") {
  const card = el("article", { className: `summary-card${colour ? ` summary-card--${colour}` : ""}${warning ? " summary-card--warning" : ""}` },
    el("span", { className: "summary-card__label", text: label }), el("div", { className: "summary-card__value", text: value }),
    el("p", { className: "summary-card__detail", text: detail }));
  if (warning) card.append(el("p", { className: "summary-card__warning" }, el("strong", { text: "1% return worst-case" }), document.createTextNode(warning)));
  return card;
}

function annualDrawDetail(values, result, format) {
  const retirementAge = ageAt(parseLocalDate(values.retirementDate), parseLocalDate(values.birthDate));
  const standard = `${format.money.format(result.baseAnnualIncome)} standard annual draw`;
  return retirementAge < values.boostUntilAge && values.boost > 0
    ? `${standard} · ${format.money.format(result.baseAnnualIncome * (1 + values.boost / 100))} higher early annual draw until age ${values.boostUntilAge}` : standard;
}

function downsideWarning(result, format) {
  const zero = result.rows.find(row => row.balance < 0.01);
  return zero ? ` This plan reaches ${format.money.format(0)} in ${zero.year} (age ${zero.age}).` : "";
}

function renderEarlyIncomePreview(context, values, three, four, format) {
  const baselineThree = scenario({ ...values, boost: 0 }, 0.03);
  const baselineFour = scenario({ ...values, boost: 0 }, 0.04);
  const card = (rate, result, baseline, modifier) => el("div", { className: `early-income-preview__item early-income-preview__item--${modifier}` },
    el("span", { className: "early-income-preview__label", text: `${rate}% plan · net monthly` }),
    el("strong", { className: "early-income-preview__value", text: format.money.format(result.rows[0].netMonthly) }),
    el("span", { className: "early-income-preview__baseline", text: `Without uplift: ${format.money.format(baseline.rows[0].netMonthly)}/month` }));
  context.earlyPreview.replaceChildren(card(3, three, baselineThree, "three"), card(4, four, baselineFour, "four"),
    el("p", { className: "early-income-preview__note", text: `First 12 projection months with a ${values.boost}% uplift, continuing until age ${values.boostUntilAge}.` }));
}

function renderCareGuidance(context, values, three, four, format, calculateRecommendation = true) {
  context.careGuidance.hidden = false;
  const reserveLabel = format.money.format(CARE_RESERVE);
  const plans = [three, four].map(result => ({
    result,
    label: `${Math.round(result.rate * 100)}% plan`,
    balance: balanceAtAge(result, CARE_RESERVE_AGE),
    get status() { return this.balance == null ? "unavailable" : careReserveStatus(this.balance); }
  }));

  if (plans.some(plan => plan.balance == null)) {
    updateCareGuidance(context, "care-guidance care-guidance--caution", false, "Extend the projection to assess care reserves", [
      `The current horizon does not reach age ${CARE_RESERVE_AGE}. Increase it before using the ${reserveLabel} care-reserve guide.`
    ]);
    return false;
  }

  const balances = plans.map(plan => ({ strong: `${plan.label}: ${format.money.format(plan.balance)}` }));
  const surplusPlans = plans.filter(plan => plan.status === "surplus");
  if (surplusPlans.length === 0) {
    const shortfallPlans = plans.filter(plan => plan.status === "shortfall");
    const message = shortfallPlans.length === plans.length
      ? `Neither plan reaches the ${reserveLabel} care assumption, so the model does not suggest increasing early spending.`
      : shortfallPlans.length
        ? `${shortfallPlans.map(plan => plan.label).join(" and ")} falls below the ${reserveLabel} care assumption; no spend-more suggestion is made for that plan.`
        : `Both plans finish exactly on the ${reserveLabel} care-reserve target.`;
    updateCareGuidance(context, `care-guidance${shortfallPlans.length ? " care-guidance--caution" : ""}`, false, "Age-90 care reserve", [
      interleave(balances, " · ").concat("."), message
    ]);
    return false;
  }

  if (!calculateRecommendation) {
    updateCareGuidance(context, "care-guidance", true, "Age-90 care reserve", [
      interleave(balances, " · ").concat("."), "Updating the early-spending suggestion…"
    ]);
    return true;
  }

  const bridgeMax = values.country === "UK" ? maxBoostBeforePensionAccess(values) : MAX_BOOST;
  const recommendations = surplusPlans.map(plan => {
    const suggestedBoost = solveBoostForCareReserve(values, plan.result.rate);
    if (suggestedBoost == null) {
      const suggestedRate = solveRateForCareReserve(values);
      if (suggestedRate == null) return [`${plan.label} remains above ${reserveLabel} even at the model's tested spending limits.`];
      const maximumBoostBalance = balanceAtAge(scenario({ ...values, boost: MAX_BOOST }, plan.result.rate), CARE_RESERVE_AGE);
      const parts = [
        `${plan.label}: even the tested maximum uplift leaves about `,
        { strong: format.money.format(maximumBoostBalance) },
        " at 90. A broader initial drawdown near ",
        { strong: `${(suggestedRate * 100).toFixed(2)}%` },
        ` would target roughly ${reserveLabel}.`
      ];
      if (values.country === "UK") parts.push(" The slider remains limited to protect the pre-pension bridge.");
      return parts;
    }
    if (suggestedBoost > bridgeMax) {
      return [
        `${plan.label}: reaching ${reserveLabel} at 90 would need an uplift near `,
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
      { strong: `${format.money.format(earlyAnnual)} gross a year` },
      ` before age ${values.boostUntilAge}.`
    ];
  });

  const belowTarget = plans.filter(plan => plan.status === "shortfall");
  const paragraphs = [interleave(balances, " · ").concat(".")];
  if (belowTarget.length) paragraphs.push(`${belowTarget.map(plan => plan.label).join(" and ")} is below ${reserveLabel}, so the spend-more suggestion applies only to the plan above the reserve.`);
  paragraphs.push(
    interleave(recommendations, " ").flat(),
    "These are deterministic estimates, so retain additional margin if investment or care-cost uncertainty concerns you."
  );
  updateCareGuidance(context, "care-guidance", false, "You may be reserving more than ten years of care costs", paragraphs);
  return false;
}

function interleave(items, separator) {
  return items.flatMap((item, index) => index === 0 ? [item] : [separator, item]);
}

function appendRichText(parent, parts) {
  for (const part of Array.isArray(parts) ? parts.flat() : [parts]) {
    if (typeof part === "string") parent.append(part);
    else parent.append(el("strong", { text: part.strong }));
  }
}

function updateCareGuidance(context, className, busy, title, paragraphs) {
  const guidance = context.careGuidance;
  guidance.className = className;
  if (busy) guidance.setAttribute("aria-busy", "true");
  else guidance.removeAttribute("aria-busy");
  const content = el("div", {}, el("h3", { text: title }));
  for (const parts of paragraphs) {
    const paragraph = el("p");
    appendRichText(paragraph, parts);
    content.append(paragraph);
  }
  guidance.replaceChildren(el("div", { className: "care-guidance__icon", "aria-hidden": "true", text: "90" }), content);
}

function cancelCareGuidance(context) {
  context.careVersion += 1;
  if (!context.careJob) return;
  if (context.careJob.type === "idle") window.cancelIdleCallback(context.careJob.id);
  else clearTimeout(context.careJob.id);
  context.careJob = null;
}

function scheduleCareGuidance(context, values, three, four, format) {
  cancelCareGuidance(context);
  const version = context.careVersion;
  const run = () => {
    context.careJob = null;
    if (version !== context.careVersion) return;
    renderCareGuidance(context, values, three, four, format, true);
  };
  context.careJob = { type: "timer", id: setTimeout(() => {
    context.careJob = null;
    if (version !== context.careVersion) return;
    if ("requestIdleCallback" in window) context.careJob = { type: "idle", id: window.requestIdleCallback(run, { timeout: 250 }) };
    else context.careJob = { type: "timer", id: setTimeout(run, 0) };
  }, 150) };
}

function buildChart(context, values) {
  const instructionsId = `${context.prefix}-chart-instructions`;
  const detailsId = `${context.prefix}-chart-details`;
  const canvas = el("canvas", { id: `${context.prefix}-balance-chart`, tabIndex: 0, role: "img",
    "aria-label": `Available-pot chart for ${PERSON_LABELS[context.personKey]} in ${values.currency}`,
    "aria-describedby": `${instructionsId} ${detailsId}` });
  const tooltip = el("div", { id: `${context.prefix}-chart-tooltip`, className: "chart-tooltip", hidden: true });
  const details = el("p", { id: detailsId, className: "chart-details", "aria-live": "polite", text: "No chart year selected." });
  context.chart = { canvas, tooltip, details, geometry: null, lockedIndex: -1, hoverIndex: -1 };
  bindChartEvents(context);
  return el("article", { className: "panel chart-panel" },
    el("div", { className: "chart-heading" },
      el("div", {}, el("h3", { text: "Available pot" }),
        el("p", { text: `Year-end money available to withdraw in retirement-year ${values.currency === "USD" ? "dollars" : "pounds"} · dotted lines use a 1% real return` }),
        el("p", { id: instructionsId, className: "chart-instructions", text: "Tap a year to keep its details open. With the chart focused, use Left/Right, Home, End, or Escape." })),
      el("div", { className: "legend", "aria-hidden": "true" },
        el("span", {}, el("i", { className: "legend__line legend__line--three" }), "3% drawdown"),
        el("span", {}, el("i", { className: "legend__line legend__line--four" }), "4% drawdown"),
        el("span", {}, el("i", { className: "legend__line legend__line--downside" }), "1% downside"))),
    el("div", { className: "chart-wrap" }, canvas, tooltip), details);
}

function drawChart(context) {
  if (!context.results || !context.chart.canvas.isConnected) return;
  const { three, four, downsideThree, downsideFour, values, format } = context.results;
  const { canvas } = context.chart;
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  canvas.width = Math.round(rect.width * dpr); canvas.height = Math.round(rect.height * dpr);
  const ctx = canvas.getContext("2d"); ctx.scale(dpr, dpr);
  const width = rect.width; const height = rect.height;
  const pad = { top: 72, right: 18, bottom: 38, left: width < 520 ? 58 : 78 };
  const plotWidth = width - pad.left - pad.right; const plotHeight = height - pad.top - pad.bottom;
  const allRows = [...three.rows, ...four.rows, ...downsideThree.rows, ...downsideFour.rows];
  const maximum = Math.max(1, three.startingAvailablePot, ...allRows.map(row => row.availablePot));
  const magnitude = 10 ** Math.floor(Math.log10(maximum));
  const yMax = Math.ceil(maximum / magnitude * 2) / 2 * magnitude;
  const xFor = index => pad.left + index / Math.max(1, three.rows.length - 1) * plotWidth;
  const yFor = value => pad.top + plotHeight - Math.max(0, value) / yMax * plotHeight;
  ctx.clearRect(0, 0, width, height); ctx.font = "12px system-ui, sans-serif"; ctx.fillStyle = "#64736f"; ctx.strokeStyle = "#e4e8e1";
  for (let tick = 0; tick <= 4; tick += 1) {
    const value = yMax * tick / 4; const y = yFor(value);
    ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(width - pad.right, y); ctx.stroke();
    ctx.textAlign = "right"; ctx.textBaseline = "middle"; ctx.fillText(format.compactMoney.format(value), pad.left - 9, y);
  }
  const labelEvery = Math.max(1, Math.ceil(three.rows.length / (width < 600 ? 5 : 8)));
  three.rows.forEach((row, index) => { if (index % labelEvery === 0 || index === three.rows.length - 1) { ctx.textAlign = "center"; ctx.textBaseline = "top"; ctx.fillText(String(row.year), xFor(index), height - pad.bottom + 12); } });
  plotLine(ctx, downsideThree.rows, xFor, yFor, "#16735f", [6, 6], 2); plotLine(ctx, downsideFour.rows, xFor, yFor, "#dc6f3d", [6, 6], 2);
  plotLine(ctx, three.rows, xFor, yFor, "#16735f"); plotLine(ctx, four.rows, xFor, yFor, "#dc6f3d");
  const accessLabel = values.country === "USA" ? "Account access" : "Private pensions";
  const markers = [
    { index: three.rows.findIndex(row => row.pensionStarted), label: accessLabel, colour: "#416b9a" },
    { index: three.rows.findIndex(row => row.inheritedThisYear), label: "Inheritance", colour: "#8a7460" }
  ];
  if (values.country === "UK") markers.push({ index: three.rows.findIndex(row => row.stateStarted), label: "State Pension", colour: "#765a96" });
  markers.filter(marker => marker.index >= 0).forEach((marker, order) => {
    const x = xFor(marker.index); ctx.save(); ctx.setLineDash([4, 5]); ctx.strokeStyle = marker.colour;
    ctx.beginPath(); ctx.moveTo(x, pad.top - 5); ctx.lineTo(x, height - pad.bottom); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = marker.colour; ctx.font = "700 11px system-ui, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "top";
    ctx.fillText(`${marker.label} · ${three.rows[marker.index].year}`, x, 10 + order * 19); ctx.restore();
  });
  context.chart.geometry = { xFor, yFor, pad, plotWidth, width, height, rows: three.rows };
  dismissChart(context);
}

function plotLine(ctx, rows, xFor, yFor, colour, dash = [], width = 3) {
  ctx.save(); ctx.strokeStyle = colour; ctx.lineWidth = width; ctx.setLineDash(dash); ctx.lineJoin = "round"; ctx.beginPath();
  rows.forEach((row, index) => index ? ctx.lineTo(xFor(index), yFor(row.availablePot)) : ctx.moveTo(xFor(index), yFor(row.availablePot)));
  ctx.stroke(); ctx.restore();
}

function bindChartEvents(context) {
  const chart = context.chart;
  const nearest = clientX => {
    if (!chart.geometry) return -1;
    const rect = chart.canvas.getBoundingClientRect();
    return Math.max(0, Math.min(chart.geometry.rows.length - 1, Math.round((clientX - rect.left - chart.geometry.pad.left) / chart.geometry.plotWidth * (chart.geometry.rows.length - 1))));
  };
  chart.canvas.addEventListener("pointermove", event => { if (event.pointerType !== "touch" && chart.lockedIndex < 0) showChart(context, nearest(event.clientX)); });
  chart.canvas.addEventListener("pointerleave", () => { if (chart.lockedIndex < 0) { chart.tooltip.hidden = true; chart.hoverIndex = -1; } });
  chart.canvas.addEventListener("pointerup", event => { if (!event.isPrimary) return; const index = nearest(event.clientX); if (chart.lockedIndex === index) dismissChart(context); else { chart.lockedIndex = index; showChart(context, index, true); } });
  chart.canvas.addEventListener("keydown", event => {
    if (!chart.geometry) return; let index = chart.lockedIndex;
    if (event.key === "Escape") { dismissChart(context); return; }
    if (event.key === "Home") index = 0; else if (event.key === "End") index = chart.geometry.rows.length - 1;
    else if (event.key === "ArrowLeft") index = index < 0 ? chart.geometry.rows.length - 1 : Math.max(0, index - 1);
    else if (event.key === "ArrowRight") index = index < 0 ? 0 : Math.min(chart.geometry.rows.length - 1, index + 1); else return;
    event.preventDefault(); chart.lockedIndex = index; showChart(context, index, true);
  });
}

function showChart(context, index, announce = false) {
  const { chart, results } = context; if (!chart.geometry || index < 0) return;
  const a = results.three.rows[index]; const b = results.four.rows[index]; const money = results.format.money;
  chart.tooltip.replaceChildren(el("strong", { text: `${a.year} · age ${a.age}` }), el("br"),
    document.createTextNode(`3% available: ${money.format(a.availablePot)} · ${money.format(a.netMonthly)}/month`), el("br"),
    document.createTextNode(`4% available: ${money.format(b.availablePot)} · ${money.format(b.netMonthly)}/month`));
  chart.tooltip.hidden = false; chart.hoverIndex = index;
  const left = Math.max(8, Math.min(chart.geometry.width - chart.tooltip.offsetWidth - 8, chart.geometry.xFor(index) - chart.tooltip.offsetWidth / 2));
  const pointY = Math.min(chart.geometry.yFor(a.availablePot), chart.geometry.yFor(b.availablePot));
  chart.tooltip.style.left = `${left}px`; chart.tooltip.style.top = `${Math.max(8, pointY - chart.tooltip.offsetHeight - 12)}px`;
  if (announce) chart.details.textContent = `${a.year}, age ${a.age}. 3% available ${money.format(a.availablePot)}. 4% available ${money.format(b.availablePot)}.`;
}

function dismissChart(context) {
  context.chart.lockedIndex = -1; context.chart.hoverIndex = -1; context.chart.tooltip.hidden = true; context.chart.details.textContent = "No chart year selected.";
}

function renderTable(result, values, format) {
  const rateLabel = `${Math.round(result.rate * 100)}% drawdown`;
  const meta = ACCOUNT_META[values.country];
  const maxBalance = Math.max(1, result.startingBalance, ...result.rows.map(row => row.balance));
  const headings = values.country === "UK"
    ? ["Year(s)", "Age(s)", "Net / month", ["Pension", "pot"], ["Available", "pot"], "Pot mix"]
    : ["Year(s)", "Age(s)", "Net / month", ["Traditional", "accounts"], ["Available", "pot"], "Account mix"];
  const head = el("thead", {}, el("tr", {}, ...headings.map(tableHeading)));
  const body = el("tbody");
  const openingMix = values.country === "UK" ? result.startingPots : {
    account401k: result.startingPots["401k"], traditionalIRA: result.startingPots.traditionalIRA,
    rothIRA: result.startingPots.rothIRA, taxableBrokerage: result.startingPots.taxableBrokerage
  };
  body.append(el("tr", { className: "opening-row" },
    tableCell(`Opening · ${result.startingYear}`), tableCell(String(result.startingAge)), tableCell("—"),
    tableCell(format.money.format(result.startingPension)), tableCell(format.money.format(result.startingAvailablePot)), mixCell(openingMix, result.startingBalance, maxBalance, meta, format)));
  for (const group of groupTableRows(result.rows)) {
    const eventRow = group.start;
    const row = group.end;
    const yearRange = eventRow.year === row.year ? String(row.year) : `${eventRow.year}–${row.year}`;
    const ageRange = eventRow.age === row.age ? String(row.age) : `${eventRow.age}–${row.age}`;
    const year = tableCell(yearRange);
    const tags = el("span", { className: "event-tags" });
    if (eventRow.pensionStarted) tags.append(eventTag(values.country === "USA" ? "Account access" : "Private pensions", "pension"));
    if (eventRow.inheritedThisYear) tags.append(eventTag("Inheritance", "inheritance"));
    if (values.country === "UK" && eventRow.stateStarted) tags.append(eventTag("State Pension", "state"));
    if (tags.childElementCount) year.append(tags);
    const pots = values.country === "UK" ? { stocks: row.stocksBalance, isa: row.isaBalance, cash: row.cashBalance, pensionOne: row.pensionOneBalance, pensionTwo: row.pensionTwoBalance }
      : { account401k: row.accountBalances["401k"], traditionalIRA: row.accountBalances.traditionalIRA, rothIRA: row.accountBalances.rothIRA, taxableBrokerage: row.accountBalances.taxableBrokerage };
    body.append(el("tr", { className: tags.childElementCount ? "event-row" : "" }, year, tableCell(ageRange), tableCell(format.money.format(row.netMonthly)),
      tableCell(format.money.format(row.pensionBalance)), tableCell(row.depleted ? "Depleted" : format.money.format(row.availablePot), row.depleted ? "depleted" : ""), mixCell(pots, row.balance, maxBalance, meta, format)));
  }
  const scroll = el("div", { className: "table-scroll", tabIndex: 0, role: "region", "aria-label": `${rateLabel} projection table; scroll horizontally to see all columns` }, el("table", {}, head, body));
  return el("article", { className: "table-card" },
    el("div", { className: "table-card__heading" }, el("h3", { text: rateLabel }),
      el("p", {}, `Available pot ends with ${format.money.format(result.rows.at(-1).availablePot)} in today's money.`, el("br"), "Grouped where income is unchanged; balances are at range end.")),
    el("p", { className: "table-scroll-hint", text: "Swipe horizontally to see all columns" }), scroll, renderPotNarrative(result, values, format));
}

function tableHeading(label) {
  if (!Array.isArray(label)) return el("th", { text: label });
  return el("th", { className: "table-heading--wrapped" }, label[0], el("br"), label[1]);
}

function groupTableRows(rows) {
  const grouped = [];
  let index = 0;
  while (index < rows.length) {
    const start = rows[index];
    let endIndex = index;
    if (!isKeyEvent(start)) {
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

function tableCell(text = "", className = "") { return el("td", { text, className }); }
function eventTag(text, type) { return el("span", { className: `event-tag event-tag--${type}`, text }); }
function mixCell(pots, total, scale, meta, format) {
  const cell = el("td", { className: "pot-mix-cell" });
  const entries = meta.map(([key, label, short, colour]) => [label, short, Number(pots[key]) || 0, colour]).filter(entry => entry[2] > 0.005);
  if (!entries.length) return cell.appendChild(el("span", { className: "pot-mix-empty", text: "—" })), cell;
  const bars = el("div", { className: "pot-bars", role: "img", "aria-label": `Pot mix at ${format.money.format(total)}: ${entries.map(entry => `${entry[0]} ${format.money.format(entry[2])}`).join(", ")}` });
  bars.style.setProperty("--bar-count", String(entries.length));
  for (const [label, short, value, colour] of entries) bars.append(el("span", { className: `pot-bar pot-bar--${colour}`, title: `${label}: ${format.money.format(value)}` },
    el("i", { style: `height:${Math.min(100, value / scale * 100).toFixed(2)}%` }), el("b", { text: short })));
  cell.append(bars); return cell;
}

function renderPotNarrative(result, values, format) {
  const access = result.rows.find(row => row.pensionStarted);
  const inheritance = result.rows.find(row => row.inheritedThisYear);
  const items = [];
  if (values.country === "UK") {
    items.push(result.pensionAvailableAtStart ? "Private pensions are available from retirement." : access ? `Until pensions unlock in ${access.year}, withdrawals come only from stocks, ISA and cash.` : "Private pensions remain locked throughout this projection.");
    items.push("After access, the model uses the entered UK pension tax assumptions and tax-efficient ordering. State Pension offsets part of the income target once it starts.");
  } else {
    items.push(result.pensionAvailableAtStart ? "Traditional retirement accounts are available from retirement." : access ? `Until account access in ${access.year}, withdrawals use taxable brokerage and Roth IRA.` : "Traditional retirement accounts remain locked throughout this projection.");
    items.push("USA withdrawals use taxable brokerage, Roth IRA, 401(k), and traditional IRA under the configured access, taxable-share, and optional RMD assumptions.");
  }
  if (inheritance) items.push(`Inheritance is added in ${inheritance.year}.`);
  items.push(`The projection ends with ${format.money.format(result.rows.at(-1).balance)} across this profile's accounts.`);
  return el("div", { className: "pot-narrative" }, el("h4", { text: "How this path uses your pots" }), el("ul", {}, ...items.map(text => el("li", { text }))));
}

function renderMethodology(values) {
  const items = values.country === "UK" ? [
    ["Monthly modelling.", "Investments grow and withdrawals occur monthly; tables report projection years."],
    ["Tax-efficient ordering.", "Stocks, ISA and cash bridge pension age; simplified UK pension tax assumptions apply after access."],
    ["State Pension.", "State Pension replaces part of the target portfolio withdrawal."],
    ["UK scope.", "CGT, dividend tax, NI, fees beyond real return, and future rule changes are not modelled."]
  ] : [
    ["Monthly modelling.", "Investments grow and withdrawals occur monthly; tables report projection years."],
    ["Account ordering.", "Taxable brokerage and Roth IRA are used before traditional accounts become available."],
    ["Configurable taxation.", "Traditional-account and brokerage taxable shares are assumptions; a simplified 22% tax is applied."],
    ["USA scope.", "Social Security, Medicare, state taxes, joint filing, detailed RMD tables, and future rule changes are not modelled."]
  ];
  return el("section", { className: "panel methodology" }, el("h2", { text: "How this model works" }),
    el("div", { className: "methodology__grid" }, ...items.map(([title, text]) => el("p", {}, el("strong", { text: title }), ` ${text}`))),
    el("p", { className: "disclaimer", text: "This is an illustrative planning tool, not regulated financial advice. Real returns are volatile and tax rules can change." }));
}

function renderHousehold() {
  const host = document.querySelector("#household-results");
  const cards = [householdCard("personOne")];
  if (peopleState.personTwoEnabled) cards.push(householdCard("personTwo"));
  else cards.push(el("article", { className: "household-card" }, el("h3", { text: "Person 2" }), el("p", { text: "Add Person 2 to compare independent plans." })));
  host.replaceChildren(...cards);
}

function householdCard(personKey) {
  const person = peopleState.people[personKey]; const values = person.profiles[person.selectedCountry];
  const result = scenario(values, 0.03); const format = currencyContext(values);
  return el("article", { className: "household-card" }, el("h3", { text: `${PERSON_LABELS[personKey]} · ${values.country === "USA" ? "USA" : "UK"}` }),
    el("p", { text: `${values.currency} · Starting assets ${format.money.format(result.startingBalance)} · 3% end balance ${format.money.format(result.rows.at(-1).balance)} · ${format.money.format(result.rows[0].netMonthly)}/month` }));
}

function readDeveloperAssets() {
  try {
    const parsed = JSON.parse(localStorage.getItem(DEVELOPER_STORAGE_KEY) || "{}");
    const source = parsed.assets || parsed; const result = {};
    for (const key of ["stocks", "isa", "cash", "pensionOne", "pensionTwo", "inheritanceYear", "inheritanceAmount"]) if (Number.isFinite(Number(source[key])) && source[key] !== "") result[key] = Number(source[key]);
    if (source.companyPension != null) result.pensionOne = Number(source.companyPension);
    if (source.sipp != null) result.pensionTwo = Number(source.sipp);
    return result;
  } catch { return {}; }
}

function selectTab(tabKey) {
  activeTab = tabKey;
  const mappings = [["personOne", "#person-one-tab", "#person-one-workspace"], ["personTwo", "#person-two-tab", "#person-two-workspace"], ["household", "#household-tab", "#household-panel"]];
  for (const [key, tabSelector, panelSelector] of mappings) {
    const tab = document.querySelector(tabSelector); const panel = document.querySelector(panelSelector); const selected = key === tabKey;
    tab.setAttribute("aria-selected", String(selected)); tab.classList.toggle("person-tab--active", selected); panel.hidden = !selected;
  }
  const selectedCountry = contexts[tabKey]?.profileCountry || "UK";
  document.querySelector("#uk-longevity-note").hidden = selectedCountry !== "UK";
  if (contexts[tabKey]?.results) requestAnimationFrame(() => drawChart(contexts[tabKey]));
}

function initialiseTabs() {
  const personTwoTab = document.querySelector("#person-two-tab"); const toggle = document.querySelector("#toggle-person-two");
  personTwoTab.hidden = !peopleState.personTwoEnabled;
  toggle.textContent = peopleState.personTwoEnabled ? "Remove second person" : "Add second person";
  document.querySelector("#person-one-tab").addEventListener("click", () => selectTab("personOne"));
  personTwoTab.addEventListener("click", () => selectTab("personTwo"));
  document.querySelector("#household-tab").addEventListener("click", () => selectTab("household"));
  toggle.addEventListener("click", () => {
    peopleState.personTwoEnabled = !peopleState.personTwoEnabled; personTwoTab.hidden = !peopleState.personTwoEnabled;
    toggle.textContent = peopleState.personTwoEnabled ? "Remove second person" : "Add second person";
    persistState("personTwo", peopleState.personTwoEnabled ? "Person 2 added" : "Person 2 retained but hidden");
    selectTab(peopleState.personTwoEnabled ? "personTwo" : "personOne"); renderHousehold();
  });
}

function initialiseDeveloperTools() {
  const corner = document.querySelector("#developer-corner"); const tools = document.querySelector("#developer-tools"); const status = document.querySelector("#developer-status");
  corner.addEventListener("click", () => { const open = corner.getAttribute("aria-expanded") === "true"; corner.setAttribute("aria-expanded", String(!open)); tools.hidden = open; });
  document.querySelector("#save-developer-preset").addEventListener("click", () => {
    const values = formValues(contexts.personOne); const error = validate(contexts.personOne, values, true);
    if (error) { status.textContent = "Correct Person 1 fields first."; return; }
    const assets = Object.fromEntries(["stocks", "isa", "cash", "pensionOne", "pensionTwo", "inheritanceYear", "inheritanceAmount"].map(key => [key, values[key]]));
    localStorage.setItem(DEVELOPER_STORAGE_KEY, JSON.stringify({ assets })); status.textContent = "Developer preset saved.";
  });
  document.querySelector("#remove-developer-preset").addEventListener("click", () => { localStorage.removeItem(DEVELOPER_STORAGE_KEY); status.textContent = "Developer preset removed."; });
}

window.addEventListener("resize", () => {
  if (resizeFrame != null) cancelAnimationFrame(resizeFrame);
  resizeFrame = requestAnimationFrame(() => { resizeFrame = null; if (contexts[activeTab]?.results) drawChart(contexts[activeTab]); });
});

for (const key of PERSON_KEYS) buildPersonWorkspace(key);
initialiseTabs(); initialiseDeveloperTools();
for (const key of PERSON_KEYS) renderPerson(contexts[key], currentProfile(key));
renderHousehold();
