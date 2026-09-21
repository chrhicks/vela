# First light: September 14–15, 2026

> **Historical field review.** See [current follow-up status](README.md) for shipped
> work, remaining implementation and field validation. Pending-PR statements and
> proposed next steps below describe the September 15 review, not today's status.

We collected **53 completed post-focus, 180-second exposures** of the Veil. Seven were excluded after image inspection and pairwise star-profile checks, leaving **46 frames / 138 minutes** in the final selected stack. All originals remain intact. That is a useful result from a difficult night, and a reason to make the next session easier.

This is a dated field review and implementation proposal, prepared September 15. It covers the local findings log, including its later overnight additions. It does not authorize the proposed features or establish physical accuracy from software tests. Preparation was delivered in [CHI-186](https://linear.app/chicks/issue/CHI-186/prepare-the-next-veil-session-from-september-14-field-findings). The [status index](README.md) tracks each follow-up's disposition and links delivery tickets; active task status belongs in Linear and capability contracts remain in their owning READMEs.

## Start here

- [Alignment, framing, and measurement evidence](alignment-and-framing.md)
- [Read recovery, artifact retention, and guiding evidence](recovery-and-guiding.md)
- [Color previews, cooling, FITS, and image quality](imaging-and-processing.md)

The source exploration uses PR #59 head `34a62367f605212d5b317d163109e6047388d2e0`. These documents are maintained separately from that implementation. At this review, [PR #59](https://github.com/chrhicks/vela/pull/59) has an independent **OK** verdict but remains unmerged pending Chris's implementation acceptance. Its tests do not establish hardware polar-alignment or centering accuracy.

## What the night taught us

**Continuity matters beside the rig.** Paced read retries recovered twice in the same alignment baseline after sustained connectivity loss. Asking Chris to start over would have discarded real physical preparation. Other read stages can still abandon useful work, especially when a read failure immediately escalates to an abort whose result cannot be confirmed.

**Measure the outcome the label claims.** Alignment briefly displayed 17 arcseconds; the retained final result was 62 arcseconds. Later stationary image solves measured about 79 arcseconds per minute of southward drift with tracking reported on. That does not identify the cause, but it prevents treating the small displayed polar residual as validated. Likewise, “Framing checked” described a solved field even when a correction doubled the offset.

**Guiding, focus, and alignment are separate.** PHD2 removed the conspicuous long trails; autofocus with the imaging setup improved soft star profiles. Neither proves correct polar alignment. One detected star with a low HFR did not describe a good frame; the later useful frame had hundreds of measured stars and much better native-resolution appearance.

**A recovery is not a diagnosis.** Guide-star reselection restored guiding temporarily, then failures recurred. Generic lost-star messages and accepted-sample RMS did not establish cloud or mechanical failure. Preserve synchronized guide evidence and imaging artifacts before choosing the next experiment.

**Protect observing time and attention.** We stopped refining the recovered composition at 2.38 arcminutes and collected useful data. During delegated observing, keep routine evidence in the log and surface meaningful changes or required action. The result matters more than a stream of reassuring status reports.

## Findings coverage

| Finding from the night | Evidence and current disposition | Proposed next step |
| --- | --- | --- |
| Adjustment target outside the fixed crop; baseline image too small | Presentation limits remain; full frame still solves | Workshop fit-to-context and close inspection; [alignment plan](alignment-and-framing.md) |
| Generic plate-solve failure, discarded diagnostic output | Bounded outcomes/output and baseline preview added in PR #59 | Preserve distinctions; separate timeouts and optional display failure |
| Mount hint outside fixed search radius | Same retained image failed at 5° and solved at 180°, about 9.4° from hint | Progressive same-image search already in PR #59; do not rebuild it |
| Five-degree correction cutoff and uncertain geometry | Cutoff removed in PR #59; numerical root jump rejected; physical accuracy unresolved | Replay baseline evidence and compare to an independent physical reference |
| Frozen alignment reading after device-list timeout | Initially terminal; same-baseline field recovery later observed with retries | Cover preparation and acknowledged-exposure observation without replaying writes |
| AP on/off and changing transfer latency | ImageArray varied from seconds to tens of seconds; correlation only | Controlled local connectivity check next session; avoid causal claims |
| Premature slew completion / inconsistent coordinates | `Slewing=false` preceded changed coordinates; solved field 16.2° off requested target | PR #59 adds settling and no-movement recheck; capture coherent movement evidence |
| Centering worsened 42.4′ → 86.4′; orientation changed ~180° | Suspected flip, unconfirmed; fresh corrections reached 8.95′ then 2.38′ | Capture pointing state, show measured improvement, design bounded refinement |
| Your composition gives inadequate action feedback | Solve success presented without clear correction outcome | Workshop acknowledgement, operation stage, image age and before/after error |
| Strong unguided trails with tracking reported on | Measured 78.948″/minute south; cause unresolved | Independent alignment/drift assessment before relying on Vela residual |
| Guiding improved trails; focus/filter changed star quality | NINA autofocus improved image; sparse HFR misleading | Focus with actual filter, inspect native stars and measurement population |
| Persistent green previews | Existing display stretch amplifies cast; source samples unaffected by preview | One display-only treatment for live, saved and thumbnail surfaces |
| Cooler forgotten; reset off after PC restart | Near-setpoint temperature did not prove cooling enabled | Capability-aware controls and confirmed state; no automatic cooling policy |
| Siril rescales integer-32 input per image | Lossless unsigned-16 working copies avoided the warning | Conditional FITS encoding with full-range preservation and ASTAP replay |
| SPCC imprecise color solution | Registration/orientation worked; repeated SPCC warning remained | Label colors provisional; keep calibration in Siril |
| Control-service outage interrupted capture | PC/service reachability diverged; incomplete exposure unrecoverable; Chris restored PC after restart | Preserve last artifact and explicit uncertainty; inspect fresh state before restart |
| Repeated guide-star fades/rejections; field drift | Several bad frames, seven exclusions, later center ~8′ displaced | Distinguish detection/rejection/stale statistics; obtain guide frames/debug logs |
| Teardown and artifact accounting | Capture idle, PHD2 stopped, tracking/cooling off; no park/home; 159 raw minutes, 138 selected | Reinspect everything at next setup; retain originals and dispositions |

The detailed plans include remaining solver-timeout, response-body transport, motion-feedback, preview-rendering and target-projection failure paths identified in the code audit. They distinguish demonstrated gaps from optional new capabilities.

## Suggested implementation order

1. **Establish trustworthy measurements.** Replay retained alignment evidence and instrument before/after centering outcomes. This can proceed offline. A replacement geometry formula or automatic refinement needs evidence and a scoped decision first.
2. **Prevent avoidable loss of preparation and exposures.** Observe the same acknowledged exposure through transient read failures; retain stage progress; keep movement feedback bounded. Split adapter classification and artifact-contract changes into reviewable changes.
3. **Make capture preparation obvious.** Workshop cooler controls and confirmed status, composition progress, and a usable adjustment view. Choose the smallest ready slice for the next night.
4. **Improve image inspection and interchange.** Compare real preview treatments; implement conditional unsigned-16 FITS output only with solver and external-reader checks. Retained preview regeneration needs explicit cache/version handling.
5. **Investigate guiding with better evidence.** Use PHD2's existing diagnostics. A read-only Vela integration is a possible later capability, not a prerequisite for collecting the next images.

Do not make the next clear session depend on finishing this list. For each implementation: focused checks, fresh independent verification, and Chris's browser acceptance for user-facing behavior. Test hazardous or ambiguous failure paths with deterministic fakes; do not create uncontrolled hardware outages.

## Next clear-session preparation

This is an operator checklist, not a mandatory application wizard or authorization to start equipment.

### Before useful darkness

- Reconnect and inspect actual device/service state after setup. Last night's addresses and connection states are historical evidence, not guaranteed current state.
- Check the outdoor network from the rig location. Separate gateway/PC reachability from Alpaca and PHD2 availability; compare normal image-transfer timing before changing multiple variables.
- Confirm the actual imaging filter and focus with that configuration. Use NINA's existing autofocus while Vela lacks the capability.
- Enable cooling deliberately and inspect confirmed on/off, sensor temperature and setpoint. Last night used 5°C; carry it forward only if Chris still wants that setting.
- Prepare PHD2 debug logging and guide-frame access so another fade yields better evidence. Chris prefers using PHD2 rather than reimplementing it.
- Assess polar alignment independently; use Vela's residual as an unvalidated indication until the disagreement with drift is explained. Keep this diagnosis bounded so it does not consume the whole night.

### Return to the Veil

- Load the retained field reference and confirm the desired composition. The original selected stack center was approximately J2000 RA **312.73793°**, Dec **30.69633°**, scale **1.927″/pixel**, about **3°20′ × 2°14′**, with ~49.84° orientation and flipped parity in Siril. Match a solved reference footprint, not a display rotation guessed from the PNG.
- Obtain a fresh solve after movement. Twenty-second framing exposures solved successfully later in the night, but exposure choice still depends on current conditions. A changed pointing state requires new evidence before another correction.
- Check one guided saved exposure with the current focus/filter/cooling. Inspect native stars across the frame as well as the fitted nebula view. Confirm image retention before starting repeat capture.
- **180 seconds worked for useful production frames.** The proposed two-minute trial was never applied. Retain 180 seconds as an evidenced starting point, then change deliberately if current images justify it.
- Inspect early completed frames and guiding continuity before delegating a longer run. Additional clear-night data can extend the stack; keep session metadata and originals so registration, rejection and calibration remain reversible.

### If something fails

Stop interpreting stale readings as fresh. If a command outcome is unknown, inspect state rather than repeat it. If guide-star reselection helps only briefly, collect guide evidence instead of calling the cause fixed. A Windows/control-service failure may need Chris at the mini PC. Keep incomplete exposures separate from saved frames and preserve any completed raw data.

## Local evidence index

The following paths are **local, Git-ignored artifacts under the original repository checkout**; they are intentionally not included in this documentation PR. They preserve exact IDs, timing and reproduction inputs without publishing raw captures or machine configuration.

- `data/observing-findings-2026-09-14.md` — original chronological findings, including live implementation and overnight additions.
- `data/traces/observing-20260914.jsonl` — controller/adapter spans.
- `data/alignment-diagnostics/20260914-no-match/` — preserved no-match FITS and ASTAP comparisons.
- `data/alignment-diagnostics/drift-20260914/measurement.json` — paired stationary image solves and drift calculation; nearby files hold guide-test telemetry.
- `data/observing-20260914/OPERATIONS.md` — exact local operating and processing commands.
- `data/observing-20260914/audit/` — pairwise star-profile dispositions, processing audit and PHD2 source findings.
- `data/observing-20260914/rejected-frames.json` — seven excluded frame identities and reasons.
- `data/observing-20260914/final-138min/manifest.json` — final selected inputs.
- `data/observing-20260914/final-138min/process/linear-stack.fit` — linear processing artifact; `veil-138min-north-up.png` in its parent is the oriented quicklook with provisional color.

No equipment was contacted or started while preparing this review.
