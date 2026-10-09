# Polar alignment latency: October 8 observing night

## Decision and target

Chris reports repeated adjustment rounds taking approximately **35–40 seconds** and wants **≤10 seconds from submitting a 2-second exposure to a fresh alignment update**. This is the operational problem; the September synthetic 6.528s result is not tonight's baseline. Also report the interval between valid updates and the time until the browser displays the matching image/correction. Initial preparation and three-point mount movement are separate.

**The evidence favors image transport, preview delivery, and redundant observation/wait work, not a solver rewrite. ≤10s reliably is not yet demonstrated.** Eleven of 47 successful exposures took more than 10 seconds just to return decoded pixels. Even zero-cost preview rendering would leave 22/47 server updates over 10 seconds. Tail acquisition/transfer latency must improve to meet the target reliably.

This is a profiling/planning delivery. No production implementation, live edits, restarts, hardware queries/commands, physical exposures, merges or deployments were performed. One cached alignment-state GET was made; existing files were read. Mocked test exposures are local objects. Shared rig/image data was not written. Weather/contextual safety remains Chris's responsibility.

## Exact baseline and isolation

- Remote `main`, local `main`, and observing HEAD were verified as **`cbe0ba6536f78213fd534a56e39cd3f595d6dc40`**. Remote checked with `git ls-remote`; no branch checkout or fetch changed the live runtime.
- Main-based profiling/optimization branch: **`perf/polar-alignment-latency`**.
- Isolated worktree: **`/home/chicks/dev/personal/worktrees/vela-alignment-latency-20261008`**. HEAD remains the above baseline. Only local profiling artifacts and these handoff documents were added; no application source was edited or committed.
- Observing worktree: `/home/chicks/dev/personal/worktrees/vela-observing-20261008`. Launcher PID 860914; traced server child PID 861191; UI 5173/server 3001. All were left running.
- PRs 90–93, Cria branches, and architecture thread `0adf367b-eae8-4167-afe0-8b16f82e8b99` are outside this workstream. No architecture branch was used.
- Benchmarks used Node **v26.7.0**, `nice 19`, CPU affinity **31 only** (one of 32 logical CPUs), one libuv worker, bounded process timeouts, private `.local/latency/tmp`, and a 1GiB JS heap limit. Peak benchmark RSS was approximately **682MiB**. Jobs ran sequentially. No benchmark server/listener was needed: saved-frame processing ran in-process, eliminating port and device-address collisions. If a later integrated run needs listeners, bind loopback port 0 and use its assigned ports plus private storage; never inherit observing environment/configuration.
- Exact current source was transpiled into private compiled files using installed esbuild 0.28.2. Timing wrappers modify only that disposable output. Source hashes are retained. Dependencies were read through local links; no install/build changed shared outputs.

## Measured observing evidence

Existing bounded trace files were already enabled at `data/traces/observing.jsonl` and rotations. The immutable allowlisted snapshot contains **8,314 spans** from **23:57:25.163 to 00:20:31.267 UTC** (19:57–20:20 EDT), run `1c25d70f-d52c-4670-9467-fb43050305df`, trace `2a22f91f28f684e4dbfadf215e0e9ed8`.

There were three successful baseline frames, **47 successful adjustment solves**, **8 adjustment no-solutions**, and one final capture whose subsequent stages had not completed when sampled. The completed adjustment solve rate was **47/55 = 85.5%**. The cause of the unsuccessful images is not established: no image-quality, weather or physical-geometry diagnosis follows from their exit status. All eight exhausted six search radii; none succeeded at a wider radius. All successful adjustments solved on the first 10° attempt.

These distributions use the 47 successful adjustment frames unless stated otherwise. Durations are seconds. Percentiles are interpolated from paired samples; do not add independently calculated medians or parent/child rows.

