"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  DEFAULTS: MODEL_DEFAULTS,
  parseLocalDate,
  ageAt,
  validateModelInputs,
  scenario,
  calculateIncomeTax,
  balanceAtAge,
  careReserveStatus,
  solveBoostForCareReserve,
  solveRateForCareReserve,
  maxBoostBeforePensionAccess
  ,normalizePerson, migratePeopleState
} = require("../model.js");

const DEFAULTS = Object.freeze({
  ...MODEL_DEFAULTS,
  stocks: 327000,
  isa: 286000,
  cash: 0,
  pensionOne: 396000,
  pensionTwo: 265000,
  inheritanceYear: 2037,
  inheritanceAmount: 200000,
  boostUntilAge: 55,
  boost: 25
});

function values(overrides = {}) {
  return { ...DEFAULTS, ...overrides };
}

test("built-in defaults start with zero assets and the new early-income settings", () => {
  assert.equal(MODEL_DEFAULTS.stocks, 0);
  assert.equal(MODEL_DEFAULTS.isa, 0);
  assert.equal(MODEL_DEFAULTS.cash, 0);
  assert.equal(MODEL_DEFAULTS.pensionOne, 0);
  assert.equal(MODEL_DEFAULTS.pensionTwo, 0);
  assert.equal(MODEL_DEFAULTS.inheritanceYear, null);
  assert.equal(MODEL_DEFAULTS.inheritanceAmount, null);
  assert.equal(MODEL_DEFAULTS.boostUntilAge, 60);
  assert.equal(MODEL_DEFAULTS.boost, 40);
});

function withoutInheritance(overrides = {}) {
  return values({ inheritanceYear: null, inheritanceAmount: null, ...overrides });
}

