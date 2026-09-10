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