| Boundary | Median | P95 | Maximum |
|---|---:|---:|---:|
| Actual StartExposure request → ready observed | 2.664 | 3.106 | 3.274 |
| Image request → complete body | 5.781 | 9.159 | 13.355 |
| ↳ request → headers | 1.455 | 1.558 | 1.641 |
| ↳ body consumption | 4.225 | 7.706 | 11.944 |
| StartExposure → decoded frame | 8.701 | 11.888 | 16.400 |
| Decode/return tail proxy | 0.121 | 0.182 | 0.217 |
| Post-capture mount validation | 0.247 | 0.510 | 0.602 |
| Native Bayer preview | 2.022 | 2.835 | 3.223 |
| Post-preview mount validation | 0.279 | 0.482 | 0.762 |
| Entire solve boundary | 0.428 | 0.455 | 0.537 |
| ↳ ASTAP executable attempt | 0.256 | 0.289 | 0.372 |
| ↳ remaining FITS/file/WCS/cleanup work | 0.166 | 0.177 | 0.179 |
| Final mount validation after solve | 0.245 | 0.503 | 0.714 |
| **StartExposure → publication proxy** | **12.319** | **16.439** | **20.131** |
| Publication proxy → next acquisition preflight | 8.247 | 9.910 | 10.356 |
| ↳ 43 serial device reads | 2.244 | 3.907 | 4.353 |
| ↳ two deliberate waits plus small gaps | 6.002 | 6.003 | 6.003 |

**Publication proxy** means the last request of the final mount validation, immediately before projection/state publication in source. It is not an instrumented state-patch or browser-paint timestamp. Geometry/projection/patch still follow. Decode tail is likewise an upper proxy, not a separately instrumented transpose. Existing traces lack wire byte count/Content-Type, so binary negotiation in source does not prove which format this run actually received. Body timing would include JSON parsing if fallback occurred. No selected alignment ALPACA span reported a transport/protocol error; a generic 30-second timeout does not explain these sampled successful rounds.

Readiness used a median eight polls, with a 200ms polling delay in source. Its request and sleep times occur during exposure/readout and cannot be counted again as avoidable post-exposure delay. The nominal 2s exposure reached observed readiness around 2.66s; the extra 0.66s is not independently separated into readout, request latency and polling quantization.

### Reconciling 35–40s and the older 6.528s

- All completed adjustment attempts: capture-preflight to next capture-preflight **20.868s median, 25.196s P95**.
- Valid measurement publication proxies: **21.018s median, 33.924s P95**, maximum **154.571s**.
- Isolated failed solves created **35.577s and 48.934s** gaps between valid readings. Six consecutive failures created the 154.571s gap.
- Matched-window HTTP logs contain 50 alignment image responses: **4.495s median, 9.921s P95, 12.535s maximum**. State responses were **0.120ms median/0.168ms P95** over 1,416 requests. These are HTTP response-completion timings, not browser decode/paint or frame-paired measurements. Image transfer can overlap solve work; do not simply add its median to the server median.
- The browser polls alignment 750ms after a response and holds a new correction until that frame's PNG loads. Native image transfer is therefore a real final gate even though state reads are fast.

Chris's report is consistent with intervals involving a failed solve and delayed image display, but the retained window does not prove that every reported round was 35–40s. No earlier alignment trace was retained in the five files. Preserve both the operator observation and the measured later window.

The September 8 report is retained at `/home/chicks/dev/personal/vela/apps/rig-simulator/.local/alignment-baseline-20260908/REPORT.md`, with raw `results/alignment.json`. It used ref `03ba9165c4443ffb99aa7685bf4784ca5e03c63f`, full-resolution mono images, synthetic J2000/shared-catalog geometry, and one 3s adjustment wait. Its 6.528s median did not include the current physical validation/extra settling, physical network transfer, or native Bayer browser delivery. Its <0.14 arcsec synthetic error is not outdoor qualification.

The current initial physical preparation/three-point run took approximately **196.366s** to first publication proxy, including **19.570s preparation** and **65.503s + 59.833s** motion spans. Exclude it from steady feedback acceptance.

## Source-proven costs and boundaries

