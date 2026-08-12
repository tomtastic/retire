# Mobile Design Guide

This guide defines the ambitions and acceptance criteria for making the Retirement Drawdown Modeller work comfortably on modern Apple iPhones. It is a living checklist: update it as browser behaviour, supported devices, or the interface changes.

## Implementation progress

This record is the implementation history for the iPhone mobile design pass begun on 12 August 2026. Checked phases are complete; device-only acceptance items remain explicit even when local automated checks pass.

### 1. Baseline and tooling

- [x] Record the working tree and preserve user-owned documentation changes.
- [x] Confirm the JavaScript and Apple development toolchain.
- [x] Run the pre-change automated baseline.
- Status: complete.
- Key decisions: preserve the financial model, saved-value schema, dependency-free runtime, desktop presentation, and existing CI/deployment behaviour; use this guide as the phase-by-phase ledger.
- Files changed: `MOBILE_DESIGN_GUIDE.md` only.
- Verification: Node 25.9.0; npm 11.12.1; Xcode 26.3 (build 17C529); selected developer directory `/Applications/Xcode.app/Contents/Developer`. Pre-change `npm test`: 51/51 passing; `git diff --check`: clean. The initial sandboxed `simctl` query could not connect to CoreSimulatorService and is deferred to phase 7 with GUI/Simulator permission.
- Simulator devices used: none.
- Screenshots: none.
- Unresolved findings: confirm the installed iOS runtime and iPhone simulator inventory outside the sandbox in phase 7.

### 2. Responsive layout and safe areas

- [x] Remove desktop-width guidance and add safe-area-aware responsive layout.
- Status: complete.
- Key decisions: use `viewport-fit=cover`; retain full-bleed page backgrounds while putting safe-area-aware padding on bounded inner content; preserve the 56px developer circle with no more than 12px clipped so its full 44px target remains visible; keep normal document flow and add a 320px-oriented breakpoint without viewport-height sizing.
- Files changed: `index.html`, `styles.css`, `MOBILE_DESIGN_GUIDE.md`.
- Verification: source inspection confirms all four safe-area insets, no viewport-height sizing, the removed `width-note`, and the 360px compact breakpoint. Final screenshot review identified and fixed later hero/footer padding shorthands that had reset inline safe-area gutters; source tests now guard against that regression. The pre-existing source-structure suite was intentionally left at 23/25 until phase 6 updated the two stale assertions for the removed warning and former developer-circle offset.
- Simulator devices used: none.
- Screenshots: none.
- Unresolved findings: visual reflow and safe-area behaviour remain to be exercised in phase 7.

### 3. Forms, typography, and touch targets

- [x] Apply and verify mobile control and text sizing.
- Status: complete.
- Key decisions: scope type enlargement to the mobile breakpoint to preserve desktop appearance; set mobile controls and range output to 16px; expand the range target to 44px; stack form actions at full width; raise annotations, labels, legends, statuses, table notes, event tags, and pot labels while allowing the semantic table to become wider inside its own scroll region.
- Files changed: `styles.css`, `MOBILE_DESIGN_GUIDE.md`.
- Verification: `npm run lint` passes; source inspection confirms 16px mobile form text, 44px range/button targets, full-width mobile actions, enlarged annotation rules, minimum-width protection for inputs, and wrapping safeguards.
- Simulator devices used: none.
- Screenshots: none.
- Unresolved findings: keyboard/focus zoom, text-size clipping, and 200% zoom require browser/Simulator checks in phase 7; physical-device Larger Text remains phase 8 acceptance.

### 4. Chart touch/keyboard interaction

