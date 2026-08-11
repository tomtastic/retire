# Testing

The project uses Node's built-in test runner and has no package dependencies.

Run the full suite:

```sh
npm test
```

Run it with native code coverage:

```sh
npm run test:coverage
```

The suite tests the exact `model.js` engine loaded by the webpage. It covers known calculations, tax boundaries, pension accessibility, State Pension, inheritance discounting, account reconciliation, depletion, event timing, care-reserve recommendations, downside ordering, invalid inputs, and 150 deterministic randomized portfolios.