function close(actual, expected, tolerance = 0.01, message = "") {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${message} expected ${expected}, got ${actual}`);
}

test("default inputs produce finite 50-year projections", () => {
  for (const rate of [0.03, 0.04]) {
    const result = scenario(DEFAULTS, rate);
    assert.equal(result.rows.length, 50);
    assert.equal(result.startingBalance, 1274000);
    assert.equal(result.startingAccessible, 613000);
    assert.equal(result.startingPension, 661000);
    assert.equal(result.startingAvailablePot, 613000);
    assert.equal(result.pensionAvailableAtStart, false);
    assert.equal(result.startingYear, 2027);
    assert.equal(result.startingAge, 48);
    close(result.baseAnnualIncome, result.startingBalance * rate);
    for (const row of result.rows) {
      for (const key of ["netMonthly", "balance", "availablePot", "accessibleBalance", "pensionBalance", "stocksBalance", "isaBalance", "cashBalance", "pensionOneBalance", "pensionTwoBalance", "incomeTax", "grossIncome", "stateIncome", "pensionDraw", "unmetIncome"]) {
        assert.ok(Number.isFinite(row[key]), `${key} should be finite in ${row.year}`);
        assert.ok(row[key] >= -1e-7, `${key} should not be negative in ${row.year}`);
      }
      close(row.balance, row.accessibleBalance + row.pensionBalance, 0.001, "account balances should reconcile");
      close(row.accessibleBalance, row.stocksBalance + row.isaBalance + row.cashBalance, 0.001, "non-pension pots should reconcile");
      close(row.pensionBalance, row.pensionOneBalance + row.pensionTwoBalance, 0.001, "pension pots should reconcile");
      assert.ok(row.netMonthly * 12 <= row.grossIncome + 0.01);
    }
  }
});

test("default projection retains regression-checked key results", () => {
  const three = scenario(DEFAULTS, 0.03);
  const four = scenario(DEFAULTS, 0.04);
  close(three.rows[0].netMonthly, 3981.25, 0.01);
  close(four.rows[0].netMonthly, 5308.333333, 0.01);
  close(balanceAtAge(three, 90), 1885330.08, 1);
  close(balanceAtAge(four, 90), 764768.84, 1);
  close(three.rows.at(-1).balance, 2156869.93, 1);
  close(four.rows.at(-1).balance, 622538.72, 1);
});

test("default paths expose when accessible assets are finally exhausted", () => {
  const finalAccessibleExhaustion = result => result.rows.find((row, index, rows) =>
    row.accessibleBalance < 0.01 && rows.slice(index).every(later => later.accessibleBalance < 0.01)
  );
  const three = finalAccessibleExhaustion(scenario(DEFAULTS, 0.03));
  const four = finalAccessibleExhaustion(scenario(DEFAULTS, 0.04));
  assert.deepEqual({ year: three.year, age: three.age }, { year: 2068, age: 90 });
  assert.deepEqual({ year: four.year, age: four.age }, { year: 2047, age: 69 });
});

test("zero-uplift comparison preserves the standard first-year net income", () => {
  const baseline = { ...DEFAULTS, boost: 0 };
  close(scenario(baseline, 0.03).rows[0].netMonthly, 3185, 0.01);
  close(scenario(baseline, 0.04).rows[0].netMonthly, 4246.666667, 0.01);
});

test("early-income uplift cap protects the bridge pot for both drawdown plans", () => {
  assert.equal(maxBoostBeforePensionAccess(DEFAULTS), 85);
  assert.equal(maxBoostBeforePensionAccess({ ...DEFAULTS, pensionAge: 48 }), 200);
  assert.equal(maxBoostBeforePensionAccess({ ...DEFAULTS, stocks: 1, isa: 0, cash: 0 }), 0);
});

test("monthly compounding and withdrawals match an independent recurrence", () => {
  const input = withoutInheritance({
    birthDate: "1970-01-01",
    retirementDate: "2027-01-01",
    horizon: 1,
    stocks: 1000000,
    isa: 0,
    cash: 0,
    pensionOne: 0,
    pensionTwo: 0,
    realReturn: 3,
    boostUntilAge: 50,
    boost: 0,
    pensionAge: 60,
    stateAge: 67,
    statePension: 0
  });
  const result = scenario(input, 0.03);
  const monthlyReturn = 1.03 ** (1 / 12) - 1;
  let expected = 1000000;
  for (let month = 0; month < 12; month += 1) expected = expected * (1 + monthlyReturn) - 2500;
  close(result.rows[0].balance, expected, 0.001);
  close(result.rows[0].netMonthly, 2500);
});

test("income tax respects allowance, basic band and higher rate", () => {
  close(calculateIncomeTax(12570, 12570, 37700), 0);
  close(calculateIncomeTax(50270, 12570, 37700), 7540);
  close(calculateIncomeTax(60000, 12570, 37700), 11432);
  assert.throws(() => calculateIncomeTax(-1, 12570, 37700), /Tax inputs/);
});

test("private pension remains inaccessible before pension age", () => {
  const input = withoutInheritance({
    birthDate: "1978-01-07",
    retirementDate: "2027-01-01",
    horizon: 1,
    stocks: 0,
    isa: 0,
    cash: 0,
    pensionOne: 100000,
    pensionTwo: 0,
    realReturn: 3,
    boostUntilAge: 40,
    boost: 0,
    statePension: 0
  });
  const row = scenario(input, 0.03).rows[0];
  assert.equal(row.depleted, true);
  close(row.netMonthly, 0);
  close(row.pensionBalance, 103000, 0.01);
  close(row.accessibleBalance, 0);
  close(row.availablePot, 0);
});

test("available pot excludes locked pensions and includes them after access", () => {
  const result = scenario(DEFAULTS, 0.03);
  const beforeAccess = result.rows.find(row => row.year === 2034);
  const accessYear = result.rows.find(row => row.pensionStarted);
  assert.equal(beforeAccess.pensionAvailable, false);
  close(beforeAccess.availablePot, beforeAccess.accessibleBalance, 0.001);
  assert.ok(beforeAccess.availablePot < beforeAccess.balance);
  assert.equal(accessYear.pensionAvailable, true);
  close(accessYear.availablePot, accessYear.balance, 0.001);
  result.rows.slice(result.rows.indexOf(accessYear)).forEach(row => close(row.availablePot, row.balance, 0.001));
});

test("opening pot includes pensions when already accessible at retirement", () => {
  const input = withoutInheritance({
    birthDate: "1970-01-01",
    retirementDate: "2027-01-01",
    stocks: 100,
    isa: 200,
    cash: 300,
    pensionOne: 400,
    pensionTwo: 500,
    pensionAge: 57,
    stateAge: 67,
    statePension: 0,
    horizon: 1,
    boost: 0
  });
  const result = scenario(input, 0.03);
  assert.equal(result.pensionAvailableAtStart, true);
  assert.equal(result.startingAccessible, 600);
  assert.equal(result.startingPension, 900);
  assert.equal(result.startingAvailablePot, 1500);
});

test("pension withdrawals apply 25% tax-free cash and income tax", () => {
  const input = withoutInheritance({
    birthDate: "1970-01-01",
    retirementDate: "2027-01-01",
    horizon: 1,
    stocks: 0,
    isa: 0,
    cash: 0,
    pensionOne: 1000000,
    pensionTwo: 0,
    realReturn: 0,
    pensionAge: 57,
    stateAge: 67,
    statePension: 0,
    boostUntilAge: 50,
    boost: 0
  });
  const row = scenario(input, 0.03).rows[0];
  close(row.pensionDraw, 30000);
  close(row.incomeTax, 1986);
  close(row.netMonthly, (30000 - 1986) / 12);

  const noTaxFreeCash = scenario({ ...input, taxFreeCap: 0 }, 0.03).rows[0];
  close(noTaxFreeCash.incomeTax, 3486);
  assert.ok(noTaxFreeCash.netMonthly < row.netMonthly);
});

test("State Pension is received even when it exceeds the drawdown target", () => {
  const input = withoutInheritance({
    birthDate: "1950-01-01",
    retirementDate: "2027-01-01",
    horizon: 1,
    stocks: 1000,
    isa: 0,
    cash: 0,
    pensionOne: 0,
    pensionTwo: 0,
    realReturn: 0,
    pensionAge: 57,
    stateAge: 67,
    statePension: 12547.6,
    boostUntilAge: 40,
    boost: 0
  });
  const row = scenario(input, 0.03).rows[0];
  close(row.netMonthly, 12547.6 / 12);
  close(row.balance, 1000);
  close(row.stateIncome, 12547.6);
});

test("after depletion the model reports State Pension only, not phantom drawdown", () => {
  const input = withoutInheritance({
    birthDate: "1960-12-31",
    retirementDate: "2026-01-01",
    horizon: 3,
    stocks: 100,
    isa: 0,
    cash: 0,
    pensionOne: 0,
    pensionTwo: 0,
    realReturn: 0,
    pensionAge: 57,
    stateAge: 67,
    statePension: 12000,
    boostUntilAge: 40,
    boost: 0,
    personalAllowance: 12570
  });
  const result = scenario(input, 1);
  assert.equal(result.rows[1].balance, 0);
  assert.equal(result.rows[1].netMonthly, 0);
  assert.equal(result.rows[2].stateOnly, true);
  close(result.rows[2].netMonthly, 1000);
  close(result.rows[2].pensionDraw, 0);
});

test("inheritance is added once, discounted to retirement-year money", () => {
  const common = {
    horizon: 11,
    realReturn: 3,
    boost: 0,
    boostUntilAge: 40
  };
  const withInheritance = scenario(values({ ...common, inheritanceYear: 2037, inheritanceAmount: 200000 }), 0.03);
  const without = scenario(withoutInheritance(common), 0.03);
  assert.equal(withInheritance.rows.filter(row => row.inheritedThisYear).length, 1);
  assert.equal(withInheritance.rows.find(row => row.inheritedThisYear).year, 2037);
  const realInheritance = 200000 / 1.025 ** 10;
  close(withInheritance.rows.at(-1).balance - without.rows.at(-1).balance, realInheritance * 1.03, 0.05);
});

test("cash is included in accessible assets and starting balance", () => {
  const base = scenario(withoutInheritance({ cash: 0, horizon: 1, boost: 0 }), 0.03);
  const withCash = scenario(withoutInheritance({ cash: 12345, horizon: 1, boost: 0 }), 0.03);
  assert.equal(withCash.startingBalance - base.startingBalance, 12345);
  assert.ok(withCash.rows[0].accessibleBalance > base.rows[0].accessibleBalance);
});

test("USA accounts normalize and preserve native USD projection contract", () => {
  const person = normalizePerson({ country: "USA", birthDate: "1970-01-01", retirementDate: "2027-01-01", horizon: 2, realReturn: 0, boost: 0, penaltyFreeAccessAge: 60, accounts: [
    { type: "401k", balance: 100000 }, { type: "traditionalIRA", balance: 50000 }, { type: "rothIRA", balance: 25000 }, { type: "taxableBrokerage", balance: 25000 }
  ] });
  const result = scenario(person, 0.03);
  assert.equal(person.currency, "USD");
  assert.equal(result.startingBalance, 200000);
  assert.equal(result.rows.length, 2);
  assert.ok(result.rows.every(row => row.balance >= -1e-8 && row.availablePot >= -1e-8));
});

test("USA traditional accounts remain locked before penalty-free access while Roth remains available", () => {
  const result = scenario(normalizePerson({ country: "USA", birthDate: "1970-01-01", retirementDate: "2027-01-01", horizon: 1, realReturn: 0, boost: 0, penaltyFreeAccessAge: 60, accounts: [
    { type: "401k", balance: 100000 }, { type: "rothIRA", balance: 100000 }
  ] }), 0.5);
  assert.equal(result.rows[0].accountBalances["401k"], 100000);
  assert.equal(result.rows[0].accountBalances.rothIRA, 0);
});

test("USA inheritance is added once in retirement-year dollars", () => {
  const base = normalizePerson({ country: "USA", birthDate: "1970-01-01", retirementDate: "2027-01-01", horizon: 3, realReturn: 0, inflation: 2.5, boost: 0, accounts: [{ type: "taxableBrokerage", balance: 100000 }] });
  const inherited = scenario({ ...base, inheritanceYear: 2028, inheritanceAmount: 25000 }, 0.03);
  assert.equal(inherited.rows.filter(row => row.inheritedThisYear).length, 1);
  assert.equal(inherited.rows.find(row => row.inheritedThisYear).year, 2028);
  assert.ok(inherited.rows.at(-1).balance > scenario(base, 0.03).rows.at(-1).balance);
});

test("legacy saved values migrate unchanged into Person 1's UK profile and keep Person 2 off", () => {
  const migrated = migratePeopleState({ birthDate: "1965-02-03", stocks: 12345, pensionOne: 67890 });
  assert.equal(migrated.version, 3);
  assert.equal(migrated.personTwoEnabled, false);
  assert.equal(migrated.people.personOne.selectedCountry, "UK");
  assert.equal(migrated.people.personOne.profiles.UK.birthDate, "1965-02-03");
  assert.equal(migrated.people.personOne.profiles.UK.stocks, 12345);
  assert.equal(migrated.people.personOne.profiles.UK.pensionOne, 67890);
  assert.equal(migrated.people.personTwo.selectedCountry, "USA");
  assert.equal(migrated.people.personTwo.profiles.USA.country, "USA");
});

test("version 2 Person 2 values migrate into their matching country profile", () => {
  const migrated = migratePeopleState({
    version: 2,
    personTwoEnabled: true,
    people: {
      personOne: { ...MODEL_DEFAULTS, stocks: 10 },
      personTwo: { country: "USA", accounts: [{ type: "401k", balance: 54321 }] }
    }
  });
  assert.equal(migrated.version, 3);
  assert.equal(migrated.personTwoEnabled, true);
  assert.equal(migrated.people.personOne.profiles.UK.stocks, 10);
  assert.equal(migrated.people.personTwo.profiles.USA.accounts[0].balance, 54321);
  assert.equal(migrated.people.personTwo.profiles.UK.country, "UK");
});

test("version 3 keeps independent Person 2 UK and USA profiles", () => {
  const migrated = migratePeopleState({
    version: 3,
    personTwoEnabled: true,
    people: {
      personOne: { selectedCountry: "UK", profiles: { UK: { ...MODEL_DEFAULTS }, USA: {} } },
      personTwo: {
        selectedCountry: "UK",
        profiles: {
          UK: { ...MODEL_DEFAULTS, isa: 111 },
          USA: { ...require("../model.js").USA_DEFAULTS, accounts: [{ type: "rothIRA", balance: 222 }] }
        }
      }
    }
  });
  assert.equal(migrated.people.personTwo.selectedCountry, "UK");
  assert.equal(migrated.people.personTwo.profiles.UK.isa, 111);
  assert.equal(migrated.people.personTwo.profiles.USA.accounts[0].balance, 222);
});

test("USA available pot excludes traditional accounts until the configured access event", () => {
  const person = normalizePerson({
    country: "USA", birthDate: "1970-01-01", retirementDate: "2027-01-01", horizon: 5,
    realReturn: 0, boost: 0, penaltyFreeAccessAge: 59.5,
    accounts: [{ type: "401k", balance: 100000 }, { type: "rothIRA", balance: 25000 }]
  });
  const result = scenario(person, 0.03);
  assert.equal(result.startingAvailablePot, 25000);
  assert.equal(result.rows.filter(row => row.pensionStarted).length, 1);
  const access = result.rows.find(row => row.pensionStarted);
  assert.equal(access.pensionAvailable, true);
  assert.ok(access.availablePot > access.accessibleBalance);
});

test("event markers occur once and in chronological order", () => {
  const result = scenario(DEFAULTS, 0.03);
  const pensionEvents = result.rows.filter(row => row.pensionStarted);
  const inheritEvents = result.rows.filter(row => row.inheritedThisYear);
  const stateEvents = result.rows.filter(row => row.stateStarted);
  assert.equal(pensionEvents.length, 1);
  assert.equal(inheritEvents.length, 1);
  assert.equal(stateEvents.length, 1);
  assert.equal(pensionEvents[0].year, 2035);
  assert.equal(inheritEvents[0].year, 2037);
  assert.equal(stateEvents[0].year, 2045);
});

test("higher drawdown never leaves more money than lower drawdown", () => {
  const three = scenario(DEFAULTS, 0.03);
  const four = scenario(DEFAULTS, 0.04);
  three.rows.forEach((row, index) => {
    assert.ok(four.rows[index].balance <= row.balance + 0.01, `4% balance exceeds 3% in ${row.year}`);
  });
});

test("1% real-return downside never outperforms 3% real return", () => {
  for (const rate of [0.03, 0.04]) {
    const central = scenario(DEFAULTS, rate);
    const downside = scenario({ ...DEFAULTS, realReturn: 1 }, rate);
    central.rows.forEach((row, index) => {
      assert.ok(downside.rows[index].balance <= row.balance + 0.01, `downside exceeds central case in ${row.year}`);
    });
  }
});

test("default 1% downside identifies depletion risk per drawdown plan", () => {
  const downsideThree = scenario({ ...DEFAULTS, realReturn: 1 }, 0.03);
  const downsideFour = scenario({ ...DEFAULTS, realReturn: 1 }, 0.04);
  assert.equal(downsideThree.rows.some(row => row.balance < 0.01), false);
  const firstZero = downsideFour.rows.find(row => row.balance < 0.01);
  assert.deepEqual({ year: firstZero.year, age: firstZero.age }, { year: 2061, age: 83 });
});

test("care-reserve boost solver converges near £1m without prior depletion", () => {
  const boost = solveBoostForCareReserve(DEFAULTS, 0.03);
  assert.ok(boost > DEFAULTS.boost && boost <= 200);
  const result = scenario({ ...DEFAULTS, boost }, 0.03);
  close(balanceAtAge(result, 90), 1000000, 2);
  assert.equal(result.depletedAt, null);
});

test("care-reserve classification uses exactly £1m and treats plans independently", () => {
  assert.equal(careReserveStatus(1002697), "surplus");
  assert.equal(careReserveStatus(155015), "shortfall");
  assert.equal(careReserveStatus(1000000), "on-target");
  assert.throws(() => careReserveStatus(Number.NaN), /Care-reserve values/);
});

test("care-reserve drawdown-rate solver converges and handles short horizons", () => {
  const rate = solveRateForCareReserve(DEFAULTS);
  assert.ok(rate > 0.03 && rate < 0.04);
  const result = scenario(DEFAULTS, rate);
  close(balanceAtAge(result, 90), 1000000, 2);
  assert.equal(result.depletedAt, null);
  assert.equal(balanceAtAge(scenario({ ...DEFAULTS, horizon: 5 }, 0.03), 90), null);
  assert.equal(solveRateForCareReserve({ ...DEFAULTS, horizon: 5 }), null);
});

test("date parsing and age calculation handle birthday boundaries", () => {
  const birth = parseLocalDate("1978-01-07");
  assert.equal(ageAt(parseLocalDate("2035-01-06"), birth), 56);
  assert.equal(ageAt(parseLocalDate("2035-01-07"), birth), 57);
  assert.throws(() => parseLocalDate("2027-02-30"), /Invalid calendar date/);
});

test("invalid financial inputs are rejected before calculation", () => {
  assert.match(validateModelInputs(values({ stocks: -1 }), 0.03).join(" "), /stocks/);
  assert.match(validateModelInputs(values({ realReturn: -100 }), 0.03).join(" "), /realReturn/);
  assert.match(validateModelInputs(values({ inheritanceYear: 2037, inheritanceAmount: null }), 0.03).join(" "), /Inheritance/);
  assert.throws(() => scenario(values({ horizon: 0 }), 0.03), /horizon/);
  assert.throws(() => scenario(DEFAULTS, 0), /Drawdown rate/);
});

test("random valid inputs preserve core accounting invariants", () => {
  let seed = 0x5eed1234;
  const random = () => {
    seed = (1664525 * seed + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  const amount = maximum => Math.round(random() * maximum);

  for (let sample = 0; sample < 150; sample += 1) {
    const birthYear = 1955 + Math.floor(random() * 35);
    const retirementYear = birthYear + 48 + Math.floor(random() * 18);
    const pensionAge = 55 + Math.floor(random() * 6);
    const stateAge = Math.max(pensionAge + 1, 66 + Math.floor(random() * 4));
    const hasInheritance = random() > 0.5;
    const input = values({
      birthDate: `${birthYear}-01-07`,
      retirementDate: `${retirementYear}-01-01`,
      horizon: 5 + Math.floor(random() * 56),
      stocks: amount(1500000),
      isa: amount(600000),
      cash: amount(200000),
      pensionOne: amount(1500000),
      pensionTwo: amount(700000),
      inheritanceYear: hasInheritance ? retirementYear + Math.floor(random() * 20) : null,
      inheritanceAmount: hasInheritance ? amount(1000000) + 1 : null,
      realReturn: -2 + random() * 10,
      inflation: random() * 7,
      pensionAge,
      stateAge,
      statePension: amount(20000),
      boostUntilAge: 50 + Math.floor(random() * 16),
      boost: Math.floor(random() * 201),
      taxFreeShare: random() * 30,
      taxFreeCap: amount(400000)
    });

    const three = scenario(input, 0.03);
    const four = scenario(input, 0.04);
    for (const result of [three, four]) {
      assert.equal(result.rows.length, input.horizon);
      for (const row of result.rows) {
        assert.ok(Number.isFinite(row.balance) && row.balance >= 0);
        assert.ok(Number.isFinite(row.netMonthly) && row.netMonthly >= 0);
        close(row.balance, row.accessibleBalance + row.pensionBalance, 0.001);
        close(row.netMonthly * 12, Math.max(0, row.grossIncome - row.unmetIncome - row.incomeTax), 0.001);
      }
    }
    three.rows.forEach((row, index) => assert.ok(four.rows[index].balance <= row.balance + 0.02));
  }
});