- [x] Add persistent touch selection, keyboard navigation, accessible details, and robust redraw.
- Status: complete.
- Key decisions: retain transient non-touch pointer hover; use primary pointer release to lock the nearest year; dismiss on a second selection, outside pointer action, Escape, or redraw; expose focused-canvas Left/Right/Home/End navigation and an associated polite live region; position tooltips from chart points with four-edge clamping; shorten only visual marker labels below 520px.
- Files changed: `index.html`, `styles.css`, `app.js`, `MOBILE_DESIGN_GUIDE.md`.
- Verification: `npm run lint` and `node --check app.js` pass. Source inspection confirms reusable selection/rendering/positioning helpers, focusability/instructions/live details, current values passed through the resize redraw, primary tap locking and dismissal handlers, keyboard keys, and no `touch-action` override.
- Simulator devices used: none.
- Screenshots: none.
- Unresolved findings: actual touch selection, tooltip fit at rotated widths, external-keyboard navigation, and orientation redraw remain for phase 7.

### 5. Projection-table mobile affordances

- [x] Add visible scroll hints and labelled, focusable scroll regions.
- Status: complete.
- Key decisions: show a concise swipe hint only at the mobile breakpoint; keep each native table unchanged inside its own horizontal overflow region; make that region keyboard focusable, visibly focused, and labelled with its 3% or 4% plan name.
- Files changed: `app.js`, `styles.css`, `MOBILE_DESIGN_GUIDE.md`.
- Verification: `npm run lint` passes; source inspection confirms the mobile-visible hint, plan-specific accessible region label, `tabIndex = 0`, contained `overflow-x: auto`, and native table construction.
- Simulator devices used: none.
- Screenshots: none.
- Unresolved findings: touch swiping, keyboard horizontal scrolling, and enlarged-text legibility remain for phase 7.

### 6. Local development server and automated tests

- [x] Add and test the dependency-free local static server.
- [x] Update source-structure coverage for the mobile safeguards.
- Status: complete.
- Key decisions: implement the server with Node core modules only; bind `127.0.0.1:5173` with validated `PORT` override; expose an importable server factory for integration tests; return explicit 400/404/405 responses and reject decoded traversal, backslash, null-byte, and dot-prefixed path segments.
- Files changed: `package.json`, `scripts/dev-server.js`, `tests/dev-server.test.js`, `tests/page-structure.test.js`, `MOBILE_DESIGN_GUIDE.md`.
- Verification: `npm run lint` passes; `npm test` passes 59/59 outside the restricted sandbox (the sandbox correctly denied loopback binding); server tests cover index/assets and MIME types, HEAD, missing resources, unsupported methods/Allow, and unsafe paths. `npm run dev` reports `http://127.0.0.1:5173`; an end-to-end HEAD request returns 200, `text/html; charset=utf-8`, the expected content length, and `Cache-Control: no-store`; `git diff --check` is clean.
- Simulator devices used: none.
- Screenshots: none.
- Unresolved findings: none; the server remains running for phase 7 verification.

### 7. Safari and Simulator verification

