# Retirement Drawdown Modeller

[![Tests](https://github.com/tomtastic/retire/actions/workflows/test.yml/badge.svg?branch=main)](https://github.com/tomtastic/retire/actions/workflows/test.yml?query=branch%3Amain)
[![Build and deploy](https://github.com/tomtastic/retire/actions/workflows/pages.yml/badge.svg?branch=main)](https://github.com/tomtastic/retire/actions/workflows/pages.yml?query=branch%3Amain)
[![Coverage](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/tomtastic/retire/coverage/coverage.json)](https://github.com/tomtastic/retire/actions/workflows/test.yml)

A private, dependency-free UK retirement drawdown modeller. Open `index.html` locally, or use the live [GitHub Pages site](https://tomtastic.github.io/retire/).

All calculations run in the browser; user figures are stored locally and are not uploaded.

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

Coverage is measured in CI, the badge is generated from the latest `model.js` result.

```sh
npm run test:coverage
```
