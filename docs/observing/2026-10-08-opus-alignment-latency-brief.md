# Implementation brief: Vela polar alignment feedback ≤10 seconds

Recipient: **Opus 5.5 High**, handed off by **Atraeus**. Prepared by Astra High, October 8, 2026. This is a complete implementation brief, not authorization to alter tonight's observing session. The requested profiling/planning work is complete; Atraeus owns the subsequent implementation handoff and independent verification.

## Objective and non-negotiable scope

Chris measures polar-alignment adjustment rounds at approximately **35–40 seconds** with **2-second exposures**. Aim for **≤10s from actual StartExposure submission to a fresh, matching alignment correction displayed in the browser**, and also improve valid-update cadence. Report server publication and browser image-ready separately. Exclude initial homing/preparation/three-point movement from steady statistics. Do not substitute an old 6.528s simulator run or the UI's preflight timer for this definition.

Keep image/geometry fidelity, source timestamps, cancellation and honest last-known state. Do not hide no-solutions, stale readings, offscreen targets or latency outliers to claim success. CPU use is acceptable when it materially improves feedback; there is no language/rewrite preference. Pick the smallest measured optimization using Vela's current TypeScript/Node/ASTAP boundaries first.

**Tonight:** no edits/restarts of live services/worktree, additional hardware requests, exposures, slews or other device commands; no shared rig/image-data mutations, merges or deployments. Read-only existing logs/saved files and sparse cached alignment-state GETs were permitted, but the preserved evidence is sufficient; do not start by polling the active rig. Do not print environment variables or credentials. Weather/contextual safety belongs to Chris.

## Repository, branch and evidence

Read `AGENTS.md`, `SOUL.md`, `CODING_STANDARDS.md`, `.agents/skills/inquiry/SKILL.md`, `docs/rift-workspaces.md`, alignment/imaging/ALPACA READMEs and `apps/web/src/features/alignment/README.md`. Existing scope is settled; choose routine implementation details without another permission round. A material camera-quality tradeoff or new product behavior needs explicit alignment. New visual/inspection treatments go through the workshop.

- Workspace: `/home/chicks/dev/personal/worktrees/vela-alignment-latency-20261008`.
- Branch: `perf/polar-alignment-latency`, based on exact main **`cbe0ba6536f78213fd534a56e39cd3f595d6dc40`**. No production changes/commits have been made. Check status before editing; preserve the report/harness and other agents' work.
- Remote main and tonight's legacy observing ref were identical at profiling time. Recheck remote main at implementation handoff; if it changed, record the new comparison base and keep the original baseline evidence. Do not rebase/cherry-pick through Cria feature branches.
- Active observing: `/home/chicks/dev/personal/worktrees/vela-observing-20261008`, launcher PID 860914/server child 861191, UI 5173/server 3001, ASTROPC `100.92.63.0:11111`. These identify what **must not be touched**. ASI2600MC Pro 6248×4176 RGGB, Askar FRA400, direct legacy ALPACA path.
- Architecture PRs 90–93 and thread `0adf367b-eae8-4167-afe0-8b16f82e8b99` remain separate. No core/extension/Cria migration is part of this task.
- Report: `docs/observing/2026-10-08-alignment-latency-report.md`.
- Authoritative numbers: `.local/latency/trace-analysis/measured.json`, `lower-bounds.json`, and fixed `spans.sanitized.jsonl`; live-file hashes/time window are included.
- Bench scripts/results: `.local/latency/harness/`, `.local/latency/results/`, `.local/latency/source-sha256.json`; reproduce with `.local/latency/README.md`.

The `.local` files are ignored local evidence, not yet committed test infrastructure. Promote the smallest useful sanitized fixture/harness into tracked code with the optimization; do not commit large originals, raw operating logs, environment files or private configuration. Preserve evidence before cleaning the workspace. Read-only dependency links currently point to installed packages in the original Vela workspace; install isolated dependencies later if needed, without changing shared outputs.

## What is measured, and what is not

Fixed live trace window: **2026-10-08 23:57:25.163 to 2026-10-09 00:20:31.267 UTC**, run `1c25d70f-d52c-4670-9467-fb43050305df`. Three baseline solves; 55 completed adjustment solves: **47 solved / 8 no-solution**, plus one incomplete final frame. Success rate 85.5%; do not omit the failures.

