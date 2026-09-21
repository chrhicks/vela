# Field-test follow-ups — current status

**Last reconciled: September 21, 2026, after PR #73 (`96271ee`).**

Start here to see what remains from the September 14–15 FRA/Veil field test.
This is the maintained status rollup; the linked investigations preserve dated
findings, rationale and implementation proposals. Their old “current” code anchors,
pending-PR statements and unresolved decisions are not today's backlog.

**Update this page when a follow-up ships, a decision changes, or field evidence
closes an investigation.** Record the delivery PR or evidence and the date. Keep
active implementation status in its Linear ticket, link that ticket here when
work starts, and keep capability contracts in their owning READMEs. “Shipped”
means implemented and merged, not proof of physical accuracy. Open proposals below
have not been selected for implementation merely by appearing on this list.

## Remaining implementation work

| Follow-up | Current status and next bounded step | Detailed plan |
| --- | --- | --- |
| Preserve an acknowledged exposure through read interruptions | **Open — recommended next.** Acquisition still attempts cleanup after readiness/timestamp/image-read failure. Retry observation of the same exposure with paced, cancellable reads and honest interrupted status; never resend StartExposure. | [Recovery stage 1](recovery-and-guiding.md#stage-1-prevent-read-outages-from-becoming-unnecessary-uncertain-cleanup) |
| Preserve prepared stages; improve transport classification | **Open.** Retain completed Home/probe/sweep progress through transient read failures. Distinguish body-stream transport failures from invalid data; retain bounded motion feedback and confirmation deadlines. | [Recovery stage 2](recovery-and-guiding.md#stage-2-transport-classification-and-prepared-stage-reads) |
| Preserve raw captures and measurements when presentation fails | **Open.** Preview failure can still prevent capture publication/saving; alignment preview or target-projection failure can end useful measurement. Represent unavailable presentation separately from retained originals/results. | [Recovery stage 3](recovery-and-guiding.md#stage-3-display-artifacts-should-not-own-acquisitionmeasurement-success) |
| Individual alignment-frame failures | **Open.** Distinguish solve-budget expiry from configuration failure and cancellation; retain a valid baseline when a later image can recover. Geometry rejection needs evidence-based classification, not catch-all retry. | [Solver and individual-frame failure](recovery-and-guiding.md#solver-and-individual-frame-failure) |
| Alignment image inspection | **Open — workshop needed.** The adjustment view still has a fixed 20′ crop and limited baseline inspection. Evaluate fit-to-context, fine zoom and expanded/native views on phone and desktop. Fit-both is a proposal, not an approved design. | [Imagery workshop](alignment-and-framing.md#p2-imagery-and-command-feedback-in-the-workshop) |
| Green preview treatment, including saved images | **Open — workshop needed.** Compare retained real exposures, adopt one display-only treatment, and version/regenerate retained derivatives. Decide refreshed-preview display/download semantics; preserve original FITS. | [Preview tint](imaging-and-processing.md#1-preview-tint-fix-one-renderer-and-its-retained-derivatives) |
| Lossless unsigned-16 FITS when representable | **Open.** Encoder still always writes signed 32-bit. Add conditional lossless encoding with signed-32 fallback; verify sample equality and ASTAP/Siril compatibility. Retained originals stay unchanged. | [FITS compatibility](imaging-and-processing.md#2-fits-unsigned-16-bit-compatibility-preserving-all-sample-values) |
| Control-service outage presentation | **Open.** Clarify interrupted/unconfirmed outcome and last completed artifact; inspect fresh device state on return. This does not restore a crashed run or automatically reapply physical settings. | [Service outage boundary](recovery-and-guiding.md#control-service-outage-recovery-boundary-not-restart-automation) |
| Working feedback beyond centering | **Open — separate adoption task.** Reusable Working + shimmer exists; choose the next long-running flows and preserve stale/uncertain and reduced-motion behavior. | [WorkingIndicator](../../packages/ui/src/components/WorkingIndicator.tsx), [centering delivery #73](https://github.com/chrhicks/vela/pull/73) |
| Explain image-quality metrics | **Open — small presentation follow-up.** Make measured-star population and HFR limits accessible on phones; a low HFR among a few surviving stars is not a focus/quality certificate. | [Image-quality metrics](imaging-and-processing.md#5-image-quality-metrics-and-selection-expose-limits-avoid-false-certainty) |

**Suggested sequence, not an execution commitment:** exposure-read recovery →
alignment-inspection workshop → FITS compatibility → preview-color workshop.
Keep transport and artifact-contract changes reviewable separately. The next
clear session need not wait for the whole backlog.

## Remaining field validation and investigation

| Question | What is established | What remains |
| --- | --- | --- |
| Is Vela's polar result physically accurate? | Ideal positive-corridor tests found no justified sign fix. Historical final baseline inputs could not be recovered. The displayed 62.08″ residual and later 78.95″/minute southward drift remain incompatible under an unchanged rigid sidereal-tracking model. | A prepared, recorded comparison against a fresh independent axis/drift assessment with no intervening knob adjustment. Choose tolerance from repeatability. [Offline findings](2026-09-20-alignment-replay.md). |
| Does automatic centering converge on the FRA? | Fresh-solve refinement and failure/Stop behavior pass simulator and browser verification. ASCOM evidence brackets the historical side change around Vela's correction; exact flip timing and the cause of worsening remain unresolved. | Clear-sky convergence, plus an observed pointing-side transition when practical. Retain numerical traces and inspect real solved images. [Centering decision and evidence](alignment-and-framing.md). |
| Does one-shot autofocus produce good physical focus? | Bounded Star-HFR walk, live curve, fitted minimum and Stop/restore handling are merged. | Real-sky trial with the actual imaging filter; inspect native stars across the image. Software verification is not physical focus validation. [Autofocus contract](../../apps/server/src/autofocus/README.md). |
| Are cooling controls confirmed on the physical camera? | Explicit controls, readback, exclusive ownership and uncertainty behavior are implemented. | Confirm actual on/off, target and measured response during next setup; retain a controlled hardware acceptance record. Temperature near target alone does not establish CoolerOn. [Capture contract](../../apps/server/src/capture/README.md). |
| What caused variable transfer latency and recurring guide failures? | Network changes correlated with latency, without establishing cause. PHD2 guiding improved trails; reselection sometimes recovered temporarily. Accepted-sample RMS does not describe rejected frames. | Controlled connectivity observations and synchronized PHD2 debug logs/guide frames during failures. Preserve main-camera originals and explicit frame dispositions. [Guiding evidence](recovery-and-guiding.md#operational-observability-from-phd2). |

### Before the next diagnostic trial

- Enable `VELA_ALIGNMENT_DIAGNOSTICS_PATH` explicitly for retained baseline/latest
  adjustment FITS and numerical journals. **September 21 configuration check:**
  this variable was unset in `.env.observing.local`; `VELA_TRACE_PATH` was enabled.
  Recheck configuration and runtime when preparing the trial.
- Preserve rotating trace files promptly after a trial worth investigating.
  Framing tracing retains numerical inputs/WCS/commands/outcomes, **not raw framing
  FITS**. Alignment diagnostic bundles are a separate opt-in capability. See
  [local tracing](../local-tracing.md) and [alignment evidence](../../apps/server/src/alignment/README.md#opt-in-diagnostic-evidence).
- Use the [next clear-session checklist](2026-09-14-first-light.md#next-clear-session-preparation)
  for retained composition, network, actual filter, cooling and guided test-frame
  checks. Its NINA-only autofocus advice predates Vela autofocus; validate Vela's
  physical result before treating it as an established replacement.

## Delivered follow-ups

| Capability | Delivery and boundary |
| --- | --- |
| Solve diagnostics, progressive same-image search, baseline previews, alignment measurement-read recovery, framing settling/rechecks | [#59](https://github.com/chrhicks/vela/pull/59). Partial read recovery is delivered; the remaining acquisition/preparation paths are listed above. |
| Field review and implementation plans | [#60](https://github.com/chrhicks/vela/pull/60), [CHI-186](https://linear.app/chicks/issue/CHI-186). **Done means the review was delivered, not that all its follow-ups were implemented.** |
| Cooling controls at Capture preparation | [#61](https://github.com/chrhicks/vela/pull/61), hardened in [#65](https://github.com/chrhicks/vela/pull/65). Explicit on/off and setpoint, confirmed readback, persistent uncertainty; writes require an idle/exclusively owned rig. The old cooling-during-capture decision is settled for this release. |
| One-shot autofocus | [#63](https://github.com/chrhicks/vela/pull/63), hardened in [#65](https://github.com/chrhicks/vela/pull/65). The September 15 recommendation to defer all built-in autofocus was superseded by this delivery. |
| Positive-corridor polar regression coverage and offline evidence audit | [#70](https://github.com/chrhicks/vela/pull/70). No production geometry sign correction was warranted; physical accuracy remains open. |
| Replayable alignment evidence | [#71](https://github.com/chrhicks/vela/pull/71), [CHI-190](https://linear.app/chicks/issue/CHI-190). Opt-in bounded originals/journal and replay; reproducibility is not independent accuracy. |
| Automatic centering, measured outcomes, pointing-side observation, Working indicator and numerical tracing | [#73](https://github.com/chrhicks/vela/pull/73), [CHI-192](https://linear.app/chicks/issue/CHI-192). Accepted and merged September 21. ≤0.5′, at most four corrections, stop after two consecutive worsening results. Supersedes the original one-correction-first proposal. |

## Deferred unless separately chosen

- Read-only PHD2 integration; existing PHD2 tools can collect the needed evidence now.
- Automatic frame rejection, guiding recovery or temperature-based capture policy.
- Expanded autofocus scheduling/filter compensation and durable capture sequences.
- In-app calibration, stacking and SPCC. Continue preserving originals, selection
  manifests and processing steps externally; the historical stack's colors remain
  provisional.

## Historical evidence and rationale

- [September 14–15 field findings and artifact index](2026-09-14-first-light.md)
- [Alignment and framing investigation](alignment-and-framing.md)
- [Recovery and guiding source audit](recovery-and-guiding.md)
- [Imaging and processing source audit](imaging-and-processing.md)
- [September 20 offline alignment findings](2026-09-20-alignment-replay.md)

These reports retain historical source anchors and proposals. Use this index for
current disposition, the linked evidence for reasons, and owning READMEs for the
implemented behavior.
