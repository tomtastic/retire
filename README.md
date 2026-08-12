<h1><img src="favicon.svg" alt="" width="32" height="32" style="vertical-align: 0.08em;"> Retire - Drawdown Modeller</h1>

[![CI and deploy](https://github.com/tomtastic/retire/actions/workflows/pages.yml/badge.svg?branch=main)](https://github.com/tomtastic/retire/actions/workflows/pages.yml?query=branch%3Amain)
[![Coverage](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/tomtastic/retire/coverage/coverage.json)](https://github.com/tomtastic/retire/actions/workflows/pages.yml)

A private, dependency-free UK retirement drawdown modeller.

Open `index.html` locally, or use the live [GitHub Pages site](https://tomtastic.github.io/retire/).

All calculations run in the browser; user figures are stored locally and are not uploaded.

## Care costs

In 2024, only 16,600 UK residents were aged 100 or over—about 1 in 4,200 people. ONS cohort mortality tables give a current 48-year-old approximately a 4.3% chance for men and 8.7% for women of reaching 100. This planner therefore uses £1m remaining at age 90 as a generous care reserve: ten years at the assumed £100k annual full-time-care cost. [ONS life expectancy data](https://www.ons.gov.uk/peoplepopulationandcommunity/healthandsocialcare/healthandlifeexpectancies/articles/lifeexpectancycalculator/2019-06-07)

<img width="1776" height="1686" alt="image" src="https://github.com/user-attachments/assets/e73ce12e-dfbb-48b2-b4c0-97285c69c96b" />

## Design guidance

See the [Mobile Design Guide](MOBILE_DESIGN_GUIDE.md) for the project's iPhone design ambitions, implementation requirements, and release checklist.

## Native browser features

- Semantic HTML5 form controls, validation, accessible labels, live status text, and a `<canvas>` chart.
- Modern CSS with custom properties, Grid, Flexbox, responsive media queries, and native tooltips/hover states.
- Vanilla JavaScript only, loaded as classic browser scripts; calculations use plain objects and functions, `Intl.NumberFormat` for UK currency, and the Canvas 2D API for graphs.
- `localStorage` preserves user settings and the optional developer preset; `requestAnimationFrame`, `requestIdleCallback`, and debounced timers keep interactive rendering responsive.
- No runtime dependencies, frameworks, trackers, or build step.

## Testing
Run the tests with:

```sh
npm test
```

Run ESLint with:

```sh
npm run lint
```

Coverage is measured in CI, the badge is generated from the latest `model.js` result.

```sh
npm run test:coverage
```