Successful adjustments (n=47), median / P95:

- Actual exposure request → readiness: **2.664 / 3.106s**.
- Full image request: **5.781 / 9.159s**; headers **1.455 / 1.558s**, body **4.225 / 7.706s**.
- Actual exposure → decoded pixels: **8.701 / 11.888s**, max16.400s; **11/47 already exceed10s here**.
- Full native preview: **2.022 / 2.835s**.
- Three post-capture validation boundaries: medians **0.247, 0.279, 0.245s**.
- Entire solve: **0.428 / 0.455s**, of which ASTAP process **0.256 / 0.289s**.
- Actual exposure → final-validation endpoint (publication proxy): **12.319 / 16.439s**, max20.131s. Real state-patch/browser events were not instrumented.
- Publication proxy → next acquisition preflight: **8.247 / 9.910s** = approximately **6s deliberate waits + 2.244s serial preflight reads**.

These are nested/independently distributed stages, not values to sum into a synthetic total. Existing traces do not contain wire byte counts or Content-Type. Do not claim proven binary transport, a particular throughput cap, or a driver/server/network division from them.

Valid-update gaps: median **21.018s**, P95 **33.924s**; individual failed frames produced **35.577s/48.934s** gaps, six failures produced **154.571s**. All successful frames solved at first10° radius; all8 failures exhausted10/15/30/60/120/180° in median2.773s. No alignment ALPACA transport/protocol failures appear in the retained window. The measured later window does not replace Chris's35–40s observation.

Matched-window image HTTP responses: n50, **4.495s median / 9.921s P95**; alignment-state responses n1,416, **0.120ms median**. Browser decode/paint and exact frame pairing were not measured; image transfer can overlap solving. Rig-detail HTTP polling took3.062s median/8.148s P95 and generates unrelated device reads.

**Target feasibility:** counterfactually deleting all preview generation gives **9.957s median / 13.388s P95**, still22/47 server updates>10s. Preview-only changes or removing pre-exposure waits cannot establish the target. Acquisition/transfer tail reduction is required for reliable≤10s. Physical exposure alone imposes2s; decoded-pixel minimum in this sample was6.146s. Do not promise zero latency or a guaranteed target before after-measurements.

Offline current-source baseline: five runs/four saved2s RGGB frames, full resolution, known-solution hint,5/5 solved. One low-priority logical CPU: preview3.189s median, solve0.578s (ASTAP0.403s), FITS encode0.159s. Centers repeated saved answers within0.000111arcsec; that is same-tool repeatability, not independent accuracy. Existing exact display derivative: **64,576,973-byte native PNG → 3,742,463-byte fit PNG (1562×1044)**. This is17.26× smaller; existing helper takes3.426s combined and compresses native first. No production after-result exists.

Historical reference only: September8 `03ba9165c4443ffb99aa7685bf4784ca5e03c63f`, Node26.7.0, synthetic mono6248×4176,2s,3s wait,6.528s cadence,0.14arcsec simulator truth. Stored under `/home/chicks/dev/personal/vela/apps/rig-simulator/.local/alignment-baseline-20260908`. It omits the physical settle/validation/transport/Bayer browser costs.

## Implementation sequence and reviewable PR scope

Keep each slice independently reviewable. No broad architecture, provider framework, persistent workflow engine or generic scheduler. Use the existing narrow adapter/controller contracts. Register PRs with T3 if created. No merges tonight.

### 1. Timing and faithful isolated replay

Add bounded per-frame/run correlation to existing observability. Use monotonic durations; preserve UTC exposure start, midpoint and provenance independently. Record:

- acquisition preflight; actual exposure command submission/acknowledgement;
- ready polling count, elapsed readiness, interrupted reads;
- image headers/body timing, negotiated format and byte count; decoding;
- settling and each validation window; optional/background reads;
- FITS encode/write, ASTAP attempt/radius/outcome, parse/cleanup;
- preview generation/compression/bytes, optional diagnostics, geometry;
- actual state publication, browser response receipt and image-ready/display commit for the same frame.

Persist a compact frame summary/outcome with cancellation/failed-solve status alongside the existing bounded trace mechanism. Do not log environment, credentials, pixels or unrestricted payloads. Avoid duplicated giant per-poll output. Tracing failure must not change rig operations. Distinguish capture age from compute completion and failed-frame intervals.

