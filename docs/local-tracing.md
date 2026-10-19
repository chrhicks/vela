# Local operation tracing

Set `VELA_TRACE_PATH` to a JSONL file path when starting the observing server.
From the repository root, use:

```sh
VELA_TRACE_PATH="$PWD/data/traces/observing.jsonl" pnpm dev:observing
```

Absolute paths keep the destination independent of the server working directory.
Tracing is disabled when the variable is unset. The server registers the
OpenTelemetry provider; the ALPACA adapter depends only on its API. No collector,
Fastify auto-instrumentation, or browser tracing is required.

Alignment command spans identify the Fastify request and rig. A detached
`alignment.run` span keeps its trace context through preparation, capture, solve,
movement and preview work. `alignment.started` is an immediately completed marker.
Short ALPACA request spans finish during the operation, so evidence appears in
roughly one second even while the alignment run remains open. Stop commands carry
the same `alignment.run.id`; their separate command trace can be joined by that
attribute. Request descendants can be joined using `traceId` and `parentSpanId`.

Each line contains a completed span with timestamps, monotonic duration, IDs,
attributes, events and status. Request stages distinguish waiting for headers,
consuming the body and decoding/validating the response. For JSON responses,
body consumption includes `Response.json()` parsing; it is not a pure wire-transfer
measurement. HTTP 200 alone does not
establish an ALPACA operation succeeded. Image bodies/pixels are excluded.

A practical live view from the repository is:

```sh
tail -F data/traces/observing.jsonl | jq --unbuffered '{name, traceId, parentSpanId, durationMs, status, attributes}'
```

For a known run trace, select its records with `jq 'select(.traceId == "...")'`.
Inspect the short request spans first when a long operation remains active. An
unfinished parent and its events will not be exported until it ends. This is a
trace journal, not a complete run archive: a crash may lose open spans and the
last queued batch.

The SDK queue is bounded at 2048 spans, exporting up to 128 at a time. The async
writer bounds queued serialized data at 4 MiB and retains five files of at most
20 MiB each (the active file and `.1` through `.4`). Use one path per running
server. Export failures are reported to stderr and do not fail device commands;
a disk failure disables further writes for that exporter. Restart the server
after resolving it. Graceful server shutdown closes active controllers before
flushing tracing, with a five-second telemetry shutdown limit. No device request
waits for disk flushing.

Vela-side traces measure the combined remote/network wait. They cannot separate
mesh transit, ASCOM Remote serialization, or driver work without evidence from
the rig PC. Compare idle and motion-time reads before assigning a cause. Tracing
also cannot guarantee immediate physical stopping: the event loop, transport and
remote driver all contribute to the command outcome.

## Centering and framing evidence

Framing uses the same configured journal. `framing.run` records rig/request/run
IDs, action, target, exact desired J2000 position, exposure settings, configuration,
tolerance and correction limit. A completed `framing.started` marker exports
these while the operation is still active. All device and ASTAP descendants share
the run's trace ID; `framing.check.id` joins the original solve to a later centering
request even when those requests have different trace IDs.

- `framing.centering.baseline`: starting solved center, time, orientation, distance
  to this request's desired center, pointing side and observed mount state.
- `framing.move.requested`: exact computed J2000 command, converted driver command
  and coordinate system/epoch, full pre-command mount readings, correction number and
  source check ID. `framing.move.completed` means the adapter confirmed completion;
  the later solve determines accuracy. Missing completion is not success or permission
  to replay the write.
- `framing.solved`: full-precision solved center, timestamp and its camera/server-estimate
  provenance, color layout, offset, orientation,
  WCS (including CD matrix/parity and reference pixels), and mount readings at exposure.
- `framing.check-validation`: post-exposure readings and whether the solve still
  matches the mount. Rejected checks are retained as evidence but never authorize
  another correction.
- `framing.correction.measured`: check ID, before/after comparison through ordered
  measurements, observed side change, and convergence outcome. The parent run records
  final phase/outcome, correction count, cancellation and failures.

These short records are exported during work, rather than only at the end. The
rotation, queue and crash limits above still apply: preserve the trace files after
a trial you want to investigate. **Raw framing exposure pixels/FITS are not retained
by tracing.** The numerical record supports reconstructing the pointing correction
and its WCS, but rerunning source-image solving or judging image quality needs the
original images. Alignment's separately enabled FITS bundles cover alignment,
not framing.

## Plate-solver failures

Inspect `astap.solve` spans beneath the alignment solve step for the overall
outcome, J2000 hint, configured field height, total timeout and image dimensions/
capture time. Child `astap.attempt` spans include the radius, remaining timeout
and process diagnostics for each search. Search expands through 10°, 15°, 30°,
60°, 120° and 180° on the same image, sharing one total time budget.

`astap.exit_code` is the process exit code when available; `astap.outcome`
distinguishes `no-match` (exit 1, try wider) from `insufficient-stars` (exit 2,
stop). The workflow receives `no-solution` when the full search finds no match
or the exposure has insufficient stars. Exit 0 is only `solved` after WCS
validation. Other failures, including budget exhaustion, are `error`; operator
cancellation is `cancelled`.

Each attempt's `astap.stdout` and `astap.stderr` retain the last 4096 characters
with `.truncated` flags. Attempt spans appear after each solver process ends,
even while the overall solve and alignment run remain active. Raw exposure
pixels are excluded.

## Cria device interruptions

