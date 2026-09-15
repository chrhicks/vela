# Recovery, artifact retention, and guiding evidence

[Back to the field review](2026-09-14-first-light.md).

Dated source audit: September 15, 2026, PR #59 head `34a62367`. Code anchors refer to that revision; proposed changes below are not implemented.

Planning only. Inspected current source, owning capture/alignment/imaging/saved-images READMEs, packages/alpaca README, CODING_STANDARDS and observing findings. No hardware access, source edits, builds or tests run for this audit. These are proposed stages, not approved new behavior. apps/server has no root README; capability READMEs own the relevant boundaries.

[Browse the audited source](https://github.com/chrhicks/vela/tree/34a62367f605212d5b317d163109e6047388d2e0). Local evidence is indexed in the field review.

## Already delivered by PR #59 — do not rebuild

- Alignment controller retryObservation at apps/server/src/alignment/controller.ts:85 retries transport errors with paced cancellable waits, retaining baseline and last result. Calls at151–168 cover physical pointing, offline pointing, capture with explicit safe classification, and frame validation;174/285 cover later validation. Browser marks retrying/stale instead of claiming unchanged values are live.
- packages/alpaca/src/acquisition.ts:308 exports AlpacaCaptureRetryableError only before an attempted exposure or after acknowledged start and confirmed cleanup. Lost start responses and cleanup failures remain terminal. Original error is preserved as cause.
- Same-baseline recovery was observed in field during sustained 01:28–01:29 interruption. This is stronger evidence than merely passing tests. It does not validate all later stages or physical geometry accuracy.
- Tests: alignment/controller-physical.test.ts:183 onward exercises pointing/validation interruption, prompt Stop during waits, repeated failure/recovery, and explicit versus raw capture transport classification. acquisition.test.ts covers prewrite timeout, post-ack readiness/timestamp/image timeout, unconfirmed idle, lost start response, cancellation and cleanup failure.
- Full baseline preview before solving, bounded ASTAP diagnostics and progressive same-image search were also delivered. Do not label those absent. Their coupling/failure behavior remains separate work.

## Stage 1: prevent read outages from becoming unnecessary uncertain cleanup

Current gap: acquisition.ts:273–296 makes a single readiness/state/timestamp/image GET; any failure reaches302 and immediately attempts abort. A sustained outage can then make stopCamera at153–156 unconfirmed, correctly preventing another capture but needlessly destroying interactive continuity.

Smallest capability: narrowly scoped, cancellable observation of an already acknowledged exposure inside acquisition. Resume the SAME read after transient transport interruption; never repeat startexposure. Preserve timestamp/ImageReady freshness requirements. Surface interruption/recovery through a capture progress observation usable by the controller, not an adapter-owned user message. Bound each network request and pace retries. An explicit Stop exits observation and runs independent bounded cleanup; unsuccessful cleanup still reports unknown outcome. Respect exposure-completion limits: a camera that persistently reports an incomplete/error exposure after connectivity returns is different from an unreachable camera. Do not silently convert a hardware-stuck exposure into limitless new exposures.

Alternative if one abort has already been attempted: independently inspect idle state, without replaying abort, before any replacement exposure. Do not broadly weaken AlpacaCaptureRetryableError to include uncertain writes.

Tests: outage longer than old request+cleanup budget during imageready, timestamp and image-body reads; exactly one start and zero aborts until explicit Stop; recovery returns same valid frame; stop during request/wait; cancel+cleanup failure remains failed; freshness mismatch remains rejected; successful reconnection reporting active/error camera does not start another exposure. Use controlled fake responses and time, not LAN disconnects.

## Stage 2: transport classification and prepared-stage reads

- internal/client.ts:198–208 treats a body-stream failure as invalid-response unless its local signal aborted. Separate network termination while consuming body from malformed JSON/schema; retain original causes. Avoid catching all TypeError as network without distinguishing an actual body read from decoding/programmer failure. Tests should abort/error a Response body stream after headers, separately supply invalid JSON, wrong schema and malformed ImageBytes.
- internal/client.ts:181–188 maps every HTTP rejection to protocol-error and loses structured HTTP status. Add status metadata and an explicitly narrow transient-read classification for supported 502/503/504 cases if warranted; never retry all driver error envelopes or PUT requests. Keep 503 distinct from a valid ALPACA driver rejection.
- physical.ts read-only stages67,71,75,86,116,124,138 can still lose preparation/baseline after a timeout. Retry coherent observation groups in place around these exact reads, preserving probe/sweep progress. Never wrap prepare or move wholesale. Acquisition primaryAxis at159–174 and framing preflight at296–306/325–331 are similarly read-only before a single command; delayed retries should recheck the full preflight group.
- Confirmation polling in framing.ts:142/269 and acquisition.ts:141 can absorb transient read errors within existing deadlines. Active RA feedback at acquisition.ts:383 must not wait indefinitely while the axis continues rotating; retain stop-on-lost-feedback behavior and no command replay.

Tests: timeout after successful Home/after completed sweep does not repeat movement and retains original reference; Stop while stage observation waits; fresh observation reveals changed camera/site/pier/position and still invalidates baseline; motion-feedback outage sends one stop; confirmation deadline remains effective. No uncontrolled physical movement experiments.

## Stage 3: display artifacts should not own acquisition/measurement success

Alignment controller.ts:171 awaits preview before solver; preview and measurement currently require image URLs and target coordinates (:186–193,286–295). Render error or absent target projection therefore ends the operation despite usable raw pixels or calculated correction. Separate measured state from optional presentation availability: keep acquired frame available to solver; represent preview unavailable and target off-projection explicitly. Never attach an old image to a new measurement as though contemporaneous. Bound retention and preserve last solved image through unsuccessful frames. UI treatment needs workshop alignment and independent verification before browser acceptance.

Capture is more consequential: capture/controller.ts:97–105 Promise.all combines preview, optional analysis and FITS; preview rejection prevents publication and saving of a completed exposure. Optional analysis already catches failures and retains image; this is the pattern to extend carefully. saved-images/store.ts:7/54/192 and metadata currently require native PNG and imageUrl. Smallest next design decision: make raw FITS/metadata the retained valuable artifact, allow missing preview with explicit availability, and support a bounded retry of preview generation from available original. Do not merely catch PNG failure and count an image that cannot be kept. Preserve stop-during-save and save failure semantics; no unbounded in-memory backlog. Existing capture tests at176 verify optional-analysis failure;207/232 protect save ordering and retry. Add renderer-failure tests proving original persists/downloads, unavailable preview is truthful, count reflects completed acquisition, and Stop does not discard completed frame. A storage failure remains a stop with exact unsaved original available, not silent dropping.

### Solver and individual-frame failure

The ASTAP adapter throws when its shared solve budget expires (`apps/server/src/plate-solving/solver.ts:82`, `:95`). Distinguish timeout from no-match, insufficient stars, bad installation/catalog configuration, and cancellation. During adjustment, one frame exhausting its budget can withhold the reading and acquire another paced image while retaining a valid baseline. Do not retry configuration failure or treat cancellation as a timeout. Tests should exercise total budget exhaustion, successful later image, Stop, and terminal configuration errors.

A geometry rejection needs its own disposition: some frames may be unusable without invalidating the baseline, but a changed device/site/pointing state or actual numerical ambiguity must never publish a correction. First reproduce and classify the failure using the [alignment evidence plan](alignment-and-framing.md), then decide which failures permit another observation. Avoid a catch-all geometry retry.

## Control-service outage: recovery boundary, not restart automation

Observed PC restart interrupted an exposure; restored PC had cooling off and the unfinished frame was not recoverable. Capture controller.ts:132–149 ends failed runs and releases operation lease. Capture README explicitly keeps active runs ephemeral; server restart interrupts them. PR #59 alignment retries do not create capture-run resumability; capture/routes.ts:35 maps only confirmed cancellation, and capture/controller.ts:89 has no retry loop.

Propose explicit interrupted/unconfirmed operational outcome with last confirmed exposure/image time, responsible service and no completed-frame increment. When services return, read fresh device state/identity before presenting possible next actions. Reapply cooling, recenter, restart guiding or resume capture only as explicitly authorized operator actions after inspection; no automatic restoration package. Continuing one acknowledged exposure after a transient read failure is different from recreating a run after service restart. Do not invent a general durable workflow engine, auto-PC restart or unrequested rig guardian.

Simulator validation: control service disappears after acknowledged exposure; incomplete frame never counted; last saved frame remains accessible; recovered service reports reset identity/cooling/state honestly; restart loses in-memory operation without implying completion. Physical validation later: ordinary short authorized exposures and a restored-service state inspection, preserving starting configuration. Use deterministic faults for uncertain-command and axis-motion cases.

## Operational observability from PHD2

No PHD2 implementation exists in current app/packages; tonight used external scripts. First future capability should be read-only state/evidence, if Chris wants it: current guiding state, accepted-frame age, lost-frame reason, and explicitly bounded recent accepted-error summary. Keep device/service availability separate from guiding quality and capture artifact outcome. No automatic park, recenter, reselection or capture policy follows from these observations.

PHD2 2.6.14 code 8+nonzero mass/SNR/HFD means detected-primary displacement rejection; true Find failures zero these stats. Code 7 is mass change. Generic No star found cannot diagnose cloud or motion. Fresh connection StarSelected/StartGuiding are catchup snapshots, not necessarily actions. Primary coordinates are last accepted during rejection. AvgDist=100 after 20 seconds is a sentinel, not measured 100 pixels. RMS from accepted GuideSteps excludes rejected frames and needs sample window/count/last-success context. Logs should retain Frame, timestamps, error code and available current stats without converting stale values into healthy status.

Useful next evidence: PHD2 debug log distance thresholds; full guide frames contemporaneous with fades; several stars measured against the selected star; main-camera images have 180-second integration and do not independently resolve short guide fades. Preserve raw artifacts and explicit frame dispositions. Tonight's seven exclusions were evidence-based and originals retained; do not turn a generic event count into automatic rejection.

## Delivery scope

Stage 1 and prepared-stage reads address demonstrated interruption cost first. Keep transport classification and artifact-contract changes reviewable separately. Each meaningful implementation requires independent vela-verifier; user-facing degraded-state design requires workshop treatment and Chris's browser acceptance. Current assignment is planning only; no implementation authorization is inferred from this report.