Build an isolated replay using saved physical Bayer frames plus independent synthetic fixtures and recorded timing profiles. For transport, use fake/loopback-only endpoints with hardcoded loopback allowlisting; production hardware addresses must be impossible to select. Use private storage, temp/catalog roots and ephemeral loopback ports; no copied observing environment. Reproduce baseline first, then change one factor at a time. Keep CPU/workers bounded during observation; never launch costly suites concurrently.

### 2. Fast same-frame display and independent work overlap

Change normal alignment feedback to use a fit derivative before native PNG compression/download. Preserve current color/stretch treatment and native pixel/WCS coordinates. The existing `capturePreviews` derivative establishes exact display averaging, but calling it unchanged does not remove native work from the critical path. Stream/tile the same display transform or otherwise publish the fit result first; avoid speculative new imagery treatment.

Begin solving original integer pixels independently of preview work when possible. A single frame owns both results. Publish a correction only with a matching ready display image and confirmed physical validation; never draw it on older pixels. Keep native enlargement of that same exposure available on demand, with bounded image retention and cancellation ownership. Preserve approved fit/fine/zoom semantics; do not silently lose fine inspection resolution.

Browser `useSolvedMeasurement` currently waits for native `Image.onload`. Make it wait for the matching fast derivative instead, with stale/obsolete callback rejection intact. Retain explicit native dimensions/coordinate transforms and frame identity; independently test scale/centers, pixel-center convention, odd dimensions and offscreen targets. Workshop review is needed for any material interaction change; use the existing visual design otherwise.

### 3. Acquisition and transfer tail: essential to the goal

Measure actual bytes/type before editing transport. ImageBytes is already negotiated preferentially in `packages/alpaca/src/internal/client.ts`; no unsupported claim that “switch JSON to binary” is sufficient. Separate request/header preparation, body download, decode and readout readiness. A smaller display payload may reduce shared-link contention, but measure that effect separately.

Suppress redundant full-rig inspections while alignment owns the rig, or reuse/coalesce them narrowly. `Shell`/`RigObservationProvider` currently calls `useRigDetail` on alignment routes, whose five-second-after-completion poll walks every configured device. Preserve last-known data with honest age/paused observation status; do not preserve an unqualified green connected label. Multiple tabs require server-side awareness or at least explicit qualification; do not invent a general scheduler.

Examine repeated stable geometry/identity reads and bounded concurrency at the adapter boundary. Successful rounds perform five15-GET mount snapshots plus13 camera-geometry GETs. Preserve fresh tracking/motion/site/pier side/identity/geometry evidence at required boundaries and after interruption. Reuse within a documented observation window or combine necessary reads, not an indefinite stale cache. Unbounded parallel ALPACA calls may worsen driver contention; test controlled concurrency against serial behavior and external state changes.

If the same full-resolution acquisition still has >10s samples before pixels arrive, say the goal remains unmet. An isolated fake network improvement is not physical validation. Identify a later authorized physical/network investigation; do not probe or reconfigure the observing rig tonight.

### 4. Steady cadence and remaining processing

Coalesce the controller3s adjustment window with physical3s pre-exposure settling only after proving one explicit cancellable settle interval and post-settle validation remain. Keep initial movement settling and transport retry backoff unchanged. This reduces cadence, not actual exposure-start latency.

After larger costs, consider immutable FITS preparation reuse when diagnostics are enabled, narrower typed pixel storage, and last-solved hints with safe fallback. Diagnostics were off tonight; successful ASTAP takes≈0.26s, so neither is the main explanation. Never overlap exposures, lose frame freshness, or queue unlimited preview/solver/diagnostic work. A language rewrite requires a remaining measured bottleneck and equivalent behavior.

Do not include binning, ROI, exposure shortening or altered solver input in the first PR. They require a separate measured quality decision. Post-download downsampling cannot improve camera download. Bayer-aware reduction and correct WCS/bin/ROI mapping must be proven before any later camera-setting proposal.

## Correctness and acceptance

Treat the earlier9.47° total/12.33° azimuth/offscreen target and90s age gap as a separate unresolved issue. Total spherical pole error differs from azimuth knob angle, so their numerical ratio alone is not a defect. Failed solves legitimately preserve old correction/image/time while new previews arrive. The recorded154s gap supports that possibility; it does not establish physical accuracy. No clamp, timestamp replacement or “success” badge should conceal it.

