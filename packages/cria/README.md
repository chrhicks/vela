# Cria adapter

`@vela/cria` speaks protocol 5 to the TypeScript Cria service. It owns HTTP/SSE,
wire validation, remote operation outcomes, image transfer, and the mapping to
Vela's current Promise equipment capabilities. It imports no Alpaca implementation.

Composition creates one `createCriaConnection` per origin and shares it across the
origin's configured rigs. `start()` opens the scoped session. Reads also open it
lazily. `close()` releases the stream and background work. Opening starts
interrupted and reconnects quietly. Configuration keeps its existing `expectedName`
keys. A stable Cria device ID selects a device, and the configured expected name
still guards its actual identity. A saved camera's older display name does not
replace that configured identity.

## Readings and commands

`src/v5` contains the protocol client. One SSE stream carries validated snapshots
and operation progress. Three seconds without a snapshot interrupts observation.
Each reading is fresh, stale, or unavailable as Cria reports it. Vela retains the
last accepted device view during an interruption and labels it as last known.
Availability supplies the command-ready state and its reason. Required reads wait
while Cria reports `refreshing`, until its readings postdate the settled operation.
This wait reads the shared snapshot and respects cancellation. The old generation,
read barrier, and age-budget calculations are gone.

`equipment.ts`, `provider.ts`, `readings.ts`, and `mount-control.ts` translate this
client into the capabilities used by today's workflows. Each command maps Cria's
settled Outcome into the existing result or equipment error. There are no thrown
`Cria*Error` classes. Cooling uses `lastCommandedSetpointC`; unsupported setpoint
readback does not erase an acknowledged target. Focuser travel is the inclusive
`minStep..maxStep` window. Axis movement returns Cria's measured `travelledDegrees`.

A motion or exposure is POSTed once. A lost admission reply is looked up. Unknown
admission keeps its execution running with a local hold until lookup or operator
recovery resolves it. Cancel is resent until a 2xx, 404, or 410, and Vela follows
the actual ending. The remote operation has no Vela completion deadline while
snapshots arrive. Cria owns settling, including the mount's bounded stop.

`mount-control.ts` also sends Home (`mount-home`) and Stop (`mount-stop`). A stopped home settles `stopped`
(Cria confirms it from the coordinates, cria#23), so it comes back as `failed` with reason `stopped` and the
mount is not held. Stop is Cria's halt: it is admitted on a busy or held mount, it is never cancelled, and
unanswered for 20 seconds it is `uncertain` with a hold. `mount-home.ts` keeps, in memory, when each mount last
confirmed a home (any home through `equipment.ts` or `mount-control.ts`): `forget` runs on every mount command
except tracking, and when a reading shows the mount slewing.

`switch-control.ts` sends one `switch-set` for a channel of a configured switch and returns the value Cria
confirms. Cria refuses a duty while Auto dew is on, before it sends anything to the box; that refusal comes back as
`failed` with Cria's message. The fake Cria has a PPBA-like switch (Dew A and Dew B duty, Auto dew) for it.

A capture carries its frame type. Cria's `capture` takes `light` (the shutter is
open) and, for a flat or bias, a `frameType` that Cria sets on the camera's INDI frame
type. A dark flat goes as a dark. `frameType` is sent only for a flat or bias, because a
Cria from before that field refuses a request that carries it. Against such a Cria
lights, darks and dark flats still work, and a flat or bias fails with Cria's
refusal before any exposure. Update Cria on the rig to take them. The adapter never
retries a flat or bias as a light, so a calibration frame is never taken under the
wrong type.

Cria exposes a bias at the camera's minimum whatever time is requested, and its returned
`Image.exposureSeconds` still echoes the request. `acquisition.biasExposureSeconds(cameraId)`
gives the time the camera really used: the `exposureMinimum` reading in Cria's current
state, read when called. It throws when that reading is not fresh, and never answers with
the request.

`acquisition.exposureSettings({ cameraId, telescopeId })` reads what the camera is set to from Cria's
current state, when called: gain, offset, binning, pixel size after binning, sensor temperature,
and the last driver-acknowledged setpoint (`lastCommandedSetpointC`; `setpointC` is always
unsupported under INDI). With a `telescopeId` it adds the mount's pier side, `east` or `west`.
Each value is present only when its reading is fresh and supported. A pixel size needs the binning
that scales it, so it is omitted with the binning. A mount that cannot be read, or reports
`unknown`, costs only the pier side. A camera that cannot be read rejects the call. It answers
from the latest fresh readings and does not wait for the refresh that follows an exposure, so a
frame is not held up by it.

Capture downloads the confirmed original before returning its frame. An image 410
is one lost frame and never starts another exposure. A Cria restart leaves an
in-flight operation uncertain with a local hold; nothing is resubmitted.

## Journal

Set `VELA_CRIA_JOURNAL_PATH` and the server appends what the client decodes to one JSONL
file, so a night can be replayed against Cria's own record. It is off when unset. The
client writes at the decoded boundaries only. It never clones a `fetch` response or adds
a second reader of the event stream. One line per entry, each with the `origin` and a
millisecond `at` on the Vela server's clock.

- `exchange` is one request with its reply. It holds the method, route, HTTP status
  (null when no response came) and, for an operation, the `requestId`, device, command kind
  and parameters. The reply is `answered` with its decoded body (an operation, including an
  image descriptor), `refused` with Cria's error code and message, or `lost`. A download
  keeps only its byte count.
- `image` says whether a fetched original matched the size and SHA-256 its descriptor
  promised: `intact`, `damaged`, `gone` or `failed`. The bytes are never kept.
- `state` is written for every snapshot that arrives, with `generatedAt`, `sequence` and
  the arrival time `at`, so a quiet stream shows as a gap. `changed` holds only the cells
  that differ from the previous entry (`device/<id>/readings.<field>`,
  `device/<id>/availability`, `operation/<id>`), and `removed` the keys that went away.
  A reading's `observedAt` alone is not a change. The first entry after a start has
  `baseline: true` and lists every cell.
- `stream` marks the event stream opening and ending, with the reason it ended.

The token and request headers are never written. The journal is a sink the client calls and
forgets. `record` returns at once, a throwing sink is ignored, and the file sink queues at most
4 MiB, appends at most 256 MiB per process, and turns itself off for good on its first failure
(a full or slow disk, an unwritable path). The server logs why once. Capture and the
event stream behave the same with it off, failing or stalled.

## Holds and recovery

`holds()` projects both Cria quarantine and Vela-local uncertainty. Composition
passes it to the server's rig lease, which refuses all lease-taking work while any
hold exists. Device details and capture show its reason. `recover(deviceId, note)`
pins the current hold and calls the recovery client after a person checks the
hardware. It takes no rig lease, so it can fence an execution still awaiting
admission. See the [cutover checklist](../../docs/observing/protocol-5-cutover.md)
for the temporary server route and the rig session.

## Verification

```sh
pnpm exec vitest run packages/cria/test
pnpm --filter @vela/cria test:types
pnpm exec vitest run apps/server/tests/cria-protocol5.test.ts
```

`test/v5/fake-cria.ts` is the typed HTTP/SSE fake used by the client and server
route scenarios. The golden corpus comes from Cria commit
`f82674d6efbc56c3f71e9533968d1f73590919fa`. Update it only with the dependency pin.
All tests use fakes or local fixtures and never contact observatory hardware.
