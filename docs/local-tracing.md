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
