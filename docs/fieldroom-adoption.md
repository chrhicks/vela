# Fieldroom adoption

## Agreement and completion

Chris approved this work on 2026-09-30 after reviewing the Paper designs and the
first implementation plan. Fieldroom becomes Vela's native presentation in light
and dark. The previous appearance is preserved as a frozen visual reference,
not a second application to maintain. Existing presentation may be replaced;
there is no requirement for migration machinery or old layout compatibility.

Theme identity is configurable (planned `VITE_THEME=fieldroom`), separate from
the browser-local `system | light | dark` appearance preference. The shell reads
configuration instead of naming its active theme directly. Fieldroom is the
default. System follows the browser's preference; explicit overrides persist
only in this browser. Switching appearance must not reset operational or image
inspection state.

Completion means the real browser faithfully reproduces the approved Paper
designs: typography, wrapping, geometry, colors, imagery, hierarchy, controls,
and their relevant states. Importing shared components or matching tokens alone
does not establish completion. Chris accepts the final implemented experience
before merge. The agent performs intermediate slice acceptance autonomously.

## References and ownership

- [Paper app designs](https://app.paper.design/file/01M3SATFK7ZW5ZCBPFSWD6XS91/p-1-0)
- [Paper design system](https://app.paper.design/file/01M3SATFK7ZW5ZCBPFSWD6XS91/p-3-0)
- Frozen exports: `docs/visual-reference/fieldroom/`
- Previous appearance: `docs/visual-reference/vela-current/`
- Shared implementation: `packages/ui`; feature composition: `apps/web`.
- Device/orchestration state remains with its current server capability owners.
- Linear owns work status; this document records planned work, outcomes,
  deviations, and review evidence. Continuum records durable decisions only.

Source baseline: `15c2bbe19770ef55ed2d6aa830fb833a19216ae4`.
Implementation branch: `feat/fieldroom-native`.

## Slice gate

Before each slice starts, expand its plan below with concrete files, states,
dependencies, and checks. At completion record actual results against that plan.

1. Settle all implementation work and focused checks for the slice.
2. Commit the review target and obtain independent `vela-verifier` review from
   fresh context. Resolve findings to **OK** before the final visual pass.
3. Run the actual browser experience at reference dimensions and states. Compare
   to Paper with screenshots, side-by-side inspection, overlays, and measured
   DOM geometry. Record discrepancies rather than describing an approximate
   match as complete.
4. Correct discrepancies; repeat affected checks and independent review when
   the target changes. Complete a final browser pass on the reviewed result.
5. Record planned versus achieved scope, concrete evidence, and any unresolved
   gaps. Proceed only after the slice satisfies its gate.

A final pass covers all slices together. Keep layout/behavior regressions
distinct from Paper/browser text rasterization differences. Do not hide layout,
font, crop, or content errors behind a broad screenshot tolerance.

## 1. Freeze references and establish coverage

Status: reference baseline frozen; independent review pending.

### Plan

- Export every current page-03 screen and page-05 system board at 1x, preserving
  node identity, filename, measured dimensions, export date, and SHA-256 hashes.
- Preserve representative old production screens, the old resolved theme, and
  exact source revision before shared styles change.
- Map each Paper screen/state to the production feature and deterministic
  fixture scenario. Record state sheets as component/state references rather
  than pretending each collage is a full application route.
- Phone references include a 62px mock OS status bar. Keep the original export
  and record the crop; application comparisons use the remaining content.
  Never implement that status bar inside Vela.
- Pin matching local imagery and font assets. Add a Fieldroom Autofocus design
  reference before adopting that existing feature's presentation.

### Verification and exit

Check exported dimensions/hashes and visually inspect the legacy archive.
No production styling changes until the old appearance has been captured.

### Actual / deviations / evidence

The initial reference commit is `ed9de33`. Forty 1x Paper exports (24 app,
16 system) are recorded in the hash/dimension manifest. All forty files were
checked against the manifest. The coverage map assigns every app board to
named production-route fixture scenes and separates state sheets from routes.

Four previous-appearance screenshots, exact intercepted fixtures, both token
mappings, source hashes, and a guarded reproduction recipe are archived.
The focused capture run passed, and the captured desktop and phone output was
visually inspected. This is browser-fixture evidence, not device evidence.

Actual full-content heights are preserved: Frame and Prepare 989px, Equipment
921px, interrupted Tonight 965px. Phone application crops are 390 × 782 after
excluding the 62px mock OS strip. The local reference photographs have hashes
and a link to their existing license/credit record.

The missing Autofocus reference is being drawn as a separate supplement with
its own [before-work plan](visual-reference/fieldroom/autofocus-design.md).
It must be frozen before Autofocus adoption; it does not change the immutable
initial reference set or block unrelated shared foundation recipes.

Draft delivery PR: https://github.com/chrhicks/vela/pull/86. Independent review
and reference acceptance are still pending; no production styles have changed.

## 2. Shared Fieldroom foundations

Status: planned; waits for legacy capture.

### Plan

- Extend the existing theme resolver with exact per-mode semantic overrides,
  preserving its existing profile mechanism. Avoid a parallel theme adapter or
  generic plugin registry. Retain named legacy profiles for reference.
- Define Fieldroom's exact paired colors and concrete typography/geometry roles:
  Barlow body/controls, Space Grotesk headings/metrics, 46px text controls,
  44px icon targets, 4/6/8px control/surface/overlay corners, 2px focus ring with
  3px offset. Use the full Paper system for other measurements.
- Bundle licensed fonts locally; update owning font guidance.
- Update stable Button, Input, Select, Checkbox, Tabs, Panel, Dialog, and
  Navigation styling/structure where their existing recipes conflict.
- Add the small non-modal Appearance primitive through the workshop. Do not
  reuse modal Dialog semantics for an attached non-modal popover.
- Update theme validation, workshop profile selection, diagnostics, and
  documentation together. No migration engine for obsolete scratch artifacts.

The [foundations plan](fieldroom-foundations-plan.md) specifies exact recipes,
file ownership, integration order, tests, and browser acceptance before edits.
The later [application appearance plan](fieldroom-appearance-plan.md) keeps
configuration and browser persistence separate from the shared UI primitive.

### Verification and exit

Focused theme/primitive tests and builds; paired workshop renders; exact
computed role values; keyboard/focus behavior. Independent review and browser
comparison to DS.01–DS.16 before app composition work starts.

### Actual / deviations / evidence

Pending.

## 3. Tonight and Appearance vertical slice

Status: planned; waits for foundations.

### Plan

- Replace shell/navigation composition with Tonight, Explore the sky, and
  Photographs; preserve explicit rig selection and truthful connection state.
- Add validated theme configuration at application composition, with Fieldroom
  default and a clearly labeled legacy token reference option.
- Implement browser preference resolution, changes, persistence failure,
  initial rendering, root color-scheme, and browser chrome color.
- Compose the approved Tonight image, subject, capture, sky, and equipment
  regions from current capability state. Preserve command ownership, Stop,
  camera read retry, and server-owned capture lifetime.
- Use deterministic real-route fixtures matching Paper's sample scene; live
  data uses the same production composition. Never ship mock observing facts as
  operational state.
- Integrate the narrow run-context additions from step 4 where required for the
  complete Tonight scene; these are dependencies, not permission to fake fields.

### Verification and exit

1440px light/dark Tonight and Appearance, relevant responsive widths, System
changes and overrides, no route/image reset, capture uncertainty and interruption.
Use the slice gate; parent self-accepts this checkpoint before later screens.

### Actual / deviations / evidence

Pending.

## 4. Required capability additions

Status: planned; implemented alongside the slices that need them.

### Plan

- Carry selected target intent into a capture run. Keep intent distinct from a
  measured framing solution; do not create a durable observing-session engine.
- Expose true per-run saved count and collected integration duration. Existing
  `savedImageCount` describes the rig archive and must not be relabeled.
- Hold the inspected frame while new frames arrive; implement Show latest,
  native-scale loading, panning/enlargement, and exact-frame Keep feedback.
  Handle an expired unsaved frame honestly.
- Retain a framing-check exposure preview through a narrow bounded image
  capability, alongside existing WCS and check identity.
- Audit catalog facts used in Paper. Add facts available from the pinned
  catalog; represent unavailable facts explicitly instead of inventing them or
  adding runtime enrichment. Preserve existing retained-image validity.

The [capability plan](fieldroom-capture-capabilities-plan.md) records concrete
owners, identity/lifetime invariants, and focused transition tests before edits.

### Verification and exit

Tests for new state transitions, image/metadata identity, stale or expired image
handling, truthful counters, target intent, and bounded preview lifetime. Keep
existing command ambiguity, retry, and no-automatic-slew tests intact. Record
which visual slice consumes each addition.

### Actual / deviations / evidence

Pending.

## 5. Remaining application slices

Status: planned; each sub-slice gets its own detailed plan and gate before work.

| Slice | Production owners | Paper coverage |
| --- | --- | --- |
| Explore / framing / preparation | targets, discovery, framing, observation, imaging-camera | 03.1–03.3 plus empty/error/current-check states |
| Photographs / image detail | saved-images, image inspection | 03.4, 03.14, 03.17 |
| Equipment / rig setup | rig-detail, home, rig-discovery | 03.5, 03.8, 03.12–03.15 |
| Polar alignment / autofocus | alignment, autofocus | 03.6–03.7, phone Appearance, added Autofocus reference |

Each slice includes loading, empty, pending, unavailable, interrupted, error,
and confirmed states where reachable. Both palettes use the same geometry and
image pixels. Remove displaced presentation code as ownership moves; avoid a
growing layer of overrides. Preserve all existing operational capabilities.

### Actual / deviations / evidence

Pending.

## 6. Whole-application verification and handoff

Status: planned.

### Plan

- Extend existing production-route Playwright fixture patterns with named
  Fieldroom scenes: Paper node, route, viewport, fixed clock, theme, API state,
  image bytes, and opening interactions. Reject unmapped fixture requests.
- Use app viewports for whole-screen comparisons, not the workshop's padded
  specimen canvas. Wait for fonts and image decoding; make captures repeatable.
- Keep immutable Paper references. After visual acceptance, retain browser
  baselines for regression protection; do not overwrite references to bless a
  discrepancy.
- Inspect all adopted screens and shared states in both themes, plus responsive
  reflow, focus, keyboard, reduced motion, and real operational behavior.
- Compare this plan and every recorded deviation against the final result.
  Resolve omissions before inviting Chris.
- Obtain final independent **OK**, prepare the reachable app with review data
  and relevant devices, and give Chris concrete acceptance scenarios. Wait for
  his acceptance before merge.

### Actual / deviations / evidence

Pending.