Preserve all of these:

- A timestamp change or observed `imageready=false` transition before accepting a timestamp-less exposure. Do not move initial polling so late that the freshness transition is missed.
- Readiness/timestamp checks before and after transfer; exact original server-estimated timestamp retained through same-exposure recovery.
- Revalidate device identity/geometry and observed state after interruptions; never replay ambiguous StartExposure/movement.
- Midpoint astronomy math, start-time UI provenance, monotonic sample times, usable baseline, finite geometry, inverse-branch continuity and full WCS projection.
- Final physical validation before publication; no correction over an older preview.
- No late result after Stop/restart or from an older frame; no unlimited background queues. Stop must abort owned work, await process/device cleanup and leave unknown outcomes explicit.

Targeted tests:

1. Baseline files already passed: `alignment/geometry.test.ts`, `physical-coordinates.test.ts`, `controller-physical.test.ts`, `plate-solving/solver.test.ts` (40 tests). Re-run scoped files affected by changes, then broaden only for affected boundaries.
2. `packages/alpaca/src/acquisition.test.ts`: retained old image, missing timestamp, replacement camera, lost command response, image-read recovery and cleanup failure. Test delayed/reordered/failing body reads with preserved frame identity.
3. Slow-preview/fast-solve and reverse; old image finishes after new; failed solve across≥90s; image404/retry; Stop in every async boundary; restart before stale completion. Assert state/image/measurement IDs and timestamps together.
4. Actual controller+browser timing fixture with private fake transport and representative large Bayer payloads; inject median/P95/max recorded transfer delays. Count background calls with one/multiple tabs and assert truthful paused/stale equipment state. Keep operation ownership and no blind replay.
5. Golden display comparison (same current stretch/color averaging), native-coordinate projection within agreed subpixel rounding, full-frame original immutability. Maintain independent ERFA fixture tolerances: <1arcsec per axis and <0.6 native pixel projected target under existing tests. For new resampling/solve input later, require separate ground-truth quality evidence, success/failure comparison and no baseline-branch jump.
6. Record Stop request→completed cleanup distribution/max, event-loop delay, RSS and active subprocess/job counts. Test forced slow work; do not claim a hardware Stop deadline from fake transports.

Before/after table must include n/unique images, success and failure counts, all-stage p50/P95/max, actual exposure→server publication, actual exposure→matching browser display, valid-update gaps, stale age, cancel/Stop, geometry deviations, RSS/CPU, fixture/hardware conditions and exact commits. Use the same inputs/settings/transport schedule on both refs. Run at least30 representative steady attempts per candidate outside tonight's constrained session; report every >10s successful round and failed attempt. Aim for≤10s normal healthy rounds; P95≤10s is a useful milestone but does not erase slower-tail misses. Do not declare the full target achieved if its tail or browser portion remains unmeasured. Short5-frame processing experiments are directional only.

A full-resolution path likely needs both transport and display improvements. If≤10s cannot be achieved with acceptable quality and current device/network behavior, deliver measured best attainable latency and the specific remaining constraint; do not conceal it with a faster but stale result.

## Delivery and review

Proposed PR sequence: (1) frame timing/replay and explicit freshness evidence; (2) fast same-frame preview/solver scheduling with inspection compatibility; (3) measured acquisition/background-read and steady-cadence reductions. Split further only when it makes review clearer. Keep each on the main-based optimization lineage, never architecture PRs90–93. No merge/deploy tonight.

Run the project fresh-context `vela-verifier` on each meaningful implementation PR following AGENTS, with only its PR URL and a runnable isolated checkout. Resolve notes to OK before asking Chris to try user-facing changes. Open the actual isolated implemented experience with representative fixtures; get Chris's browser acceptance before merging. A synthetic success does not qualify the physical rig or phone. Hardware validation requires a later authorized observing window; tonight's prohibition remains in force until explicitly changed.

Continuum through Executor currently fails workspace resolution for `/home/chicks/dev/personal/vela`; use these local artifacts until the integration works. Do not use a CLI/database workaround or disclose credentials. Consult primary current [ASTAP documentation](https://www.hnsky.org/astap.htm#command_line) and [ASCOM Alpaca API](https://ascom-standards.org/api/) if modifying those boundaries.