With Cria equipment, `cria.observation.interrupted` is an immediately completed
marker written when a device's readings stop being usable, and
`cria.observation.recovered` is written when they return, with
`cria.interrupted.ms`. Only changes are recorded, never every snapshot. The marker
names the device (`cria.device.id`) and why (`cria.interrupted.message`). Vela
treats every device as interrupted when Cria's event stream goes 3 s without a
snapshot. Cria decides each reading's freshness itself. An optional stale
reading makes the view partial. An interrupted identity or connection reading
produces an interruption marker. Find them with:

```sh
jq 'select(.name | startswith("cria."))' data/traces/observing.jsonl
```

## Capture runs and frames

A capture run writes `capture.run.started` (rig, exposure seconds, `capture.run.repeat`,
`capture.run.saveFrames`) and `capture.run.ended` (final `capture.run.phase`, and the run's
`completed`, `lost` and `saved` counts, plus `capture.run.error` if it failed). Each frame is one
`capture.frame` span from the start of its exposure to the end of its save, with
`capture.run.id`, `capture.frame.index` and `capture.frame.outcome`: `saved`, `unsaved` (kept in
memory only), `lost` (the camera driver no longer held the image; the span has an error status),
`save-failed`, `stopped`, `uncertain` (Vela could not learn whether the exposure ran) or `failed`.
A frame from a Cria rig also carries `capture.provenance.request.id`, `.operation.id` and
`.image.id`, as far as Cria had given them when the frame ended, and `capture.image.id` (Vela's own
ID for the image, the same as in its saved `metadata.json`) when an image arrived. `capture.acquire.ms` is the exposure plus readout and transfer, and
`capture.overhead.ms` is the part beyond the exposure. `capture.process.ms` covers previews, star
measurement and FITS encoding, `capture.save.ms` the write to the saved-image store (absent when
frames are not saved), and `capture.fits.bytes` the size of the FITS file. When the camera's
reads fall into retrying during a frame, the span gets `capture.read.retrying` and
`capture.read.recovered` events (with `capture.read.after.ms` from the frame's start and
`capture.read.retrying.ms`) and `capture.read.retrying.count` and `.ms` totals; the capture page
shows "Camera observation interrupted" for the same time. Find the frames of a
run with:

```sh
jq 'select(.name | startswith("capture."))' data/traces/observing.jsonl
```

### Frame records

Set `VELA_FRAME_RECORDS_PATH` to a JSONL file path and the server appends one line when each
capture attempt settles, whatever the outcome. Unlike the trace journal, it holds the star
statistics of every frame, not only the last three in memory. It is off when the variable is
unset. If a write fails or falls behind by more than 1 MiB, recording stays off until the server
restarts and the server logs why once; capture is never affected. Each line is:

```json
{
  "version": 1,
  "rigId": "fra 400",
  "runId": "f3a1…",
  "attempt": 3,
  "startedAt": "2026-10-17T03:31:00.120Z",
  "settledAt": "2026-10-17T03:31:12.480Z",
  "exposureSeconds": 10,
  "subject": { "targetId": "ngc7000", "name": "North America Nebula", "catalog": "NGC 7000" },
  "outcome": "saved",
  "message": null,
  "provenance": { "requestId": "…", "operationId": "…", "imageId": "…" },
  "image": {
    "id": "…",
    "capturedAt": "2026-10-17T03:31:00.050Z",
    "capturedAtSource": "camera",
    "receivedAt": "2026-10-17T03:31:12.470Z",
    "width": 6248,
    "height": 4176
  },
  "statistics": { "detectedStars": 412, "medianHfrPixels": 2.9 }
}
```

- `runId` identifies the capture run; `attempt` counts from 1 within it, as `capture.frame.index`
  does. `startedAt` and `settledAt` use the Vela server's clock.
- `outcome` is one of the `capture.frame.outcome` values above. `saved`, `unsaved` and
  `save-failed` hold an image. `lost`, `failed`, `uncertain` and `stopped` do not, so `image` and
  `statistics` are null. `message` is why the attempt did not end well, and null for `saved` and
  `unsaved`.
- `provenance` holds the rig service's IDs: the Cria `requestId` Vela minted, the `operationId`
  once Cria admitted it (null if it never did) and the `imageId` once the operation produced one
  (null otherwise). A lost frame keeps all three. It is null when the rig's adapter has no such
  IDs (Alpaca). `requestId` joins to Cria's operation record of the same exposure.
- `image.id` is Vela's ID; `saved-images/<hash>/metadata.json` carries the same `id` and the same
  `provenance`. `statistics` is null when star measurement was unavailable, and a starless frame
  is `detectedStars: 0`.

## Alerts

While a capture run is watched, each alert is an episode with three kinds of span, so a retro can
count them. All carry `alert.rig.id` and `alert.id` (the rule, such as `stars-collapsed`).

- `alert.raised`: the episode began; `alert.level` is `warn` or `critical`. It is written even when
  the phone is not told, because a stronger alert covers it or there are no Pushover keys.
- `alert.cleared`: the episode ended, with `alert.duration.ms` and `alert.acknowledged`.
- `alert.delivery`: one call to Pushover, from request to answer. `alert.delivery.action` is `raise`,
  `clear`, `cancel` (stopping an emergency's repeats), or `test`; `alert.delivery.priority` is the
  Pushover priority; `alert.delivery.status` is `delivered` or `failed`. A failed call has an error
  status and `alert.delivery.reason`, the same text Vela shows as "phone alerts failing". Keys and
  message text are never recorded.

```sh
jq 'select(.name | startswith("alert."))' data/traces/observing.jsonl
```