- [x] Run Lighthouse mobile and review relevant findings.
- [ ] Verify Safari Responsive Design Mode at 320, 375, 390, and 430 CSS pixels.
- [x] Verify iPhone 16e, 17 Pro, and 17 Pro Max in portrait and landscape.
- [x] Verify Simulator content-size and increased-contrast variants.
- Status: partially complete; completed evidence is recorded below and GUI-only interaction checks remain pending.
- Key decisions: use the installed iOS 26.3.1 runtime and Mobile Safari for device rendering; inspect every portrait capture and representative landscape/accessibility captures; treat raw sideways landscape framebuffers as valid `simctl` output; use Lighthouse mobile only as a complement to Safari; do not count headless-Chrome 320–430 captures as Safari Responsive Design Mode evidence.
- Files changed: `index.html`, `styles.css`, `MOBILE_DESIGN_GUIDE.md`.
- Verification: iOS 26.3.1 runtime (23D8133). Portrait and landscape rendering completed on all three devices; visible regions show safe-area clearance, wrapping, readable 16px controls, normal-flow scrolling, and no observed page-level overflow. iPhone 17 Pro was also exercised at standard (`large`), `extra-extra-extra-large`, and `accessibility-large` content sizes and with Increased Contrast; settings were restored afterward. A follow-up direct Mobile Safari pass opened the native date picker with the active date field visible and no apparent page zoom (`/tmp/retire-date-focus.png`). It also exposed a touch-pointer guard that could reject non-mouse `pointerup` events; the guard now only rejects non-primary mouse buttons, and lint/unit tests pass after the fix. Lighthouse mobile initially scored 98/96/96 and identified a missing favicon plus low contrast on the input-panel eyebrow and caution icon; those were resolved. Final post-safe-area-fix report `/tmp/retire-lighthouse-mobile-final.json`: performance 98, accessibility 100, best practices 100, FCP/LCP 1.8s, TBT 0ms, CLS 0, and no failed binary audits.
- Simulator devices used: iPhone 16e, iPhone 17 Pro, and iPhone 17 Pro Max on iOS 26.3.1.
- Screenshots: `/tmp/retire-iphone-16e-portrait.png`, `/tmp/retire-iphone-16e-landscape-settled.png`, `/tmp/retire-iphone-17-pro-portrait.png`, `/tmp/retire-iphone-17-pro-landscape.png`, `/tmp/retire-iphone-17-pro-xxxl.png`, `/tmp/retire-iphone-17-pro-accessibility-large-contrast.png`, `/tmp/retire-iphone-17-pro-max-portrait-clean.png`, `/tmp/retire-iphone-17-pro-max-landscape.png`, the final post-fix `/tmp/retire-iphone-17-pro-max-final-safe-area.png`, and follow-up Mobile Safari captures `/tmp/retire-date-focus.png`, `/tmp/retire-chart-tap-target.png`, and `/tmp/retire-chart-tap-selected-real.png`.
- Unresolved findings: Safari’s Develop/Responsive Design Mode UI is still disabled at the application level despite legacy preferences, so explicit Safari 320/375/390/430 checks and Web Inspector console inspection remain pending. The direct Simulator pass successfully tested the date picker but its window moved between commands and synthesized later taps could not be reliably targeted; direct chart tap/dismissal after the guard fix, numeric keyboard/focus zoom, external-keyboard chart navigation, table swiping, and developer-control taps remain manual Simulator/physical-device checks. No application defect is inferred from the remaining automation limitation.

### 8. Final regression suite and remaining physical-device checks

- [x] Run lint, unit, coverage, SARIF, and whitespace checks.
- [x] Update the release checklist only for checks actually performed.
- [x] List all remaining physical-iPhone acceptance checks.
- Status: implementation and automated regression complete; full mobile release readiness is not claimed.
- Key decisions: check only release items supported by completed evidence; retain every GUI-only and physical-device acceptance check as pending; preserve the original financial engine and storage keys unchanged.
- Files changed: `MOBILE_DESIGN_GUIDE.md`, `README.md` (pre-existing user change preserved), `index.html`, `styles.css`, `app.js`, `package.json`, `scripts/dev-server.js`, `tests/dev-server.test.js`, and `tests/page-structure.test.js`.
- Verification: `npm run lint` passes; `npm test` passes 59/59; `npm run test:coverage` passes 59/59 with 96.37% line, 84.11% branch, and 92.86% function coverage across executable CommonJS modules; `npm run lint:sarif` passes; `git diff --check` passes. Final Lighthouse results are recorded in phase 7.
- Simulator devices used: iPhone 16e, iPhone 17 Pro, and iPhone 17 Pro Max on iOS 26.3.1 (phase 7).
- Screenshots: see the nine retained `/tmp` paths in phase 7.
- Unresolved findings: complete Safari Responsive Design Mode/Web Inspector checks; on a physical iPhone verify touch accuracy and chart/table gestures, VoiceOver gestures and announcements, real-device performance, native and external keyboards, input focus/zoom, full Larger Text and 200% zoom flows, developer controls, Safari toolbar/chrome expansion and collapse, Home-indicator clearance, rotation redraw throughout the document, and runtime-console cleanliness. These are required before declaring mobile release readiness.

## Design ambitions

