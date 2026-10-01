# Fieldroom polar alignment and autofocus adoption

Implementation preparation began after Equipment/Home passed independent OK at `a50c6bb` and final visual acceptance in `b51a1eb`. The plan was refreshed against current route owners, frozen references and prior decisions on 2026-10-01. Governing scope and slice gate: `docs/fieldroom-adoption.md`. Parent accepts intermediate slices; Chris retains final application acceptance.

## Scope and ordering

Adopt two existing operational capabilities into Fieldroom. Preserve URLs `/rigs/:rigId/observe/alignment` and `/rigs/:rigId/observe/autofocus`, direct loading, rig changes and server-owned lifetime. Complete alignment and autofocus as separate bounded implementation units with one shared preparation-header composition. Do not introduce a new orchestration abstraction, durable run, recovery engine or server capability merely to reproduce Paper.

1. Add the compact preparation header to existing navigation composition, using the already implemented Appearance provider/primitive. Back means Tonight (`observe/capture`), not the old Observe landing page.
2. Recompose alignment presentation, retaining current polling, command and loaded-image pairing behavior. Settle its phone/inspection details before moving on.
3. Recompose autofocus setup and walking/outcome presentation; preserve its hook/window validation and dynamic data geometry.
4. Add deterministic real-route scenes and regression checks. Commit, independent verifier OK, then native-browser comparison and corrected-target re-verification as required by the slice gate.

## Reference measurements

Paper file `01M3SATFK7ZW5ZCBPFSWD6XS91`, page `p-1-0`. Frozen references and hashes remain unchanged. JSX was read with Executor, not copied into app as hardcoded content.

| Reference | Node | Comparison |
| --- | --- | --- |
| 03.6 adjusting | UZ-0 | `app/03-6.png`, 390×782 application crop |
| 03.7 measurement reads interrupted | WX-0 | `app/03-7.png`, same crop |
| 03.21 phone Appearance light | 3N6-0 | `app/03-21.png`, same crop |
| 03.22 phone Appearance dark | 3OS-0 | `app/03-22.png`, same crop |
| 03.23 autofocus setup | 48X-0 | `app/03-23.png`, 1440×900 |
| 03.24 autofocus walking | 48Y-0 | `app/03-24.png`, 1440×900 |
| 03.25 autofocus phone walking | 48Z-0 | `app/03-25.png`, 390×782 application crop |
| 03.26 autofocus outcomes | 490-0 | `app/03-26.png`, 1440×1100 state sheet; inspect cards in real route |

All phones exclude the frozen 62px OS strip. App viewport starts at the 48px compact navigation row. Both palettes use identical geometry and image pixels.

### Alignment phone

- Compact header: 48px high, 20px horizontal inset, 44px Back and Appearance targets. Latest appearance boards add the Appearance trigger, with rig label right-aligned and 12px before the trigger; apply that header to normal alignment too (03.6 predates the trigger).
- Main: 20px horizontal/12px vertical padding, 12px vertical groups, title Space Grotesk 28/36. At 390px content width is 350px.
- Status surface: 350×72, radius 6, 14px horizontal/12px vertical inset, 8px line gap. 15/20 medium status and 14/20 helper. Active uses active surface; interruption warning surface/copy.
- Error summary: two 14/20 labels with 6px gap opposite 46/56 Space Grotesk error, tracking -2px. Reference total 38″; timestamp 21:02:14. Active age 2 seconds; interrupted age 45 seconds. Freeze each scene's clock accordingly.
- Solved preview container 350×196, radius 6. Caption outside image 14/20; legend in one row, 14/20. Buttons after image/legend, gap 8: Fit both width 110; Fine width 98; Full frame consumes remaining 126; all 46px high.
- Corrections: two 165px groups separated by 20px, 4px top inset, labels 14/20, 8px gap to correction 16/24 medium. Fixture azimuth -23 arcsec and altitude -30 arcsec give existing right/up conventions. Total can be hypot rounded 38; never infer signs from the pictured reticle direction.
- Advice 16/24. Final controls: 12px gap, Stop 132px, Finish flex (206px), height 46. Interrupted source replaces this with full-width Stop session and past-tense corrections. Stop stays visible at 390×782; normal layout scrolling must remain usable on shorter devices and with longer real errors. Do not copy Paper's overflow clipping into a page that can contain longer facts.
- Appearance popover: x20,width350, app y48 (Paper top110 minus OS62), 20px padding, radius8, gap16, 44px title/close row; System64px, Light/Dark46px. Existing compact Appearance anchor gap2 produces this placement from header trigger. Opening/changing/closing must leave measurement, inspection and command state intact.