1. `apps/server/src/alignment/controller.ts:326` awaits capture, validation, full preview, validation, and only then solving. It publishes the acquired preview before solving; correction publication follows successful solve, final validation and projection at `:530–561`.
2. `controller.ts:563` adds a 3s adjustment window, then `physical.ts:182–205` performs mount status, another 3s settle, mount status and camera geometry. There are **five full mount snapshots per successful round**, each 15 serial GETs (`packages/alpaca/src/framing.ts:278–358`), plus 13 camera geometry reads (`:224–255`). A full successful trace cycle has median 125 GETs, with **4.749s summed scalar-request duration**; some overlap exposure time.
3. The alignment page also mounts `RigObservationProvider` through `Shell.tsx:8–14`. `use-rig-detail.ts` runs a full hardware inventory/telemetry refresh five seconds after each completed refresh. `rig/detail.ts` and `alpaca/provider.ts` inspect every configured device. This demand can contend with acquisition; the performance penalty is **not isolated** by tonight's evidence. Rig-detail HTTP responses were 3.062s median/8.148s P95 in the same window. Navigation's 1s poll is in-memory/catalog work, not another device poll.
4. `plate-solving/solver.ts:83–198` losslessly prepares FITS and launches bounded ASTAP attempts. No warm previous-solve hint is retained. Successful execution is already fast; making this zero-cost could save only roughly 0.43s on these successful frames. Failed searches take 2.773s median, 3.554s maximum, not 30s.
5. ImageBytes is already preferred (`packages/alpaca/src/internal/client.ts:401–435`); do not propose enabling an already-supported protocol as the fix. Measure negotiated format/bytes. Binary decode transposes into Float64 storage; its measured tail is about 0.12s, not the main 30s explanation.
6. Diagnostic FITS re-encoding is awaited when enabled (`alignment/diagnostics.ts:125–169`), but **diagnostics were disabled tonight**. Do not attribute tonight's latency to that path.
7. No global application request queue was found. Reads are serial inside individual operations, while independent detail inspection can overlap them. ASCOM/driver internal serialization is a hypothesis to test, not a measured queue duration.

## Isolated current-source baseline and bounded experiments

Five sequential trials processed four retained real FRA400/ASI2600MC RGGB exposures at 6248×4176, 2s, from `data/alignment-diagnostics/stationary-2026-09-10T02-34-41.504Z`. The first image was repeated to show cache/warm behavior. All source/input hashes and exact timing records are retained.

| Current-source offline stage | Median | Maximum |
|---|---:|---:|
| Saved FITS read | 62.7ms | 65.2ms |
| Retained FITS decode | 132.5ms | 153.3ms |
| Native stretch/debayer | 1,050.2ms | 1,054.6ms |
| Native PNG encode | 2,140.4ms | 2,151.8ms |
| Native preview total | 3,188.8ms | 3,192.1ms |
| FITS encode for solve | 158.6ms | 201.7ms |
| ASTAP process | 402.9ms | 408.7ms |
| Solve total | 578.0ms | 623.3ms |

**5/5 solved**, with center discrepancy below **0.000111 arcsec** against each saved solution. This is deterministic repeatability with a known solved-center hint and the same catalog/tool, not independent astrometric accuracy. Single-CPU/low-priority timings are not interchangeable with live timings. This is an isolated image-processing baseline, not a simulated claim about camera/LAN/browser latency.

An additional three trials used the **existing, unchanged `capturePreviews` helper** on the same first exposure:

- Native PNG: **64,576,973 bytes**, 6248×4176.
- Exact averaged display derivative: **3,742,463 bytes**, 1562×1044 — **17.26× smaller / 94.2% fewer bytes**.
- Combined generation median **3.426s**, versus 3.189s for native preview alone. The helper still renders and compresses native first. This experiment proves a large payload opportunity; it does **not** prove faster generation or an end-to-end speedup.

No camera binning, ROI, exposure duration, solver parameters, astronomy math, or live settings were changed. There is no production after-result yet.

Focused baseline verification: four existing files (geometry, independent physical-coordinate fixtures, controller physical behavior, solver lifecycle) passed **40 tests in 6.60s** under one-worker/one-CPU limits. Ten selected acquisition freshness/cancellation checks also passed in 1.16s (69 unrelated cases deselected), recorded in `results/acquisition-tests.log`. Tests use fake transports/commands; none contact the rig. Full suites, physical validation, phone/browser paint tests, long-run memory tests and before/after integrated optimization measurements are deferred to implementation/review.

## Ranked implementation plan