- Preserve all modelling functionality from 320 CSS pixels upward without page-level horizontal scrolling or loss of information.
- Support portrait and landscape layouts without requiring users to rotate their device.
- Design for touch first while retaining keyboard, pointer, and assistive-technology support.
- Keep financial inputs, results, warnings, and assumptions readable when users enlarge text or zoom the page.
- Avoid controls and information that depend exclusively on hover, precise pointer movement, or desktop viewport dimensions.
- Keep the interface dependency-free and built with semantic HTML, responsive CSS, Canvas, and vanilla JavaScript.

## Authoritative resources

Use these resources when evaluating or changing the mobile interface:

- [Apple Human Interface Guidelines: Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility/) for control sizing, spacing, legibility, VoiceOver, and alternatives to gestures.
- [Safari Responsive Design Mode](https://developer.apple.com/documentation/safari-developer-tools/responsive-design-mode) for checking viewport sizes, orientation, and pixel ratios, and for opening iOS Simulator.
- [Inspecting iOS and iPadOS](https://developer.apple.com/documentation/safari-developer-tools/inspecting-ios) for debugging Safari on simulators and physical devices with Web Inspector.
- [WebKit: Designing Websites for iPhone X](https://webkit.org/blog/7929/designing-websites-for-iphone-x/) for `viewport-fit` and safe-area inset guidance that also applies to newer notched and Dynamic Island devices.
- [WebKit: New viewport units in Safari](https://webkit.org/blog/12445/new-webkit-features-in-safari-15-4/) for `svh`, `lvh`, and `dvh` behaviour around changing browser chrome.
- [WCAG 2.2](https://www.w3.org/TR/WCAG22/) for reflow, orientation, text resizing, target sizing, input modalities, focus visibility, and hover/focus content.
- [MDN: CSS environment variables](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Environment_variables/Using) for `env(safe-area-inset-*)` and related browser-provided layout values.
- [Lighthouse](https://developer.chrome.com/docs/lighthouse/) for repeatable mobile performance, accessibility, and best-practice audits. Lighthouse complements, but does not replace, Safari and real-device testing.

## Local iOS Simulator setup

The development Mac runs macOS Sequoia 15.7.7 on Apple Silicon. **Xcode 26.3** (build 17C529) is installed at `/Applications/Xcode.app`, and `/Applications/Xcode.app/Contents/Developer` is the selected developer directory. The iOS 26.3 runtime and iPhone 16e/17/17 Pro/17 Pro Max simulators are installed; their command-line availability is rechecked in the implementation record before Simulator verification.

As of 12 August 2026, this Xcode installation supplies the project’s local Simulator toolchain. Recheck [Apple's Xcode system requirements](https://developer.apple.com/xcode/system-requirements) before reinstalling or upgrading because these requirements change.

1. Sign in to Apple Developer Downloads with an Apple Account. A paid Developer Program membership is not required for local Simulator testing.
2. Download the final, non-beta Xcode 26 `.xip` archive.
3. Expand the archive, move `Xcode.app` to `/Applications`, and launch it once to complete first-run setup.
4. In **Xcode > Settings > Components**, install the latest iOS Simulator runtime supported by that Xcode version. Do not install watchOS, tvOS, or visionOS runtimes unless the project needs them.
5. Select the full Xcode developer directory and complete its command-line setup:

   ```sh
   sudo xcode-select --switch /Applications/Xcode.app/Contents/Developer
   sudo xcodebuild -runFirstLaunch
   ```

6. Confirm that Xcode, the iOS runtime, and simulated devices are available:

   ```sh
   xcodebuild -version
   xcrun simctl list runtimes
   xcrun simctl list devices available
   ```

Apple documents both the [web-development Simulator installation flow](https://developer.apple.com/documentation/safari-developer-tools/installing-xcode-and-simulators) and [optional Xcode component management](https://developer.apple.com/documentation/xcode/downloading-and-installing-additional-xcode-components).

### Running the web application in Simulator

Start the local JavaScript development server normally. For example:

```sh
npm run dev
```

Then boot or open an iPhone Simulator and send its Safari browser to the local server. Replace port `5173` if the development server uses another port:

```sh
open -a Simulator
xcrun simctl openurl booted http://localhost:5173
```

The Simulator normally shares the Mac's network stack, so `localhost` should reach the development server. If it does not, bind the server to `0.0.0.0` and use the Mac's LAN address. Never expose a development server to an untrusted network without reviewing the resulting access.

Codex can use the command-line Simulator tools to list or boot devices, open the application URL, and save screenshots for visual comparison. For example:

```sh
xcrun simctl io booted screenshot /tmp/retirement-modeller-ios.png
```

Opening Simulator is a graphical action and may require explicit approval when Codex performs it. A useful task request is:

> Start the development server, boot an available iPhone Simulator, open the application, capture screenshots at the required orientations, and fix responsive layout problems.

Use Safari Responsive Design Mode or automated browser viewport tests for the rapid layout loop. Use iOS Simulator to verify Mobile Safari/WebKit behaviour, native controls, safe areas, dynamic browser chrome, rotation, touch-oriented interactions, and the virtual keyboard. Complete release-critical checks on a physical iPhone because Simulator does not faithfully reproduce device performance, every touch interaction, or all browser and hardware behaviour.

## Interface requirements

### Layout and reflow

- At 320 CSS pixels, content must remain readable and functional in a single scrolling direction. Wide data tables may scroll within their own clearly indicated container because their two-dimensional structure is meaningful.
- Breakpoints must respond to available space rather than target a specific iPhone model.
- Portrait and landscape orientations must preserve the same information and actions.
- Fixed or sticky UI must not obscure focused controls, validation messages, or page content when Safari chrome or the virtual keyboard changes the visual viewport.
- Desktop guidance must not cover the interface or imply that a supported mobile viewport is unsuitable.

### Touch and controls

- Aim for Apple's preferred 44 by 44 point control size. Never make an essential action smaller than the WCAG 2.2 minimum target requirement.
- Leave enough space between adjacent actions to prevent accidental activation.
- Ensure the visible portion of any partly off-screen control still provides the complete intended touch target.
- Do not require dragging, hover, or a multi-finger gesture for essential functionality. Provide a simple tap or native-control alternative.
- Preserve clear focus styles for external keyboards and accessibility input devices.

### Forms and the virtual keyboard

- Keep form-control text at a comfortably readable size; test at 16 CSS pixels or greater to avoid unwanted Safari focus zoom.
- Retain appropriate native input types and `inputmode` values so iOS presents useful date and numeric keyboards.
- Test every field with the virtual keyboard open. The active field, its label, validation feedback, and relevant action must remain reachable.
- Do not disable page zoom with viewport settings such as `maximum-scale=1` or `user-scalable=no`.
- Validate date, decimal, empty optional, and invalid values using the same model rules as desktop.

### Safe areas and browser chrome

- If the site adopts `viewport-fit=cover`, apply `env(safe-area-inset-top)`, `-right`, `-bottom`, and `-left` to edge-aligned content and fixed controls.
- Keep the developer trigger and tools panel clear of notches, the Dynamic Island, rounded corners, and Safari controls in both orientations.
- Prefer normal document flow when full-viewport sizing is unnecessary. When viewport-height sizing is required, select `svh`, `lvh`, or `dvh` according to the desired response to expanding browser chrome and test it on iOS Safari.

### Typography and accessibility

- Support iOS Larger Text, browser text enlargement, and 200% page zoom without clipped, overlapping, or missing content.
- Avoid text that is too small to read comfortably on a phone, particularly table annotations, chart legends, help text, and status messages.
- Preserve semantic labels, headings, live regions, validation messages, and logical DOM order as layouts collapse.
- Test the complete form and results with VoiceOver, including the range input, details disclosure, status updates, warnings, tables, and developer controls.
- Do not use colour alone to distinguish plans, warnings, depletion states, or event types.
- Honour `prefers-reduced-motion` and avoid unnecessary movement during recalculation or panel changes.

### Chart and projection tables

- Provide chart details through a deliberate tap interaction on touch devices; `pointermove` alone is not sufficient.
- Keep equivalent values available outside the canvas through summary cards and projection tables so the chart is never the only source of information.
- Redraw the canvas at the correct device pixel ratio after viewport resize and orientation change without throwing errors or losing the current scenario values.
- Keep chart labels and tooltips within the visible viewport and safe area.
- Preserve table semantics. When horizontal scrolling is necessary, make the affordance apparent and keep scrolling confined to the table container.
- Ensure table headings, event labels, pot bars, and depletion notes remain understandable at enlarged text sizes.

### Performance and resilience

- Keep input updates responsive while scenarios, care-reserve guidance, tables, and the high-density canvas redraw.
- Test first load and interaction under Lighthouse's mobile CPU and network simulation, while treating measurements on a current physical iPhone as authoritative for Safari behaviour.
- Avoid adding large runtime dependencies solely for responsive layout or touch handling.

## Implemented safeguards

- Removed the fixed desktop-width warning and added a compact 320px layout with wrapping, stacked actions, and contained wide-table scrolling.
- Added `viewport-fit=cover`, safe-area-aware content gutters and developer controls, and a complete visible 44×44px portion of the 56px developer trigger.
- Set mobile form-control text to 16px, retained native input types and modes, preserved zoom/focus styles, and enlarged mobile annotations, labels, legends, help, event tags, and statuses.
- Added deliberate chart selection by primary tap, second-tap/outside/Escape/rerender dismissal, focused-canvas Left/Right/Home/End navigation, concise instructions, and live selected-year details.
- Centralised chart selection, rendering, and four-edge tooltip placement; preserved transient mouse hover; passed current values on resize redraw; shortened only visual event-marker labels on narrow canvases.
- Added mobile table swipe hints plus plan-specific, focusable, visibly focused horizontal scroll regions while preserving native table semantics.
- Added a dependency-free local server with tested GET/HEAD, MIME, 404, 405, and unsafe-path handling.
- Added source-structure checks for safe areas, mobile type/targets, chart interaction/redraw, and projection-table affordances.

## Release checklist

Before describing a mobile change as complete:

- [ ] The page works at 320, 375, 390, and 430 CSS pixels without page-level horizontal scrolling.
- [ ] The form, chart, summaries, tables, methodology, and developer controls work in portrait and landscape.
- [x] Essential controls provide comfortable touch targets and spacing.
- [ ] Focusing date and number inputs does not cause disruptive zoom or obscure the active field.
- [x] The chart supports tap interaction and its information remains available without the canvas.
- [x] Tables clearly indicate and support contained horizontal scrolling.
- [ ] Notches, the Dynamic Island, rounded corners, Safari chrome, and the Home indicator do not obscure content.
- [ ] Safari toolbar expansion, collapse, virtual-keyboard use, and orientation changes do not break layout or chart rendering.
- [ ] Larger Text, 200% page zoom, VoiceOver, reduced motion, and an external keyboard preserve all functionality.
- [ ] Safari Web Inspector shows no runtime errors during editing, scrolling, chart interaction, or rotation.
- [x] Lighthouse mobile accessibility, performance, and best-practice audits have been reviewed, with relevant failures addressed or recorded.
- [x] Existing lint, unit, coverage, and source-structure tests pass.

## Device and test matrix

Use the following minimum matrix for significant mobile changes:

| Environment | View or device | Required checks |
| --- | --- | --- |
| Safari Responsive Design Mode | 320px and current small, standard, and Pro Max viewport presets | Reflow, breakpoints, portrait, landscape, and pixel ratio |
| iOS Simulator | Current supported iOS on a standard iPhone and a Dynamic Island model | Native controls, keyboard, safe areas, Safari chrome, rotation, and canvas rendering |
| Physical iPhone | At least one current supported device | Touch accuracy, scrolling, keyboard behaviour, performance, VoiceOver, and text enlargement |
| Desktop browser tooling | Lighthouse mobile mode | Performance, accessibility, and best-practice baseline |

Responsive Design Mode is useful for rapid layout work, and Simulator reproduces iOS rendering more accurately. Neither replaces final testing on a physical iPhone, particularly for touch, the virtual keyboard, scrolling, browser chrome, performance, and assistive technologies.