### Autofocus desktop

- Existing app navigation height88. Main padding 28px vertical/36px horizontal; 24px group gap. Header44 high; Back→title gap28; title28/36; rig/preparation context14/20 at right.
- Main two-column grid 888px / 28px gap / 452px, starting x36/y184 at 1440×900. Left panel540 high, radius6, 1px surface border, padding24, gap20. Right column540 high with20px groups. Use natural min-height when content requires extra room, not text clipping.
- Setup left heading24/30 plus body16/24, 838×210 planned-window illustration, three facts and limit explanation. Current/start32842; offsets4; step50; window32642–33042; nine planned samples; exposure2; MaxStep60000. Right: readiness, camera/focuser/MaxStep facts, Step size, Start autofocus and restoration explanation. Exposure is a supplied fact, not an added input.
- Walking left heading24/30, helper14/20, SVG838×280, legend14/20 with28px gaps, bottom notice after16px top inset and divider. Plot source coordinates x64..814, y32..224, y tick0/2/4/6, x tick32642/32842/33042 at115.724/439/762.276. This matches 8% horizontal domain padding. Source y axis max6 (existing code uses6×1.12 and needs presentation adaptation). Preserve dynamic expansion above6 for real samples; no clipping of unusually large HFR.
- Walking marks: sample r5, latest r6, minimum outer r10. Source measured pairs: (33042,5.1), (32992,4.4), (32942,3.65), (32892,2.95), (32842,2.45). Start dashed line x439 labeled **Start 32,842**; current position **32,792** belongs to the activity panel. No fit at this point. Never replace the source's corrected Start annotation with “now” over an unrelated sample.
- Right active surface: padding24,gap12,radius6. Status15/20 + count14/20; activity16/24; position46/56,-2px tracking; exposure/helper14/20; full-width46px Stop and restore start. Below: fact rows padding12px vertical with1px dividers, then last-sample time and pending-restoration explanation.
- Bottom row24px below panels: window facts14/20. Omit “Design study · Fixed sample values” from live app; fixture label belongs to the review harness. Record this intentional reference-text substitution.

### Autofocus phone

- Same compact48px header and main20px/12px insets, 12px groups, title28/36.
- Active summary padding14,gap6. Status/count row15/20 and14/20; activity16/24 medium; duration14/20. No giant position metric on phone.
- Chart surface350px wide,1px border,radius6,padding14,gap8. Native diagram320×146 with readable14px labels; don't merely scale down the desktop SVG text. Includes top HFR label and bottom no-fit caption outside plot. Source phone y ticks0/3/6.
- Three compact facts: start, latest sample, last sample time. Restore explanation after top divider/padding12. Full-width46px Stop is below and entirely visible (source app bottom roughly674px, leaving comfortable spare height).

## Existing invariants and capabilities

`packages/model/src/web/alignment.ts` already supplies mode/camera, phase/activity, active, position/solved count, exposure start/duration, timestamped solved measurement and separate latest baseline preview. `autofocus.ts` already supplies the full walk, samples, fitted hyperbola, current/start/MaxStep, capture-read state and restoration confirmation. **No missing model/server capability was found for these references.** Changes should remain presentation and deterministic fixtures unless a real integration defect is demonstrated.

Alignment contracts:

- Polling and commands currently live in `routes/alignment.tsx` (`useAlignment`, schema validation, generation guards, 750ms poll). Keep pending serialization, malformed-state rejection, no blind command replay and read-after-uncertain-write behavior.
- `useSolvedMeasurement` publishes a measurement only after its exact image loads; previous pixels, projected marker coordinates and exposure timestamp remain together on failed GET. Never render current numeric correction on an older loaded image.
- Server baseline survives transient read failure. Retry is paced/cancellable, no preparation or motion replay. Same acknowledged exposure stays pending; recovered reads alone are not a new measurement. No-solution may take another exposure; ambiguous physical writes and failed cleanup stop.
- Acquired baseline preview can precede solve. No WCS/reticle/angular scale on an unsolved preview. Baseline progress may update while enlargement remains pinned to an earlier exposure.
- Fit both retains4′ context floor, Fine1′, full-frame/native modes, approximate camera-field angular scale, outside-image blank area, image retry with no acquisition and same-exposure enlarged inspection. Existing dialog stays mounted across baseline→adjusting; dismissal restores focus to the current opener.
- Finish is the operator ending alignment, not a measured accuracy threshold or automatic success. Stop waits for cleanup; preparation and physical caveats remain available before Start. Do not add a green accuracy assertion for38″.

Autofocus contracts:

- `use-autofocus.ts` owns polling/commands, uncertainty resolution and response validation. Samples advance only on actual completed measurements; the browser never advances focuser or synthesizes a curve.
- `previewAutofocusWindow` owns setup preview validity. Start preserves selected inspected focuser, rejects a window touching0/MaxStep, and has no backlash/home behavior. Preview uses current position in setup; active window uses session start.
- `captureReadState=retrying` pauses live position annotation/spinner while preserving samples/timestamps/current position. Offline and unknown command outcome take precedence. Stop is available during read retry while server reachable; unavailable while disconnected.
- Stop includes confirmation-exposure cancellation and requests camera cleanup then restoration. `restoredStart` alone certifies confirmed return. Failure/unknown restoration is never “Restored,” and a successful return does not conceal camera cleanup failure. A fresh terminal projection may resolve uncertain Stop; active polling alone must not clear it. No replay.
- Complete shows server fit position distinct from lowest measured sample; Focus again opens setup without starting. Stopped offers Back to setup; failed restore retains samples and truthful failure.

## Deliberate reference reconciliation before edits

