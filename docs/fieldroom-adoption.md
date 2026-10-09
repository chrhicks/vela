# Fieldroom adoption

Completed: as of 2026-10-02, PR #86 has merged at `ac64685`, following independent
verification and Chris's application acceptance. Fieldroom is the application's
default theme. The dated slice and review checkpoints below preserve the delivery
history; their pending-review statements are not current blockers. Explore and
Frame delivery follow-ups also shipped in that PR; remaining usability work is
identified in the [workflow hierarchy review](visual-evidence/fieldroom/ux-hierarchy-review.md).

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

Status: accepted at `032c8b1` after independent OK and final browser comparison.

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
sample pointing in a different direction. Renewed independent reviews at `2d4395d`, `80d9dd7`, and `032c8b1` returned
**OK**. The final reviewed checkpoint passed 865 project tests and builds, 48
application browser checks, seven workshop checks and four Python tests. The
parent completed the final paired desktop/phone and interruption comparison,
including Appearance and unchanged fitted/native imagery. [Retained evidence](visual-evidence/fieldroom/tonight/README.md)
records source substitutions, exact bounds, and the native screenshot-tool
limitation. Tonight/Appearance is accepted; Explore/framing/preparation may begin.

## 4. Required capability additions

Status: implemented and accepted with the consuming Tonight and framing slices.

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
races. Framing exposure preview is implemented and passed its consuming slice’s independent and visual gate.
Nothing in this checkpoint adds durable capture sequences or run recovery.

## 5. Remaining application slices

Status: Explore/framing/preparation accepted at `8906518`; Photographs accepted at `99195ae`; Equipment/Home accepted at `a50c6bb`; alignment/autofocus accepted at `00b1564`.

| Slice | Production owners | Paper coverage |
| --- | --- | --- |
| Explore / framing / preparation | targets, discovery, framing, observation, imaging-camera | 03.1–03.3 plus empty/error/current-check states |
| Photographs / image detail | saved-images, image inspection | 03.4, 03.14, 03.17 |
| Equipment / rig setup | rig-detail, home, rig-discovery | 03.5, 03.8, 03.12–03.15 |
| Polar alignment / autofocus | alignment, autofocus | 03.6–03.7, phone Appearance, added Autofocus reference |

Concrete plans: [Explore, framing, preparation](fieldroom-explore-plan.md),
[Photographs](fieldroom-photographs-plan.md), and
[Equipment/Home/onboarding](fieldroom-equipment-plan.md). The [alignment/autofocus plan](fieldroom-alignment-plan.md) records the last
slice before its implementation begins.

Each slice includes loading, empty, pending, unavailable, interrupted, error,
and confirmed states where reachable. Both palettes use the same geometry and
image pixels. Remove displaced presentation code as ownership moves; avoid a
growing layer of overrides. Preserve all existing operational capabilities.

### Actual / deviations / evidence

Explore/framing/preparation passed independent **OK** at `8906518`, then the
parent completed the final paired comparison of all three routes at desktop
and compact widths. The owning plan and
[retained acceptance evidence](visual-evidence/fieldroom/explore-preparation/README.md)
record actual geometry, source substitutions and browser limitations. All 22
post-review route checks passed. Photographs then passed independent **OK** at
`99195ae` and the final parent comparison at three widths in both palettes,
including original-preview fallback. Its [retained evidence](visual-evidence/fieldroom/photographs/README.md)
records source geometry, fixture substitutions and browser limitations.
Equipment/Home/onboarding passed independent **OK** at `a50c6bb`, followed by
26 reference rendering checks, four supplemental interruption/Forget checks, and
parent comparison at 1440/900/390px in both palettes. Its
[retained evidence](visual-evidence/fieldroom/equipment-home/README.md) records
source substitutions, corrected read deadlines and the browser limitation.
Alignment/autofocus passed independent **OK** at `00b1564`, followed by 83
post-verdict browser cases and final parent comparison. Its
[retained evidence](visual-evidence/fieldroom/alignment-autofocus/README.md) includes
74 captures and 60 measured geometry records. All main route slices are accepted.

## 6. Whole-application verification and handoff

Status: implementation and agent visual acceptance complete at `cd404b8`; ready for Chris’s final browser acceptance before merge.

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

### Concrete final checks

After the last slice receives independent OK and visual acceptance, run the existing
real-route reference cases together: `tonight.e2e.ts`, `fieldroom-explore.e2e.ts`,
`preparation.e2e.ts`, `photographs.e2e.ts`, `fieldroom-equipment.e2e.ts` and
`rig-onboarding.e2e.ts`. Select their paired rendering cases; preserve the existing
functional verification rather than inventing another feature harness. Include
navigation, application theme and Appearance checks to cover shared composition.
The preparation slice contributes its reviewed alignment/autofocus matrix.

Inspect the resulting whole-route captures against frozen sources and the accepted
slice evidence, including both palettes and compact widths. Check all 44 frozen
source hashes/dimensions. Record final screenshots, checks, fixture substitutions
and any native-browser limitations in the owning evidence directories, with a
whole-application index linking them. Update the original planned-scene coverage
with the actual fixture/test mapping; names may differ, observable coverage may not.

