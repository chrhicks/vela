# Before the next Veil session: alignment and centering

[Back to the field review](2026-09-14-first-light.md).

**September 20 follow-up:** [offline replay findings](2026-09-20-alignment-replay.md)
record recovered Codex outputs, missing baseline inputs, positive-corridor regression
coverage and the quantitative disagreement with later drift. The physical cause
remains unresolved. The source audit below remains the September 15 account.

Read-only source/evidence audit, 2026-09-15. Checkout `34a6236` (PR #59 head recorded in the observing findings). No hardware access, application edits, or test runs. Anchors below refer to this checkout. PR merge/acceptance status must be checked separately; an implementation present here is not a new proposed fix.

[Browse the audited source](https://github.com/chrhicks/vela/tree/34a62367f605212d5b317d163109e6047388d2e0). Local `data/` evidence paths are resolved from the original checkout and are not committed.

## Outcome and order

1. **P1 — establish whether the polar result is physically trustworthy.** Preserve the distinction between a small displayed adjustment residual and a new measurement of the mount axis. The later unguided drift is strong contrary evidence to treating the displayed minute/arcsecond number as certification.
2. **P1 — make corrective centering judge its result and retain enough evidence to explain worsening.** The existing one-correction command is useful; it does not yet detect a change in pointing state or non-convergence.
3. **P2 — workshop the alignment image scale and composition feedback.** These are operational usability problems, not reasons to rewrite the geometry or make a sequence engine.

## What PR #59 already addresses

- ASTAP now distinguishes no-match/insufficient-stars in diagnostic spans and expands 10/15/30/60/120/180 degrees on the **same** exposure within a shared budget: `apps/server/src/plate-solving/solver.ts:78`, `:97`. `alignment.solve` records the result at `apps/server/src/alignment/controller.ts:195`. The retained failing exposure's successful wider-search reproduction is already documented; do not reopen it as an untested remedy. A solve-budget expiry still throws (`solver.ts:82`, `:95`); [recovery plan](recovery-and-guiding.md) covers that remaining issue.
- Baseline capture publishes its full-frame preview before solving and retains a previous solved image: `apps/server/src/alignment/controller.ts:171`, `:186`. This fixes absent failure imagery, **not** desktop inspection size or the adjustment crop.
- Measurement reads preserve baseline and retry; sustained interruptions actually recovered within the same run in the findings. Do not describe the original configureddevices terminal failure as wholly unfixed. Preparation/movement-stage gaps and display-artifact coupling remain separate reliability work.
- No arbitrary five-degree polar cutoff remains. Finite/Jacobian/branch/final-residual checks now govern adjustment: `apps/server/src/alignment/geometry.ts:79`, `:89`, `:98`, `:105`. This does not establish uniqueness of arbitrary large physical adjustments.
- Framing already offers no-movement Check current frame, accepts edited destination plus current solve ID, removes the fixed two-degree centering cutoff, waits for three consistent readings, and re-exposes after changed readings without resending the slew: `apps/server/src/targets/framing.ts:67`, `:112`, `:130`; command schema `apps/server/src/targets/routes.ts:280`. Existing coverage: `apps/server/src/targets/framing.test.ts:211`, `:221`, `:231`, `:258`, `:280`; browser scenarios `apps/web/tests/targets.e2e.ts:389`, `:414`.

## P1: polar geometry and physical validation

**Evidence.** Final retained alignment was 62.08 arcseconds (earlier minimum 17.11); neither is independent physical truth. The later 129.896-second stationary test measured 170.918 arcseconds south and 4.813 east, with essentially stable image orientation: `data/alignment-diagnostics/drift-20260914/measurement.json`. Driver Tracking=true/Slewing=false establishes reported state only. Guiding's later improvement does not retrospectively validate polar alignment. Two fields do not uniquely identify polar error versus mechanical drift or an unobserved tracking behavior.

**Actual path.** Preparation homes, restores tracking and commands RA=LST+130°, Dec80° (`apps/server/src/alignment/physical.ts:64`, `:82`). A measured 0.25° direction probe selects the primary-axis sign, followed by two 54–60° westward legs (`:119`, `:135`). Status checks reject known pier-side/site changes and mount-coordinate changes (`:39`). These are important guards, but depend on driver observations.

Solved J2000 centers become airless apparent equator/equinox-of-date directions at exposure midpoint plus matching local apparent sidereal time (`apps/server/src/alignment/physical-coordinates.ts:8`, `:28`; shared conversion `apps/server/src/astronomy/coordinates.ts:41`). The baseline plane normal uses three de-rotated sightlines (`apps/server/src/alignment/geometry.ts:32`). Later estimates reuse that baseline and recover two adjustment angles from one center under a sidereal-tracking model (`:68`). The controller never refits the axis during adjustment (`apps/server/src/alignment/controller.ts:278`, `:282`). Projection converts back to J2000 (`physical-coordinates.ts:39`). Thus correct overlays, responsiveness and repeatable residuals can coexist with a biased baseline or violated physical model.

**Concrete coverage gap found.** The new large-correction fixtures use joints **−130,−76,−22°** (`apps/server/src/alignment/geometry.test.ts:71`, `:83`), and their helper defines RA=joint+LST (`:26`). The physical path starts on the **positive** RA−LST side and sweeps downward, nominally +130,+76,+22°. These large-correction tests cover a mirrored corridor. This is a test gap, not proof of a production sign error. The ERFA fixtures use Dec60/joints10,28,46 (`apps/server/src/alignment/physical-coordinates.test.ts:7`), so do not close it. Existing tests establish ideal recovery, wrap and projection; none validates this night's actual pole.

**Smallest investigation, before choosing a fix.**

1. Extract this run's three baseline solves plus selected adjustment solves from retained traces/stdout, keyed by run ID/exposure start. Record whether exact WCS, midpoint/provenance, site and observed motion are recoverable. Current controller spans do not serialize complete numerical baseline inputs; previews are bounded/in-memory. Do not pretend rounded ASTAP text supplies full-precision replay.
2. Build a standalone reproducible evidence fixture from whatever exact data exists. Compare fitted pole and correction evolution with an independent horizon-vector implementation; audit RA-hours/degrees, longitude sign, J2000/equinox-of-date, sidereal sign, server-estimated start vs midpoint, and image parity **separately**. The numbers use solved centers; an overlay row flip alone cannot explain an incorrect numerical total.
3. Extend ideal tests to the actual positive starting corridor and both pointing-state representations, actual latitude/time/Dec80, long adjustment intervals, large-to-small corrections, and realistic coordinate/timing perturbations. Quantify how a baseline perturbation affects the reported error; do not invent an uncertainty meter without support.
4. Design a short physical comparison: knobs still during baseline and an initial stationary interval; one deliberate small knob change with before/after evidence; then an independent fresh axis/drift assessment with no intervening adjustment. Agree the acceptance tolerance against measurement repeatability, not the screen minimum. Retain timing and tracking observations throughout. Schedule this as a prepared field validation, not an unannounced sweep.

**Avoid redundant archaeology.** September10 already retained ASTAP versus independent Astrometry.net solves, ERFA center reconstruction, WCS pose comparisons, and same-input TPPA analysis (`data/alignment-diagnostics/MORNING-2026-09-10.md`, `audit-tppa.md`, `audit-coordinate-poses-results.txt`). Those support the earlier large residual and identify limitations; they neither explain nor validate September14. Reuse their method/fixtures rather than redoing a broad solver survey.

**Gate.** A reproducible geometry defect warrants a focused fix plus independent verification. Otherwise, retain explicit physical-trial language and complete the independent field check before declaring accuracy or encouraging long unguided exposures. Do not add a cosmetic rebase that simply makes a biased residual look small.

## P1: centering across a changed pointing state

**Evidence.** 42.4′ → 86.4′ worsened, with ~180° image rotation near transit; subsequent fresh solves/corrections achieved 8.95′ then 2.38′. A flip is plausible, not established without mount pointing state. Later recovery recenter achieved 56.5″ from the original stack center (`data/observing-20260914/OPERATIONS.md`, recovery section); that useful success does not explain the earlier reversal.

**Actual gap.** `FramingMount` has no pointing-side field (`apps/server/src/targets/framing.ts:7`). Its route calls status without alignment observations (`apps/server/src/targets/routes.ts:261`), while the existing Alpaca adapter reads SideOfPier only inside that opt-in group (`packages/alpaca/src/framing.ts:207`, `:221`); DestinationSideOfPier is not exposed. Current-check validity tests age/configuration/tracking/position, not pointing side (`framing.ts:45`). One shortest sky rotation actual→desired is applied to the mount's current converted pointing (`:118`, `:191`). After a solve and stable readings it unconditionally enters checked (`:145`, `:159`), with no before/after comparison. Mathematical wrap/pole tests (`framing.test.ts:350`) validate rotation, not a driver whose pointing model changes across transit.

**Smallest next change and repro.**

1. Add bounded per-correction evidence at the feature boundary: operation/check ID; desired J2000; solved center/time/WCS orientation/parity; observed mount coordinates, frame and timestamp; calculated command in J2000 and driver coordinates; known actual/predicted pointing side; before/after sky error. Add a narrow optional pointing-state capability rather than forcing every framing read through all polar-specific telemetry. Unsupported/unknown remains explicit.
2. Keep the existing explicit one-correction behavior first; classify solved/improved/within-tolerance/worsened from that correction's **same desired composition**. A solve is not centering success. A changed pointing state invalidates the old correction model; settle and solve again before deriving any additional movement. “Rebase” means adopt a fresh measured mount↔sky relationship, never sync the mount or reset the error numerically.
3. Use deterministic hardware/solver tests reproducing 42.4→86.4, a pointing-side transition, unknown side, delayed coordinates, and 86.4→8.95→2.38 recovery. Assert each correction is derived from its own fresh check, old checks cannot replay, cancelled/uncertain writes never restart, and destination edits do not corrupt the before/after comparison.
4. Only after agreeing its behavior, add bounded cancellable refinement inside the existing server-owned framing operation. Explicit tolerance, maximum corrections/elapsed time, worsening response and non-converging outcome are material decisions. No generic durable sequence or autonomous flip policy is required.

**Gate.** Focused contract/controller/adapter and browser tests, fresh verifier OK, then FRA field validation with at least one observed pointing-state transition if practical and Chris's browser acceptance. Retain current fresh-check, lease, cancellation and no-blind-replay rules.

## P2: imagery and command feedback in the workshop

- `SolvedFrame` hardcodes a centered 20′ vertical crop and 1.6 aspect ratio (`apps/web/src/routes/alignment.tsx:359`). Fit both reticle and reference with padding initially, retain a clear angular scale, and offer deliberate fine inspection. Account for a target outside the captured image without inventing image pixels. Do not couple display viewport failure to numerical baseline validity. Existing projection failure currently terminates at `apps/server/src/alignment/controller.ts:288`.
- `BaselineFrame` is full frame but only a fitted image (`apps/web/src/routes/alignment.tsx:377`); desktop baseline grid gives its summary panel the smaller column (`apps/web/src/routes/alignment.css:81`). Workshop an expanded/full/native inspection affordance using the same exposure timestamp and no new capture. Phone use at the rig matters as much as desktop.
- Composition has phase text and last offset/time (`apps/web/src/routes/targets.tsx:72`, `:139`) but its contract has no exposure-start, download stage, or correction-outcome context (`packages/model/src/web/targets.ts:100`). Add truthful acknowledgement and progress from available backend events, no fake solve percentage. Present before/after error and clear next action while preserving the edited destination and last solved footprint.
- Workshop scenarios: far offscreen target; near-zero error; baseline no-solution; stale/retrying image; 2s versus 20s exposure and slow download; improving/worsening/within-tolerance centering; cancellation; phone and desktop. Then implement approved specimens, browser-test transitions, verify independently and obtain acceptance.

## Decisions still needed from Chris

- Alignment inspection preference: initial fit-both plus manual fine zoom/expanded view is a proposal, not prior approval.
- Independent polar-validation method and prepared field slot; choose a meaningful tolerance after quantifying evidence, not another guessed precision claim.
- Centering: keep one explicit correction with better outcomes, or allow one request to refine automatically? If refinement, agree tolerance, attempt/time bound, and what a worsening first step should do. Existing 0.5′ movement-skip (`framing.ts:121`) is an implementation value, not an agreed new convergence policy.

No unresolved question blocks the offline replay, actual-corridor tests, diagnostic contract proposal or workshop specimens. This draft proposes work; it does not authorize new hardware movement.