1. **Polar drawing versus measured geometry.** Paper places optical center at(142,130) and target at(193,84) in350×196; these illustrative positions do not match current midpoint-centered Fit-both geometry and4′ floor for23″/30″. Preserve real WCS coordinates and existing inspection mathematics. Match container/copy/reticle style; use a declared API image fixture and record the marker/crop difference. Never bake source SVG coordinates into production or falsify angular scale to force exact overlap. If parent wants stronger visual alignment, design a truthful revised specimen before changing viewport semantics.
2. **Reticle identity.** Existing `AlignmentImage` draws crosshair at target, while source explicitly says crosshair optical center/ring correction target. Change glyph styling so crosshair is anchored at calculated optical center and ring at server target. Keep colors constant over imagery in both themes (source #F1EEE5 reference and #E2D59B target). Tests assert coordinate identity, not just presence.
3. **Inspection controls omitted from phone sketch.** Source has three modes but production additionally supports100%, enlargement and provenance. Preserve these in a compact secondary inspection disclosure/dialog reachable from the preview; first row matches three source controls. Keep accessible Enlarge image activation, preserve existing pinned dialog lifecycle, and include provenance/approximate scale in inspection detail rather than silently dropping them. Validate this composition in workshop before adoption because source omits it. It must not push Stop below the reference viewport.
4. **No desktop alignment Paper board.** Apply established two-column Fieldroom composition to existing baseline/desktop workflow and inspect in workshop at desktop/intermediate widths. Claim full screenshot parity only for frozen phone scenes; desktop is a documented design extension, not an invented reference match.
5. **No autofocus focus photo.** Capability is curve/measurements only. No need for retained image/camera capability additions. Source chart is dynamic SVG derived from samples/fit; do not use a PNG graph or draw a hypothetical fit.

## File ownership

- `apps/web/src/routes/alignment.tsx`, `alignment.css`: workflow composition, compact states, loaded measurement pairing, honest status and control placement. Extract hook to `features/alignment/use-alignment.ts` only if it materially simplifies the route; extraction not required for appearance.
- `apps/web/src/features/alignment/AlignmentImage.tsx`: reticle styling, inspection presentation and preserved enlargement lifecycle. `image-viewport.ts` remains geometry owner; no unrelated algorithm rewrite.
- `apps/web/src/routes/autofocus.tsx`, `autofocus.css`: setup/walking/outcomes and responsive composition. `features/autofocus/AutofocusCurve.tsx`: responsive chart anatomy and truthful dynamic axes. Existing hook/window/validation are behavioral owners.
- `apps/web/src/features/navigation/AppNavigation.tsx` (and its owning styles): explicit alignment/autofocus compact header, current Tonight parent navigation, existing Appearance instance. Avoid mounting two visible navigation/Appearance controls or copying persistence logic. Preserve global capture-status access if another rig is capturing.
- `packages/ui/src/components/Panel.polar-alignment.specimen.*`, `Panel.polar-alignment-inspection.tsx`, `Panel.autofocus.specimen.*`: workshop treatments for source gaps and matching recipes. Feature orchestration stays out of UI.
- New `apps/web/tests/fixtures/fieldroom/alignment.ts` and `autofocus.ts`; extend `scripts/review-fieldroom.mts` scene registry and fixture README. Reject unmapped requests; never send review commands to hardware. Model/server contracts/controllers should not need edits.
- Owning alignment/autofocus READMEs and `docs/fieldroom-adoption.md`: actual evidence, deviations and slice status after completion. Add evidence under `docs/visual-evidence/fieldroom/alignment-autofocus/` consistent with prior slices.

## Deterministic states

Reuse coverage names exactly: `alignment-phone-adjusting`, `alignment-phone-read-interrupted`, `appearance-phone-light`, `appearance-phone-dark`; `autofocus-ready`, `autofocus-running`, `autofocus-phone-running`, `autofocus-interrupted`, `autofocus-result`, `autofocus-restored`, `autofocus-invalid-window`, `autofocus-restore-unconfirmed`, `autofocus-offline`.

Additional transition scenes: alignment setup/unavailable/loading, three-position baseline (homing/moving/exposing/solving), baseline no-solution preview, browser-offline retained solve, next-image GET failure, stop-pending/unknown/confirmed, finish-confirmed, restart-new-baseline, enlarged-baseline→adjusting; autofocus moving/measuring/fitting/confirming, no measurable stars, Stop pending/restoring/unknown and eventual terminal resolution. These are fixtures on the same routes, not extra app pages.

Autofocus fixture values derive from `autofocus-reference-fixtures.json` but must be full valid `AutofocusView`: add deterministic timestamps/detectedStars/fit parameters and rig identity rather than passing design JSON directly. Result fitted32788 versus lowest sampled32792; stopped32842; invalid current150/window−50..350 means no command. Alignment fixture image must identify itself as review data and carry real dimensions, projected coordinates and timestamp provenance. Clock/timezone fixed per scene; image hash pinned. Do not relabel a survey/starfield stock asset as hardware evidence.

## Focused checks and acceptance evidence

- Re-run existing `apps/web/tests/alignment.e2e.ts`, `alignment-inspection.e2e.ts`, `autofocus.e2e.ts`. Preserve physical-preparation/provenance, unsolved preview recovery without capture, enlarged image identity across baseline completion, current-position setup/limit rejection, sample growth, failed restoration and Focus-again semantics. Update selectors only to equivalent accessible controls.
- Focused Vitest: `apps/web/src/features/alignment/image-viewport.test.ts`, autofocus `window.test.ts`, `validation.test.ts`, `use-autofocus.test.ts`. Add meaningful assertions for new responsive chart geometry/label identity if extracted; no snapshot test duplicating JSX.
- Add route-level retry/offline/uncertain tests with scripted POST counts and old-vs-new timestamps; verify theme switching does not trigger POST, reset mode/held image/window/step value, remount dialog or change pixels. Verify age advances from capture time, not GET/solve completion.
- Browser visual matrix:1440×900,390×782, intermediate768px and a short phone. Both appearances, keyboard/focus return, reduced motion, readable graph labels and full Stop visibility. Compare frozen reference after fonts decode; retain screenshots and measured regions, including popover x/y/w, card boundaries, controls, typography, source-aware image/reticle exception and omitted design-study footer.
- Web build and lint for affected source; UI/workshop build/browser tests only if their primitives/specimens change. Presentation-only adoption does not require rerunning physical trials or all server math. If a controller/contract is changed to fix a demonstrated issue, run its focused controller/routes tests and document the widened scope before claiming behavior.
- Independent fresh-context verifier sees committed target/PR only; prepare clean runnable checkout and deterministic fixture server. After OK, parent compares actual app to Paper, resolves discrepancies, re-verifies changed evidence and records accepted scope. Fixture evidence does not establish outdoor alignment accuracy or a physical EAF restoration.

## Planned versus actual

Production adoption is in progress after the workshop comparison described below. Record final checks, committed verifier target and post-verification visual evidence before accepting this slice. No hardware operations are required by this presentation adoption.


### Execution refresh before adoption

Existing source confirms no new model/server capability is needed. First settle
Fieldroom workshop compositions for both workflows, including the missing desktop
alignment design and secondary inspection access. Parent compares actual specimen
renders before either production route is adopted. Deterministic scene preparation
may run independently. Root owns shared navigation and integration; workshop and
fixture work have separate owners. Both production routes remain separate bounded
units within this final adoption slice.

Compact preparation uses the existing single Appearance state and a 48px header
with Tonight and current rig name. Desktop retains the main navigation; capture
activity on another rig stays reachable. Do not create a second theme store or
reset session/inspection state when opening Appearance or crossing a breakpoint.
Interrupted alignment must give past-tense corrections and pause guidance for both
camera-read retries and browser disconnect, preserving the exact loaded solve.
The optional estimated-exposure provenance remains in inspection details, rather
than lengthening the compact primary error summary. No new device writes are
authorized by these presentation changes.

### Demonstrated autofocus command correction

Before visual adoption, a focused browser regression reproduced an existing
uncertainty gap: a lost Stop response followed by at least two valid still-active
reads leaves the unknown-outcome notice visible but enables Stop again. The
no-replay rule requires more than preventing automatic repetition. Reuse the
hook’s existing `stopUnconfirmed` flag to block both command entry and route
controls until its existing validated terminal-read branch resolves the outcome.
Keep lost Start separate so an observed active run can still be stopped. Add a
hook-level direct-call regression as well as the real-route proof. This is a
narrow preservation fix, not a new recovery API or orchestration subsystem.

The same regression was demonstrated on Alignment baseline Stop: after a lost
response and multiple still-active reads, Stop measurement remained enabled.
Alignment now retains a narrow end-command uncertainty guard for Stop/Finish,
blocks command entry and controls, and clears it only on a validated inactive
stopped/finished/failed projection. The baseline regression changed from failing
to passing with exactly one POST and a later enabled Start again. No read or
physical-command replay was added.


### Workshop preparation implemented

The alignment and autofocus specimens now use Fieldroom compositions. Compact
alignment has a measured 48px header, a 350×196px image starting at y=260 in a
390px specimen, and the adjustment Stop action within y=782. Baseline Stop sits
above the image so preparation remains operable on a phone. Desktop alignment is
a deliberate extension of the compact arrangement with secondary inspection in
a keyboard-dismissable enlarged sheet. Inspection retains fit, fine, full and
native views; its illustrative fit retains the existing 4′ minimum field.
Reference and target markers preserve CSS-pixel size when the drawing scales.
The enlarge affordance retains a 44px interaction target. These are documented
interpretations of the source, rather than new alignment mathematics.

Autofocus desktop keeps the source chart panel at x=36/y=184 and 888×540px within
a 1440px specimen. The compact chart is 320×146px with Stop within y=782. Setup
shows the step unit inside the input and travel facts beneath the divider.
Complete, restored and restore-unconfirmed sheets distinguish selected position,
measured best sample and physical restoration outcome; the unknown restoration
sheet has a danger treatment and does not imply a repeated move. The interactive
workshop walk retains only completed samples when stopped. Travel-limit examples
use position 150 and a default −50..350 window, making the blocked state agree
with the illustrated mechanical limits.

Focused workshop checks cover light/dark phone image geometry, desktop autofocus
geometry, Appearance and inspection dismissal, native image access, baseline
preparation at 390/768/1440px, missing-solve marker suppression, setup limits,
terminal wording and stopping an interactive walk. These are deterministic
workshop observations; they do not establish production integration or hardware
outcomes. Settled captures are copied outside Playwright's replaceable results
folder for parent visual comparison before route adoption. Production runtime,
independent verdict and final browser acceptance remain separate delivery steps.

### Production adoption checkpoint

The root applied the approved Alignment composition and single compact preparation
navigation. The image component preserves projected geometry and pins enlargement
across baseline completion. Device/browser interruption uses past-tense corrections;
confirmed stopping and unconfirmed Stop/Finish disable end commands until a terminal
observation. Failed next-image GET keeps prior pixels, reticle, error and timestamp
paired. Regression fixtures cover these transitions with exact POST counts.

The parent compared real route captures to frozen phone sources 03.6/03.7 and the
approved desktop specimen. At 390×782 the status starts at y108, image at y260 with
350×196 bounds, and Stop ends at y764. The actual simulator pixels and projected
coordinates deliberately differ from Paper's decorative star field, as agreed.
The source's sample caption becomes “Last solved frame”; physical/offline provenance
remains below the primary workflow. Compact Appearance settles at x20/y48/width350.
Tests wait for placement and disable reveal animation for geometry measurements.

A phone Autofocus setup check exposed unreadably scaled desktop labels. The parent
approved a revised workshop320×120 planned-window diagram with14px labels after
viewing valid and blocked windows in both palettes. Desktop geometry is unchanged.
Outcome actions use the reference's neutral outlined treatment; walking/start
controls retain the accent treatment. Autofocus sample times use24-hour display to
match the preparation references. Its fitted-curve y-axis expands to contain real
samples and curve endpoints rather than clipping them to the source's nominal6px.

Independent verification and final post-OK comparison remain pending. Preliminary
captures live in /tmp; retained evidence is produced only after that gate. No
physical device commands have been issued for this slice.

Settled pre-review checks: 39 Alignment/navigation browser cases (10 existing
workflow/inspection and29 Fieldroom/navigation),66 Autofocus browser cases,13
alignment/fixture unit checks plus8 autofocus unit checks,22 focused workshop
checks, repository lint, and UI/web/workshop builds passed. One combined browser
run lost its shared Vite process and reported connection-refused failures; the
29 affected route/navigation cases passed after starting a parent-owned persistent
server. This was test-environment evidence, not a successful application run.

The pre-handoff coverage audit found the older `exposure-recovery.e2e.ts` still
using displaced presentation selectors. Its semantic updates retained the actual
recovery assertions and exposed a real pending-feedback mismatch: during a Stop
POST, Autofocus's read-retry card still said Stop remained available. Pending now
has visible first priority (“Sending command…”), retaining samples and time without
claiming restoration. Alignment likewise displays pending intent, pauses elapsed
feedback and uses past-tense corrections. The first independent invocation was
interrupted before a verdict so this correction receives a fresh complete review.
Seventeen combined autofocus/recovery checks passed (10 existing autofocus, five
preparation recovery, two unchanged capture recovery); four alignment end-command
checks including the new controlled pending response passed. Full `pnpm check`
passed. The synthetic alignment fixture also now uses the viewport's true
pixel-center convention,799.5/599.5, for its declared north-up projected coordinates;
five fixture checks passed after that correction.

The fresh reviewer returned **OK**, no findings, at `db7a5e8`: 921 project tests,
133 application browser cases, 19 workshop cases and four Python tests passed.
The subsequent parent source comparison found the setup ready card was 100px
high rather than the source's 96px. Its two text rows need an 8px gap, not the
walking status card's 12px gap. The parent corrected and inspected the workshop
first, then adopted that single scoped rule in the route. Nine workshop cases
and 85 Alignment/Autofocus/theme cases passed. The main route matrices now also
emit measured geometry next to their captures. This correction is receiving a
fresh independent review before the final acceptance comparison.