Use the parent-owned persistent web runtime on 5175 for checks and the deterministic
review server on 5176 for the handoff. Open the actual Tonight scene in the shared
browser and confirm rendered state. Supply direct scene links for other workflows
because each review session intentionally serves only its selected contract fixture.
Keep this review server isolated from physical devices. The independent verdict,
post-review comparison and final clean commit must be recorded before inviting Chris.

### Actual / deviations / evidence

The first whole-route rendering pass passed 46 cases across Tonight, Explore,
framing, capture preparation, Photographs, Equipment, Home and onboarding. The
shared/preparation run passed 94 of 96 cases; the two failures were an older
theme test still selecting the removed device Panel. Updating it to assert the
current imaging-setup surface, device separator and section typography retained
its token/geometry intent; both cases passed.

A read-only coverage audit mapped the original planned scene names to actual
registry aliases and scripted browser sequences. It identified missing combined
evidence for archive loading, capture transition continuity, touch panning and
route-specific interaction states. Nine supplemental cases now pass: held
collection loading versus empty, first-image capture through readout/save/repeat
and confirmed stopping, selected disconnected camera, Home rest/hover/pressed,
reduced-motion dialog and enlargement behavior, persistent capture errors across
disclosure, and real Chromium touch input reaching both horizontal image clamps.
The [coverage map](visual-reference/fieldroom/coverage.md) records the actual
fixtures and owning tests. No production behavior defect was found by these cases.

The preparation comparison found and corrected a 4px Autofocus setup card-height
mismatch through the workshop. The final settled head is receiving renewed
independent review before the last visual acceptance and Chris's handoff.


Independent review returned **OK** at `00b1564`; preparation then passed its
post-verdict comparison and was accepted. The expanded final state captures
exposed a visual omission in Photographs loading/empty states relative to 03.9.
Its owning plan now records a bounded workshop-first correction; normal gallery
and fallback layout remain unchanged. Final acceptance waits for that correction
to receive independent review and the final comparison.

The Photographs state-card correction is implemented after parent workshop
approval. Its eight paired desktop/phone captures, selected-detail independence,
existing gallery behavior and supplemental final states pass (37 route cases),
with 21 workshop cases, scoped lint and web build. The preparation geometry
recipe now records document coordinates and scroll offsets for full-page captures;
all 30 light/dark pairs have equal positions, dimensions, fonts and gaps. Sixty
reference-rendering checks passed after that evidence-only correction. The final
code and evidence are ready for independent review.


Final independent review returned **OK**, no findings, at `cd404b8`: `pnpm check`
(921 tests/builds), 170 application browser checks, seven workshop checks and four
Python tests passed. The preceding workshop persistence note was resolved by
isolating foundation-test session/profile reads; 15 affected checks passed.

The post-verdict final pass passed 77 cases (46 reference renders and 31 shared/
state checks). The parent accepted all new Photographs collection cards against
03.9 and the approved workshop, then inspected the supplemental states and main
capture differences. Of 64 main captures, 51 are byte-identical to prior accepted
artifacts; the other 13 have only sparse edge rasterization differences of at most
2/255 per channel. No layout, wrapping, crop or content regressions were found.
The final manifest retains 88 capture records with hashes and explicit prior
artifact links; all 44 frozen source hashes/dimensions remain unchanged.

[The whole-application evidence index](visual-evidence/fieldroom/README.md) links
each slice, final comparisons, actual scene coverage, reproduction commands and
browser limitations. At this pre-acceptance checkpoint, the shared browser was
open to Tonight on the isolated
review runtime, with fonts, decoded image, expected state and no horizontal
overflow confirmed. Implementation was complete; Chris's browser acceptance was
the remaining merge gate, subsequently completed before PR #86 merged.
No physical-device outcome is claimed by these checks.

## Browser acceptance follow-up: camera identity and header order

Chris requested two adjustments on 2026-10-01 during live FRA 400 review:
correct Equipment's mistaken “Other camera” label and move Appearance to the
right of the rig selector so it no longer crowds connection status. This explicit
header preference supersedes the frozen source's original control order.

The live device check exposed different identity scopes: imaging selection keeps
the provider camera ID while rig-detail rows use a rig-scoped ID. The server now
projects `selectedDeviceId` only for a matching current camera identity, and
Equipment uses that association plus the reported name. It no longer compares
unrelated ID formats. Equipment fixtures now reflect the distinct scopes; a
server regression compares the association to the actual detail projection, and
a route regression checks primary-camera labeling/sorting and changed identity.
Saved configuration and capture selection are unchanged.

The shared navigation specimen was inspected at desktop and phone sizes before
adoption. A trailing actions slot places Appearance after the rig selector;
phone layout keeps selector and Appearance together below brand/status. Focused
phone preparation keeps return link, rig context and a single Appearance control.
Focused geometry and popover checks passed. Final independent verification and
live-page confirmation are recorded with the follow-up delivery.
