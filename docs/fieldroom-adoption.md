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

Status: initial reference checkpoint accepted.

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

The missing Autofocus reference was drawn as a separate supplement with
its own [before-work plan](visual-reference/fieldroom/autofocus-design.md).
Its four PNGs and design values have a separate manifest; it does not change
the immutable initial reference set. Parent visual inspection corrected a
start-position graph label before the supplement was frozen. Its production
behavior will be independently verified with the Autofocus slice.

Draft delivery PR: https://github.com/chrhicks/vela/pull/86. Fresh independent
review of `5257da9` returned **OK** after correcting the archive recipe's typing
and spacing. `pnpm lint` passed. The final reference pass confirmed frozen
dimensions, hashes, legacy desktop/phone output, and the corrected supplement.
This accepts reference preparation only; application adoption is recorded below.

## 2. Shared Fieldroom foundations

Status: accepted at `c7c5712` after independent OK and final browser comparison.

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

Implemented in the shared resolver and stable primitives. The settled review
and final comparison below accepted this foundation.

Fieldroom adds explicit semantic overrides within the existing profile resolver,
including pending, hover, pressed, warning, and error colors. The workshop uses
Fieldroom/light by default and exposes overridden colors honestly in its editor
and contrast diagnostics. Locally bundled Barlow and Space Grotesk include license
and pinned-source provenance. Existing named profiles remain token references.

Stable controls now use the planned geometry and typography. The old Button,
IconButton, and Tabs size options were removed because they conflict with the
single approved recipe; consumers were updated mechanically. This includes web
call sites but does not adopt the application layouts ahead of Phase 3. Pending
buttons retain focus and suppress duplicate activation. Field messages are linked
for assistive technology, tabs support keyboard navigation, and Dialog can enter
Cancel first while retaining containment and focus restoration.

The controlled Appearance primitive handles non-modal keyboard/outside dismissal,
compact placement, and radio selection. Browser persistence and System resolution
remain Phase 3 responsibilities. Its workshop specimen uses the workshop palette
controls; changing a specimen radio demonstrates selection without taking over the
workshop’s independently scoped theme.

Focused checks: 17 theme runtime tests, 5 package export-boundary tests, and 2
contrast-diagnostics tests passed together. Eight Dialog/navigation/foundation
browser checks and five Appearance browser checks passed in Chromium. UI,
workshop, and web builds passed during integration; final settled lint and any
changed checks are recorded with review evidence below.

Preliminary measurements confirmed text controls 46px, icon/tab targets 44px,
checkbox label targets at least 44px, and the loaded font families and weights.
Dialog measured 640px wide with 28px inset, 18px groups, 8px radius, and the paired
raised surface. These are integration observations, not slice acceptance. Final
review target, comparison artifacts, and verdict remain pending.

A source/browser inset audit retained the declared Dialog 28px, button 18px,
and field 14px padding with true 1px CSS borders. Frozen-reference and browser
first-ink offsets agree: dialog title 31px/body 30px, primary action 20px,
input value 16px. Paper’s fractional border quantization does not justify
subtracting a pixel from each component’s declared padding.

The first foundation target, `1818874`, received independent **OK** with no
findings. The verifier ran 24 focused tests, 50 workshop browser tests, two web
theme tests, lint and all three affected builds; checked 44 reference hashes and
dimensions; and left the checkout clean. The required parent visual pass then
found differences that code/behavior checks did not establish:

- The first bundled Barlow release was 1.422, while Paper used Google Fonts’
  1.408. “Start capture” shaped to 85.005px versus 87.48px at 15px/500.
  The assets now pin the matching licensed version; no tracking compensation
  was added. Space Grotesk 2.000 matches both version and sampled advances.
- Navigation still retained the old wordmark casing, 36px brand gap and a quiet
  rig selector. These now match lowercase `vela`, 56px brand gap, 24px links,
  Appearance/context before the rig selector with 20px gaps, and the 46px field
  recipe. Routes and observed connection state remain caller-owned.
- The capture-card specimen now demonstrates the actual four-group source
  anatomy, active fill, 20/22px insets, borderless surface, and exact progress
  track colors (`#B7C2A7` / `#4A5847`). The earlier generic example was insufficient
  evidence for that source exception.
- The source Forget confirmation has Cancel and Forget without an extra close
  icon. Dialog now allows that concrete presentation while preserving its
  default close control elsewhere. Cancel-first and focus wrapping still pass.

The corrected target awaits renewed independent review and final comparison.
Affected reruns passed: 24 focused unit tests, six Dialog/foundation browser
tests, two navigation browser tests, lint, and UI/web builds. These corrections
are why intermediate slice acceptance includes actual browser comparison after
an independent code/behavior verdict.

The corrected target `c7c5712` received renewed independent **OK**. The parent’s
final native-browser pass then accepted the paired recipes, typography, control
and overlay bounds, navigation structure, pending/focus behavior, and non-modal
Appearance interaction. [Retained evidence and exact measurements](visual-evidence/fieldroom/foundations/README.md)
record scope, screenshot hashes, device-scale rounding, and the remaining
application-owned checks. Phase 2 is accepted; Phase 3 may begin.

## 3. Tonight and Appearance vertical slice

Status: implemented; independent review corrections in progress.

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

Implemented against the [expanded Tonight plan](fieldroom-tonight-plan.md).
Application configuration and Appearance, shared rig observation, subject/run
facts, image inspection, sampled sky and footer are in place. The plan's actual
outcome records files, operational boundaries, narrow additional controls, and
preliminary geometry. Review scenes use the real route on the development-only
HTTP fixture server. The first independent review at `a4905c0` returned BLOCK:
the equipment footer could select a guide camera from inventory order, and the
current sky direction could use a future night sample. The footer now consumes
the capture projection's selected-camera cooling, including its own stale state.
The sky boundary projects azimuth at `observedAt` alongside current altitude;
night samples remain for the trace. Regression coverage includes a warmer guide
camera first in inventory, unavailable selected-camera cooling, and a future
sample pointing in a different direction. Renewed independent review and final
visual acceptance are pending.

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

Subject snapshots, per-run saved/integration totals, held/native image inspection,
exact-image Keep/retry/expiry, and catalog constellations were implemented with
Tonight. Focused checks cover the new contracts and deferred acquisition/save
races. Framing exposure preview remains scheduled with its consuming slice.
Nothing in this checkpoint adds durable capture sequences or run recovery.

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
