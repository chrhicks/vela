# Fieldroom whole-application review

Fieldroom's native light/dark presentation and required supporting capabilities
are implemented. The agent has accepted each intermediate slice after independent
OK and source comparison. Chris's final browser acceptance is the remaining merge
gate for [PR #86](https://github.com/chrhicks/vela/pull/86).

## Accepted slices

| Slice | Owning acceptance evidence |
| --- | --- |
| Foundations, fonts, controls, overlays and Appearance | [Foundations](foundations/README.md) |
| Tonight, capture and Appearance integration | [Tonight](tonight/README.md) |
| Explore, framing and capture preparation | [Explore/preparation](explore-preparation/README.md) |
| Photographs and retained-image inspection | [Photographs](photographs/README.md) |
| Equipment, Home and rig setup | [Equipment/Home](equipment-home/README.md) |
| Polar alignment and Autofocus | [Alignment/Autofocus](alignment-autofocus/README.md) |
| Final shared-surface and state audit | [Final evidence](final/README.md) |

The [adoption plan](../../fieldroom-adoption.md) records planned versus actual
work and [reference coverage](../../visual-reference/fieldroom/coverage.md) maps
all source boards to actual fixtures and scripted interactions. The 44 frozen
Paper sources retain their original hashes and dimensions. The previous Vela
appearance remains a [frozen reference](../../visual-reference/vela-current/README.md),
not a maintained alternate interface.

## Interactive review

Run `pnpm exec tsx scripts/review-fieldroom.mts` and open
`http://127.0.0.1:5176/__review`. It renders actual application routes with isolated
review contracts and pinned imagery. Select another scene from that index to
switch workflows or reset state. Global navigation can request contracts outside
the selected scene and is deliberately not a cross-feature simulator.

Useful scenarios:

- `tonight-light` / `tonight-dark`: switch System/Light/Dark, inspect 100% pixels,
  enlarge/return, stop the simulated capture; `tonight-interrupted` preserves
  last-known context.
- `explore-light`, `framing-light`, `preparation-light`: browse targets, inspect
  the real Aladin survey/test-exposure distinction, and review capture inputs.
- `photographs-light`, `photographs-fallback`, `photographs-empty`: select saved
  frames, inspect native pixels and retained originals, and check the empty state.
- `equipment-connected`, `home-no-rigs`, `rig-discovery-review`: inspect devices,
  settings and onboarding; the review backend never connects to physical devices.
- `alignment-phone-adjusting`, `alignment-phone-read-interrupted`: compare current
  and retained measurements, image modes, enlargement and compact controls.
- `autofocus-ready`, `autofocus-running`, `autofocus-result`,
  `autofocus-restore-unconfirmed`: inspect setup, measured samples and distinct
  confirmed/uncertain outcomes.

These fixtures establish interface and contract behavior. Physical alignment
accuracy, exposure quality and actual focuser restoration are separate evidence.
Retained raster comparisons use project Chromium; native collaborative-browser
DOM checks and screenshot-tool limitations are recorded explicitly.
