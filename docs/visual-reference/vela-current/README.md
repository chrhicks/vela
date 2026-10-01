# Vela Current — frozen visual reference

## Capture plan

Preserve the application appearance at source commit
`15c2bbe19770ef55ed2d6aa830fb833a19216ae4` before Fieldroom adoption.
This is a static archive, not a second application or supported theme runtime.

Planned captures use the existing production routes and Playwright fixture
pattern: desktop Capture, Equipment, and Observe hub at 1440 × 900; polar
alignment at 390 × 844. The adopted Vela Current dark theme is captured as it
exists today. No application styles, components, or device state are changed.

All API calls are intercepted, unlisted calls fail explicitly, and image bytes
come from the bundled simulator fixture. Time, browser, viewport, and theme
are recorded alongside source and asset hashes. Screenshots wait for fonts
and images. PNGs preserve the full rendered page, including content extending
below the stated viewport.

## Actual capture record

Completed on **2026-10-01 at 01:35 UTC** (September 30 in New York), before
Fieldroom styling began. All four planned scenes were captured and visually
inspected. The focused Playwright capture passed: no browser errors, unmapped
API requests, API writes, or horizontal overflow. Shared source hashes stayed
unchanged during capture, and each page's CSS tokens matched Vela Current.

| Scene | Browser viewport | Full-page PNG | Reference |
| --- | --- | --- | --- |
| Capture, exposing with retained image | 1440 × 900 | 1440 × 1270 | [Open Capture](capture-desktop.png) |
| Equipment, three connected devices | 1440 × 900 | 1440 × 1094 | [Open Equipment](equipment-desktop.png) |
| Observe hub, prepared rig | 1440 × 900 | 1440 × 1314 | [Open Observe](observe-desktop.png) |
| Phone polar adjustment, retained solve | 390 × 844 | 390 × 1233 | [Open Alignment](alignment-phone.png) |

These are the existing production components with synthetic fixture responses,
not hardware observations. The current application was dark-only; this archive
does not manufacture an old light-mode application. Both resolved token mappings
are retained in [theme.json](theme.json). No fake phone OS bar was added.

- [manifest.json](manifest.json): source commit, Chromium version, environment,
  source/font/image hashes, page dimensions, fixture sources, and checks.
- [fixtures.json](fixtures.json): exact HTTP response bodies used for the run.
- [assets/capture-star-field.png](assets/capture-star-field.png): unchanged
  bundled simulator image, retained locally with its SHA-256.
- [capture.e2e.ts](capture.e2e.ts): capture recipe, outside the active test suite.
  It follows the existing web Playwright fixture pattern and contains no
  production application code.

## Reproduce without maintaining an old runtime

Use a disposable checkout of the recorded source commit with its dependencies
installed, and copy this archive directory into it. The recipe requires that
commit and refuses modified application/UI source. From that checkout's root:

```sh
cp docs/visual-reference/vela-current/capture.e2e.ts apps/web/tests/legacy-archive.e2e.ts
pnpm --filter @vela/web exec playwright test legacy-archive.e2e.ts --reporter=line
rm apps/web/tests/legacy-archive.e2e.ts
```

The existing test config starts Vite on port 5175. Use an unused port/runtime
from this checkout; the config can reuse an existing server, so do not leave a
different checkout serving that port. The captured Chromium version is
`151.0.7922.34`, DPR 1, locale `en-US`, timezone `America/New_York`, with
reduced motion and a fixed browser clock. Fonts and decoded images are awaited
before capture. No standalone browser interaction or device service is needed.

Keep these PNGs immutable during Fieldroom development. Compare with new
screenshots separately; do not update this archive as a regression baseline.
Historical source is recoverable from Git, while this directory remains a
small static record rather than a second supported interface.
