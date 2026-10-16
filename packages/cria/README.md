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

Capture downloads the confirmed original before returning its frame. An image 410
is one lost frame and never starts another exposure. A Cria restart leaves an
in-flight operation uncertain with a local hold; nothing is resubmitted.

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
`86624908a57573b4953c2f759713b04d606defcd`. Update it only with the dependency pin.
All tests use fakes or local fixtures and never contact observatory hardware.
