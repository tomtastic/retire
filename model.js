/** Expose the dependency-free financial model in browsers and CommonJS. */
(function initialiseRetirementModel(root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.RetirementModel = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function buildRetirementModel() {
  "use strict";

  const CARE_RESERVE_AGE = 90;
  const CARE_RESERVE = 1000000;
  const MAX_BOOST = 200;

  const DEFAULTS = Object.freeze({
    country: "UK",
    currency: "GBP",
    birthDate: "1978-01-07",
    retirementDate: "2027-01-01",
    horizon: 50,
    stocks: 0,
    isa: 0,
    cash: 0,
    pensionOne: 0,
    pensionTwo: 0,
    inheritanceYear: null,
    inheritanceAmount: null,
    realReturn: 3,
    inflation: 2.5,
    pensionAge: 57,
    stateAge: 67,
    statePension: 12547.6,
    boostUntilAge: 60,
    boost: 40,
    personalAllowance: 12570,
    basicBand: 37700,
    taxFreeShare: 25,
    taxFreeCap: 268275
  });

  const USA_DEFAULTS = Object.freeze({
    country: "USA",
    currency: "USD",
    birthDate: "1978-01-07",
    retirementDate: "2027-01-01",
    horizon: 50,
    realReturn: 3,
    inflation: 2.5,
    boostUntilAge: 60,
    boost: 40,
    inheritanceYear: null,
    inheritanceAmount: null,
    penaltyFreeAccessAge: 59.5,
    traditionalTaxableShare: 100,
    rmdStartAge: null,
    taxableWithdrawalShare: 50,
    accounts: Object.freeze([])
  });

  /**
   * Parse an ISO calendar date in local time without UTC date shifting.
   * @param {string} value Date in `YYYY-MM-DD` format.
   * @returns {Date} Parsed local date at noon.
   * @throws {TypeError|RangeError} When the value is malformed or not a calendar date.
   */
  function parseLocalDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) throw new TypeError("Dates must use YYYY-MM-DD format.");
    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(year, month - 1, day, 12);
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
      throw new RangeError(`Invalid calendar date: ${value}`);
    }
    return date;
  }

  /**
   * Return a copy of a date shifted by whole calendar years.
   * @param {Date} date Source date.
   * @param {number} years Calendar years to add.
   * @returns {Date} Shifted date.
   */
  function addYears(date, years) {
    const copy = new Date(date);
    copy.setFullYear(copy.getFullYear() + years);
    return copy;
  }

  /**
   * Return a copy of a date shifted by whole calendar months.
   * @param {Date} date Source date.
   * @param {number} months Calendar months to add.
   * @returns {Date} Shifted date.
   */
  function addMonths(date, months) {
    const copy = new Date(date);
    copy.setMonth(copy.getMonth() + months);
    return copy;
  }

  /**
   * Calculate age in completed years on a given date.
   * @param {Date} date Date at which to measure age.
   * @param {Date} birthDate Birth date.
   * @returns {number} Completed years of age.
   */
  function ageAt(date, birthDate) {
    let age = date.getFullYear() - birthDate.getFullYear();
    const beforeBirthday = date.getMonth() < birthDate.getMonth() ||
      (date.getMonth() === birthDate.getMonth() && date.getDate() < birthDate.getDate());
    if (beforeBirthday) age -= 1;
    return age;
  }

  /**
   * Collect validation errors for a model input set and drawdown rate.
   * @param {Object<string, *>} values Candidate model values.
   * @param {number} rate Initial annual drawdown rate as a decimal.
   * @returns {string[]} Validation messages.
   */
  function validateModelInputs(values, rate) {
    const errors = [];
    let birth;
    let retirement;
    try { birth = parseLocalDate(values.birthDate); } catch (error) { errors.push(error.message); }
    try { retirement = parseLocalDate(values.retirementDate); } catch (error) { errors.push(error.message); }
    if (birth && retirement && retirement <= birth) errors.push("Retirement must be after birth.");

    const nonNegative = [
      "stocks", "isa", "cash", "pensionOne", "pensionTwo", "statePension", "boost",
      "personalAllowance", "basicBand", "taxFreeShare", "taxFreeCap"
    ];
    for (const key of nonNegative) {
      if (!Number.isFinite(values[key]) || values[key] < 0) errors.push(`${key} must be a finite non-negative number.`);
    }
    if (!Number.isInteger(values.horizon) || values.horizon < 1 || values.horizon > 100) errors.push("horizon must be an integer from 1 to 100.");
    if (!Number.isFinite(values.realReturn) || values.realReturn <= -100) errors.push("realReturn must be greater than -100%.");
    if (!Number.isFinite(values.inflation) || values.inflation <= -100) errors.push("inflation must be greater than -100%.");
    if (!Number.isFinite(values.pensionAge) || !Number.isFinite(values.stateAge) || values.stateAge <= values.pensionAge) {
      errors.push("State Pension age must be later than pension access age.");
    }
    if (!Number.isFinite(values.boostUntilAge)) errors.push("boostUntilAge must be finite.");
    if (values.taxFreeShare > 100) errors.push("taxFreeShare cannot exceed 100%.");
    if (!Number.isFinite(rate) || rate <= 0 || rate > 1) errors.push("Drawdown rate must be greater than 0 and no more than 100%.");

    const hasInheritanceYear = values.inheritanceYear != null;
    const hasInheritanceAmount = values.inheritanceAmount != null && values.inheritanceAmount !== 0;
    if (hasInheritanceYear !== hasInheritanceAmount) errors.push("Inheritance year and amount must both be supplied or both omitted.");
    if (hasInheritanceYear && (!Number.isInteger(values.inheritanceYear) || values.inheritanceYear < retirement?.getFullYear())) {
      errors.push("Inheritance year must be an integer no earlier than retirement year.");
    }
    if (hasInheritanceAmount && (!Number.isFinite(values.inheritanceAmount) || values.inheritanceAmount < 0)) {
      errors.push("inheritanceAmount must be finite and non-negative.");
    }
    return errors;
  }

  /**
   * Project one retirement drawdown plan month by month and report annual rows.
   * @param {Object<string, *>} values Valid model assumptions and starting balances.
   * @param {number} rate Initial annual drawdown rate as a decimal.
   * @returns {Object} Scenario metadata, annual rows, balances, and depletion timing.
   * @throws {RangeError} When any model input is invalid.
   */
  function ukScenario(values, rate) {
    const errors = validateModelInputs(values, rate);
    if (errors.length) throw new RangeError(errors.join(" "));

    const birth = parseLocalDate(values.birthDate);
    const retirement = parseLocalDate(values.retirementDate);
    const pensionDate = addYears(birth, values.pensionAge);
    const stateDate = addYears(birth, values.stateAge);
    let stocks = values.stocks;
    let isa = values.isa;
    let cash = values.cash;
    let pensionOne = values.pensionOne;
    let pensionTwo = values.pensionTwo;
    let accessible = values.stocks + values.isa + values.cash;
    let pension = values.pensionOne + values.pensionTwo;
    const startingAccessible = accessible;
    const startingPension = pension;
    const pensionAvailableAtStart = retirement >= pensionDate;
    const startingAvailablePot = startingAccessible + (pensionAvailableAtStart ? startingPension : 0);
    const startingBalance = accessible + pension;
    const baseAnnualIncome = startingBalance * rate;
    const monthlyReturn = Math.pow(1 + values.realReturn / 100, 1 / 12) - 1;
    const taxFreeRate = values.taxFreeShare / 100;
    const annualTaxEfficientPension = values.personalAllowance / Math.max(0.01, 1 - taxFreeRate);
    let taxFreeCashUsed = 0;
    let inheritanceAdded = false;
    let depletedAt = null;
    const rows = [];

    /**
     * Withdraw proportionally from stocks, ISA, and cash.
     * @param {number} amount Requested withdrawal.
     * @returns {number} Amount actually withdrawn.
     */
    function drawFromAccessible(amount) {
      const componentTotal = stocks + isa + cash;
      const actual = Math.min(Math.max(0, amount), Math.max(0, accessible));
      if (actual > 0 && componentTotal > 0) {
        stocks -= actual * stocks / componentTotal;
        isa -= actual * isa / componentTotal;
        cash -= actual * cash / componentTotal;
      }
      accessible -= actual;
      return actual;
    }

    /**
     * Withdraw proportionally from both private pension components.
     * @param {number} amount Requested withdrawal.
     * @returns {number} Amount actually withdrawn.
     */
    function drawFromPension(amount) {
      const componentTotal = pensionOne + pensionTwo;
      const actual = Math.min(Math.max(0, amount), Math.max(0, pension));
      if (actual > 0 && componentTotal > 0) {
        pensionOne -= actual * pensionOne / componentTotal;
        pensionTwo -= actual * pensionTwo / componentTotal;
      }
      pension -= actual;
      return actual;
    }

    for (let projectionYear = 0; projectionYear < values.horizon; projectionYear += 1) {
      let grossIncome = 0;
      let pensionDraw = 0;
      let stateIncome = 0;
      let unmet = 0;
      let inheritedThisYear = false;

      for (let month = 0; month < 12; month += 1) {
        const monthIndex = projectionYear * 12 + month;
        const date = addMonths(retirement, monthIndex);

        if (!inheritanceAdded && values.inheritanceYear != null && date.getFullYear() >= values.inheritanceYear) {
          const yearsFromRetirement = Math.max(0, values.inheritanceYear - retirement.getFullYear());
          const realInheritance = values.inheritanceAmount / Math.pow(1 + values.inflation / 100, yearsFromRetirement);
          cash += realInheritance;
          accessible += realInheritance;
          inheritanceAdded = true;
          inheritedThisYear = true;
        }

        stocks *= 1 + monthlyReturn;
        isa *= 1 + monthlyReturn;
        cash *= 1 + monthlyReturn;
        pensionOne *= 1 + monthlyReturn;
        pensionTwo *= 1 + monthlyReturn;
        accessible *= 1 + monthlyReturn;
        pension *= 1 + monthlyReturn;

        const isBoosted = date < addYears(birth, values.boostUntilAge);
        const annualTarget = baseAnnualIncome * (isBoosted ? 1 + values.boost / 100 : 1);
        const monthlyTarget = annualTarget / 12;
        const monthlyState = date >= stateDate ? values.statePension / 12 : 0;
        stateIncome += monthlyState;
        grossIncome += Math.max(monthlyTarget, monthlyState);
        let required = Math.max(0, monthlyTarget - monthlyState);

        const pensionAvailable = date >= pensionDate;
        if (!pensionAvailable) {
          const fromAccessible = Math.min(accessible, required);
          drawFromAccessible(fromAccessible);
          required -= fromAccessible;
        } else if (date < stateDate) {
          const plannedPension = Math.min(required, annualTaxEfficientPension / 12, pension);
          drawFromPension(plannedPension);
          pensionDraw += plannedPension;
          required -= plannedPension;
          const fromAccessible = Math.min(accessible, required);
          drawFromAccessible(fromAccessible);
          required -= fromAccessible;
          const extraPension = Math.min(pension, required);
          drawFromPension(extraPension);
          pensionDraw += extraPension;
          required -= extraPension;
        } else {
          const fromAccessible = Math.min(accessible, required);
          drawFromAccessible(fromAccessible);
          required -= fromAccessible;
          const fromPension = Math.min(pension, required);
          drawFromPension(fromPension);
          pensionDraw += fromPension;
          required -= fromPension;
        }

        if (required > 1e-8) {
          unmet += required;
          if (!depletedAt) depletedAt = new Date(date);
        }
      }

      const availableTaxFreeCash = Math.max(0, values.taxFreeCap - taxFreeCashUsed);
      const taxFreeCash = Math.min(pensionDraw * taxFreeRate, availableTaxFreeCash);
      taxFreeCashUsed += taxFreeCash;
      const taxableIncome = Math.max(0, pensionDraw - taxFreeCash + stateIncome);
      const incomeTax = calculateIncomeTax(taxableIncome, values.personalAllowance, values.basicBand);
      const netIncome = Math.max(0, grossIncome - unmet - incomeTax);
      const startDate = addMonths(retirement, projectionYear * 12);
      const endDate = addMonths(retirement, (projectionYear + 1) * 12 - 1);
      const remainingBalance = Math.max(0, accessible + pension);
      const pensionAvailableAtYearEnd = endDate >= pensionDate;
      const availablePot = Math.max(0, accessible + (pensionAvailableAtYearEnd ? pension : 0));

      rows.push({
        year: endDate.getFullYear(),
        age: ageAt(endDate, birth),
        netMonthly: netIncome / 12,
        balance: remainingBalance,
        availablePot,
        pensionAvailable: pensionAvailableAtYearEnd,
        accessibleBalance: Math.max(0, accessible),
        pensionBalance: Math.max(0, pension),
        stocksBalance: Math.max(0, stocks),
        isaBalance: Math.max(0, isa),
        cashBalance: Math.max(0, cash),
        pensionOneBalance: Math.max(0, pensionOne),
        pensionTwoBalance: Math.max(0, pensionTwo),
        incomeTax,
        grossIncome,
        stateIncome,
        pensionDraw,
        unmetIncome: unmet,
        inheritedThisYear,
        pensionStarted: endDate >= pensionDate && addMonths(endDate, -11) < pensionDate,
        stateStarted: endDate >= stateDate && addMonths(endDate, -11) < stateDate,
        depletionStarted: depletedAt != null && depletedAt >= startDate && depletedAt <= endDate,
        stateOnly: remainingBalance < 0.01 && stateIncome > 0 && pensionDraw < 0.01,
        depleted: unmet > 1e-8
      });
    }

    return {
      rate,
      rows,
      startingBalance,
      startingAccessible,
      startingPension,
      startingPots: Object.freeze({
        stocks: values.stocks,
        isa: values.isa,
        cash: values.cash,
        pensionOne: values.pensionOne,
        pensionTwo: values.pensionTwo
      }),
      startingAvailablePot,
      pensionAvailableAtStart,
      startingYear: retirement.getFullYear(),
      startingAge: ageAt(retirement, birth),
      baseAnnualIncome,
      depletedAt
    };
  }

  /** Project a USA plan using configurable illustrative account assumptions. */
  function usaScenario(values, rate) {
    const merged = { ...USA_DEFAULTS, ...values };
    const birth = parseLocalDate(merged.birthDate);
    const retirement = parseLocalDate(merged.retirementDate);
    const accounts = Array.isArray(merged.accounts) ? merged.accounts : [];
    const balances = { "401k": 0, traditionalIRA: 0, rothIRA: 0, taxableBrokerage: 0 };
    for (const account of accounts) {
      const type = account.type || account.kind;
      if (Object.hasOwn(balances, type)) balances[type] += Math.max(0, Number(account.balance) || 0);
    }
    const startingBalance = Object.values(balances).reduce((sum, value) => sum + value, 0);
    const startingBalances = { ...balances };
    const monthlyReturn = Math.pow(1 + merged.realReturn / 100, 1 / 12) - 1;
    const baseAnnualIncome = startingBalance * rate;
    const rows = [];
    let depletedAt = null;
    let inheritanceAdded = false;
    const withdraw = (amount, age) => {
      let remaining = amount;
      let taxableIncome = 0;
      const take = (key, taxableShare = 0, penalty = false) => {
        const actual = Math.min(balances[key], remaining);
        balances[key] -= actual;
        if (Math.abs(balances[key]) < 1e-8) balances[key] = 0;
        remaining -= actual;
        taxableIncome += actual * taxableShare;
        if (penalty && age < merged.penaltyFreeAccessAge) taxableIncome += actual * 0.1;
      };
      take("taxableBrokerage", Math.max(0, Math.min(100, merged.taxableWithdrawalShare)) / 100);
      take("rothIRA", 0);
      if (age < merged.penaltyFreeAccessAge) return { remaining, taxableIncome };
      const traditionalShare = Math.max(0, Math.min(100, merged.traditionalTaxableShare)) / 100;
      take("401k", traditionalShare, true);
      take("traditionalIRA", traditionalShare, true);
      return { remaining, taxableIncome };
    };
    for (let yearIndex = 0; yearIndex < merged.horizon; yearIndex += 1) {
      let grossIncome = 0;
      let taxableIncome = 0;
      let unmet = 0;
      let inheritedThisYear = false;
      for (let month = 0; month < 12; month += 1) {
        const date = addMonths(retirement, yearIndex * 12 + month);
        if (!inheritanceAdded && merged.inheritanceYear != null && date.getFullYear() >= merged.inheritanceYear) {
          const yearsFromRetirement = Math.max(0, merged.inheritanceYear - retirement.getFullYear());
          balances.taxableBrokerage += (Number(merged.inheritanceAmount) || 0) / Math.pow(1 + merged.inflation / 100, yearsFromRetirement);
          inheritanceAdded = true;
          inheritedThisYear = true;
        }
        Object.keys(balances).forEach(key => { balances[key] *= 1 + monthlyReturn; });
        const age = ageAt(date, birth);
        const target = baseAnnualIncome * (date < addYears(birth, merged.boostUntilAge) ? 1 + merged.boost / 100 : 1) / 12;
        let result = withdraw(target, age);
        if (merged.rmdStartAge != null && age >= merged.rmdStartAge && balances["401k"] + balances.traditionalIRA > 0) {
          const rmd = (balances["401k"] + balances.traditionalIRA) / 25 / 12;
          const forced = withdraw(rmd, age);
          result = { remaining: result.remaining, taxableIncome: result.taxableIncome + forced.taxableIncome };
        }
        grossIncome += target;
        taxableIncome += result.taxableIncome;
        unmet += result.remaining;
        if (result.remaining > 1e-8 && !depletedAt) depletedAt = new Date(date);
      }
      const startDate = addMonths(retirement, yearIndex * 12);
      const endDate = addMonths(retirement, (yearIndex + 1) * 12 - 1);
      const accessDate = addMonths(birth, Math.round(merged.penaltyFreeAccessAge * 12));
      const accessAvailable = endDate >= accessDate;
      const balance = Object.values(balances).reduce((sum, value) => sum + Math.max(0, value), 0);
      const tax = taxableIncome * 0.22;
      rows.push({
        year: endDate.getFullYear(), age: ageAt(endDate, birth), netMonthly: Math.max(0, grossIncome - unmet - tax) / 12,
        balance, availablePot: Math.max(0, balances.taxableBrokerage + balances.rothIRA + (accessAvailable ? balances["401k"] + balances.traditionalIRA : 0)), pensionAvailable: accessAvailable,
        accessibleBalance: Math.max(0, balances.taxableBrokerage + balances.rothIRA), pensionBalance: Math.max(0, balances["401k"] + balances.traditionalIRA),
        stocksBalance: Math.max(0, balances.taxableBrokerage), isaBalance: 0, cashBalance: 0,
        pensionOneBalance: Math.max(0, balances["401k"]), pensionTwoBalance: Math.max(0, balances.traditionalIRA),
        incomeTax: tax, grossIncome, stateIncome: 0, pensionDraw: 0, unmetIncome: unmet,
        inheritedThisYear, pensionStarted: accessAvailable && startDate < accessDate, stateStarted: false,
        depletionStarted: depletedAt != null && depletedAt >= startDate && depletedAt <= endDate,
        stateOnly: false, depleted: unmet > 1e-8,
        accountBalances: { ...balances }
      });
    }
    return {
      rate, rows, startingBalance, startingAccessible: startingBalances.taxableBrokerage + startingBalances.rothIRA,
      startingPension: startingBalances["401k"] + startingBalances.traditionalIRA,
      startingPots: Object.freeze({ ...startingBalances }),
      startingAvailablePot: startingBalances.taxableBrokerage + startingBalances.rothIRA +
        (ageAt(retirement, birth) >= merged.penaltyFreeAccessAge ? startingBalances["401k"] + startingBalances.traditionalIRA : 0),
      pensionAvailableAtStart: retirement >= addMonths(birth, Math.round(merged.penaltyFreeAccessAge * 12)),
      startingYear: retirement.getFullYear(), startingAge: ageAt(retirement, birth), baseAnnualIncome, depletedAt
    };
  }

  function scenario(values, rate) {
    return (values.country || "UK").toUpperCase() === "USA" ? usaScenario(values, rate) : ukScenario(values, rate);
  }

  function normalizePerson(person = {}) {
    const country = (person.country || "UK").toUpperCase() === "USA" ? "USA" : "UK";
    if (country === "USA") return { ...USA_DEFAULTS, ...person, country, currency: "USD" };
    return { ...DEFAULTS, ...person, country: "UK", currency: "GBP" };
  }

  function migratePeopleState(saved) {
    const emptyPerson = selectedCountry => ({
      selectedCountry,
      profiles: {
        UK: normalizePerson(DEFAULTS),
        USA: normalizePerson(USA_DEFAULTS)
      }
    });
    if (saved && saved.version === 3 && saved.people?.personOne?.profiles && saved.people?.personTwo?.profiles) {
      const one = saved.people.personOne;
      const two = saved.people.personTwo;
      return {
        version: 3,
        personTwoEnabled: Boolean(saved.personTwoEnabled),
        people: {
          personOne: {
            selectedCountry: "UK",
            profiles: {
              UK: normalizePerson({ ...DEFAULTS, ...one.profiles.UK, country: "UK" }),
              USA: normalizePerson({ ...USA_DEFAULTS, ...one.profiles.USA, country: "USA" })
            }
          },
          personTwo: {
            selectedCountry: two.selectedCountry === "UK" ? "UK" : "USA",
            profiles: {
              UK: normalizePerson({ ...DEFAULTS, ...two.profiles.UK, country: "UK" }),
              USA: normalizePerson({ ...USA_DEFAULTS, ...two.profiles.USA, country: "USA" })
            }
          }
        }
      };
    }
    const migrated = { version: 3, personTwoEnabled: Boolean(saved?.personTwoEnabled), people: { personOne: emptyPerson("UK"), personTwo: emptyPerson("USA") } };
    if (saved && saved.version === 2 && saved.people?.personOne) {
      const one = saved.people.personOne;
      const two = saved.people.personTwo;
      migrated.people.personOne.profiles.UK = normalizePerson({ ...DEFAULTS, ...one, country: "UK" });
      if (two && typeof two === "object") {
        const country = (two.country || "USA").toUpperCase() === "UK" ? "UK" : "USA";
        migrated.people.personTwo.selectedCountry = country;
        migrated.people.personTwo.profiles[country] = normalizePerson(two);
      }
      return migrated;
    }
    const legacy = saved && typeof saved === "object" ? saved : {};
    migrated.people.personOne.profiles.UK = normalizePerson({ ...DEFAULTS, ...legacy, country: "UK" });
    return migrated;
  }

  /**
   * Calculate simplified UK basic- and higher-rate income tax.
   * @param {number} income Annual taxable-source income before allowance.
   * @param {number} allowance Personal allowance.
   * @param {number} basicBand Width of the basic-rate band.
   * @returns {number} Annual income tax.
   */
  function calculateIncomeTax(income, allowance, basicBand) {
    if (![income, allowance, basicBand].every(Number.isFinite) || income < 0 || allowance < 0 || basicBand < 0) {
      throw new RangeError("Tax inputs must be finite non-negative numbers.");
    }
    const taxable = Math.max(0, income - allowance);
    const basic = Math.min(taxable, basicBand) * 0.2;
    const higher = Math.max(0, taxable - basicBand) * 0.4;
    return basic + higher;
  }

  /**
   * Find the first projected balance at or after a target age.
   * @param {Object} result Calculated scenario.
   * @param {number} targetAge Age to inspect.
   * @returns {number|null} Balance, or `null` when the horizon is too short.
   */
  function balanceAtAge(result, targetAge) {
    const row = result.rows.find(item => item.age >= targetAge);
    return row ? row.balance : null;
  }

  /**
   * Classify a balance relative to the care-reserve target.
   * @param {number} balance Balance to classify.
   * @param {number} [targetBalance=CARE_RESERVE] Reserve target.
   * @returns {"surplus"|"shortfall"|"on-target"} Reserve status.
   */
  function careReserveStatus(balance, targetBalance = CARE_RESERVE) {
    if (!Number.isFinite(balance) || !Number.isFinite(targetBalance) || targetBalance < 0) {
      throw new RangeError("Care-reserve values must be finite and the target non-negative.");
    }
    if (balance > targetBalance) return "surplus";
    if (balance < targetBalance) return "shortfall";
    return "on-target";
  }

  /**
   * Solve the early-income uplift that approaches the target care reserve.
   * @param {Object<string, *>} values Valid model values.
   * @param {number} rate Initial drawdown rate as a decimal.
   * @param {number} [targetAge=CARE_RESERVE_AGE] Reserve assessment age.
   * @param {number} [targetBalance=CARE_RESERVE] Desired remaining balance.
   * @param {number} [maxBoost=MAX_BOOST] Maximum uplift percentage to test.
   * @returns {number|null} Suggested uplift, or `null` when the tested range cannot safely reach the target.
   */
  function solveBoostForCareReserve(values, rate, targetAge = CARE_RESERVE_AGE, targetBalance = CARE_RESERVE, maxBoost = MAX_BOOST) {
    const currentBalance = balanceAtAge(scenario(values, rate), targetAge);
    if (currentBalance == null || currentBalance <= targetBalance) return values.boost;
    let low = values.boost;
    let high = maxBoost;
    const highResult = scenario({ ...values, boost: high }, rate);
    const highBalance = balanceAtAge(highResult, targetAge);
    if (highBalance == null || highBalance > targetBalance) return null;
    for (let iteration = 0; iteration < 36; iteration += 1) {
      const midpoint = (low + high) / 2;
      const midpointResult = scenario({ ...values, boost: midpoint }, rate);
      const midpointBalance = balanceAtAge(midpointResult, targetAge);
      if (midpointBalance > targetBalance) low = midpoint; else high = midpoint;
    }
    const recommendedResult = scenario({ ...values, boost: high }, rate);
    return depletesBeforeAge(recommendedResult, values, targetAge) ? null : high;
  }

  /**
   * Solve a broader initial drawdown rate that approaches the care-reserve target.
   * @param {Object<string, *>} values Valid model values.
   * @param {number} [targetAge=CARE_RESERVE_AGE] Reserve assessment age.
   * @param {number} [targetBalance=CARE_RESERVE] Desired remaining balance.
   * @returns {number|null} Suggested decimal rate, or `null` when unavailable or unsafe.
   */
  function solveRateForCareReserve(values, targetAge = CARE_RESERVE_AGE, targetBalance = CARE_RESERVE) {
    let low = 0.001;
    let high = 0.12;
    if (balanceAtAge(scenario(values, high), targetAge) > targetBalance) return null;
    for (let iteration = 0; iteration < 36; iteration += 1) {
      const midpoint = (low + high) / 2;
      const result = scenario(values, midpoint);
      const balance = balanceAtAge(result, targetAge);
      if (balance == null) return null;
      if (balance > targetBalance) low = midpoint; else high = midpoint;
    }
    const recommended = scenario(values, high);
    return depletesBeforeAge(recommended, values, targetAge) ? null : high;
  }

  /**
   * Find the largest slider uplift that preserves the pre-pension bridge pots.
   * @param {Object<string, *>} values Valid model values.
   * @param {number} [maxBoost=MAX_BOOST] Maximum uplift percentage to test.
   * @param {number[]} [rates] Drawdown rates that must all remain safe.
   * @returns {number} Safe uplift percentage rounded down to a slider step.
   */
  function maxBoostBeforePensionAccess(values, maxBoost = MAX_BOOST, rates = [0.03, 0.04]) {
    const birth = parseLocalDate(values.birthDate);
    const retirement = parseLocalDate(values.retirementDate);
    if (retirement >= addYears(birth, values.pensionAge)) return maxBoost;

    const isSafe = boost => rates.every(rate => !depletesBeforeAge(scenario({ ...values, boost }, rate), values, values.pensionAge));
    if (!isSafe(0)) return 0;
    if (isSafe(maxBoost)) return maxBoost;

    let low = 0;
    let high = maxBoost;
    for (let iteration = 0; iteration < 12; iteration += 1) {
      const midpoint = (low + high) / 2;
      if (isSafe(midpoint)) low = midpoint; else high = midpoint;
    }
    return Math.max(0, Math.floor(low / 5) * 5);
  }

  /**
   * Check that the 3% plan retains an available pot until the profile's bridge milestone.
   * UK profiles must reach State Pension age (and therefore private-pension access first);
   * USA profiles must reach the configured traditional-account access age.
   * @param {Object<string, *>} values Candidate model values.
   * @returns {boolean} Whether early-income settings preserve the bridge.
   */
  function earlyIncomeBridgeSafe(values) {
    const person = normalizePerson(values);
    const birth = parseLocalDate(person.birthDate);
    const milestoneAge = person.country === "USA" ? person.penaltyFreeAccessAge : person.stateAge;
    const result = scenario(person, 0.03);
    if (result.depletedAt && ageAtPrecise(result.depletedAt, birth) < milestoneAge) return false;
    return !result.rows.some(row => row.age < milestoneAge && row.availablePot < 0.01);
  }

  /** Return age including completed months for half-year USA access boundaries. */
  function ageAtPrecise(date, birthDate) {
    const months = (date.getFullYear() - birthDate.getFullYear()) * 12 + date.getMonth() - birthDate.getMonth();
    const adjustedMonths = date.getDate() < birthDate.getDate() ? months - 1 : months;
    return adjustedMonths / 12;
  }

  /**
   * Test whether a scenario first becomes underfunded before a target age.
   * @param {Object} result Calculated scenario.
   * @param {Object<string, *>} values Model values containing the birth date.
   * @param {number} targetAge Age boundary.
   * @returns {boolean} Whether depletion occurs before the boundary.
   */
  function depletesBeforeAge(result, values, targetAge) {
    if (!result.depletedAt) return false;
    return ageAt(result.depletedAt, parseLocalDate(values.birthDate)) < targetAge;
  }

  return Object.freeze({
    CARE_RESERVE_AGE,
    CARE_RESERVE,
    MAX_BOOST,
    DEFAULTS,
    parseLocalDate,
    addYears,
    addMonths,
    ageAt,
    validateModelInputs,
    scenario,
    calculateIncomeTax,
    balanceAtAge,
    careReserveStatus,
    solveBoostForCareReserve,
    solveRateForCareReserve,
    maxBoostBeforePensionAccess,
    earlyIncomeBridgeSafe,
    depletesBeforeAge,
    USA_DEFAULTS,
    normalizePerson,
    migratePeopleState,
    ukScenario,
    usaScenario
  });
});