1. **Make each round measurable and keep failures honest.** Persist bounded run/frame-correlated spans through actual exposure submission, readiness, transfer headers/body/bytes/type, decode, validation, preview/solve, state patch, browser receipt and matching-image ready. Retain time provenance and stale ages. This closes the current proxy/unknowns before claiming success.
2. **Remove native PNG from ordinary feedback delivery.** Serve a fast fit derivative of the same frame for normal alignment, retaining exact native-image coordinates and same-exposure enlargement. Generate fit before native compression, then overlap solver and bounded display preparation where independent. Do not wait for a ~64MB native PNG just to display a fit view. Preserve visual treatment; agree any material inspection behavior change in the workshop.
3. **Reduce acquisition/transfer latency and its tail.** First record actual format/bytes, then reproduce using saved payloads and recorded delay distributions. Separate driver/header preparation from body transfer. Remove unnecessary full-rig background polling while alignment owns the rig, retaining explicitly aged state; benchmark its effect rather than assume it. Investigate narrow stable-metadata reuse and bounded concurrent safe reads, preserving fresh identity/mount-state checks. If unchanged full-frame acquisition still exceeds 10s at the tail, report that limitation; do not declare the target met from a faster median.
4. **Coalesce overlapping steady adjustment/settle waits.** Preserve one explicit cancellable 3s physical settling allowance and post-settle observation; do not blindly remove motion settling or retry backoff. Saving a redundant 3s improves update cadence but not the metric starting at actual exposure submission. Assess the 2.24s preflight observation budget separately.
5. **Only then consider low-payoff processing/solver work.** Reuse lossless FITS when diagnostics are enabled, tighten memory copies/typed pixel storage, and evaluate a last-success hint with bounded fallback. Successful ASTAP is not the main bottleneck. Avoid rewriting in another language without evidence that a remaining measured CPU boundary warrants it.
6. **Conditional camera tradeoffs, separate reviewable scope.** Binning, ROI, shorter exposure, catalog/solver tuning or altered solve input require representative solved/unsolved frame comparisons, geometry/WCS fidelity and explicit quality tradeoffs. Software downsampling after transfer cannot reduce camera transfer. No such settings are authorized to change tonight.

The absolute exposure floor is 2s plus unavoidable readout, transport and computation. With tonight's unchanged acquisition, the observed decoded-frame floor is **6.146s minimum, 8.701s median, 11.888s P95**. The fastest observed server publication proxy was 9.152s. A typical ≤10s path is plausible after preview/transport work; **reliable ≤10s cannot be promised with the measured acquisition tail unchanged**. Paired zero-preview counterfactual: 9.957s median, 13.388s P95; these are projections, not after measurements.

## Separate correctness/freshness issue

The earlier approximately 9.47° total/12.33° azimuth result and offscreen target remain physically unverified. Azimuth adjustment angle and total spherical pole separation are different quantities, so that ratio alone is not a mathematical contradiction. A newer acquired preview with an older solved correction is also intentional during failures, and this run contains a >150s valid-measurement gap. Neither observation proves that the old correction was correct.

One cached state GET at 00:18:29.742 UTC showed matching preview/measurement exposure start 00:18:14.528 UTC, age 15.214s, with `server-estimate` provenance and no warning. It reported total 125.904 arcsec. That single later state does not invalidate the earlier report or establish alignment quality. Geometry uses exposure midpoint; the UI shows exposure start. Preserve both and their provenance. Independent outdoor direction/repeatability and an external accuracy reference remain necessary later.

## Evidence and handoff

Relative paths below are in the isolated worktree:

- [Self-contained Opus 5.5 High brief](2026-10-08-opus-alignment-latency-brief.md).
- [Measured trace report](../../.local/latency/trace-analysis/REPORT.md), [per-frame evidence](../../.local/latency/trace-analysis/measured.json), [paired lower bounds](../../.local/latency/trace-analysis/lower-bounds.json).
- [HTTP timings](../../.local/latency/results/http-log-summary.json), [cached state](../../.local/latency/live-state-1.json).
- [Saved-frame baseline](../../.local/latency/results/saved-frame-bench.json), [fit payload experiment](../../.local/latency/results/fit-preview.json), [source hashes](../../.local/latency/source-sha256.json).
- [Reproduction instructions](../../.local/latency/README.md), harnesses and focused test logs alongside them.

Current primary references checked October 8: [ASTAP command-line documentation](https://www.hnsky.org/astap.htm#command_line) describes hint/search-radius and automatic downsampling controls; [ASCOM Alpaca API](https://ascom-standards.org/api/) owns the wire protocol. These do not qualify altered settings on this rig. No dependency/tool upgrade was made.

Continuum summary/search/exact retrieval and final record through Executor all returned `WORKSPACE_ERROR: Workspace path must identify an existing directory` for the required logical Polaris workspace. Local retained files supplied the historical evidence; no alternate database/CLI access was attempted. No Linear issue or PR was created for this planning-only handoff.

A separate fresh-context, read-only report audit recomputed the paired target limits and checked metrics, test results and acceptance coverage. It found no material numerical or interpretive errors. This is evidence review, not implementation verification or merge approval.
