# Equipment composition

`composition.ts` selects the server adapter for an explicitly configured rig.
Capture, autofocus, framing and alignment keep their existing Vela controllers;
they receive acquisition, focuser, cooling and framing factories with the full
rig record. Inventory, inspection and connection use the same selection.

Only `composition.ts` chooses a mode. Routes and rig helpers take capabilities as
arguments and never import `@vela/alpaca` or `@vela/cria`. The
`no-restricted-imports` rule in `.oxlintrc.json` enforces this outside tests.
Its other exceptions, and when each goes:

- `rig/discovery.ts` stays. Discovery is Alpaca's own UDP scan; it turns replies
  into rig candidates and chooses no mode.
- `app.ts` maps `AlpacaProviderError` when a rig is added. It goes when connect
  and inspection move onto the rig's devices (migration PR 9).

A catalog record without `source` uses Alpaca. A record with
`source: { kind: cria, configurationId: … }` uses only that Cria configuration.
Missing configuration, authentication failure or interrupted Cria service never
falls back to Alpaca. Alpaca discovery cannot match or migrate a Cria record.

## Explicit Cria configuration

Set `VELA_CRIA_CONFIG_PATH` to a server-readable JSON file. Keep its token in the
environment variable named by `tokenEnv`, with at least 32 characters. Omit
`tokenEnv` for a Cria that runs without `CRIA_TOKEN` (private network only); Vela
then sends no bearer header. No token is
stored in the rig catalog or sent to the browser. URLs must be HTTP(S) origins
without credentials, paths, queries or fragments. Use the exact configured device
IDs, kinds and expected operational names.

```json
{
  "rigs": [
    {
      "id": "fra-cria",
      "name": "FRA 400 · Cria",
      "url": "http://rig-host:4319",
      "tokenEnv": "VELA_FRA_CRIA_TOKEN",
      "devices": [
        { "id": "camera", "kind": "camera", "expectedName": "Configured camera name" },
        { "id": "mount", "kind": "mount", "expectedName": "Configured mount name" },
        { "id": "focuser", "kind": "focuser", "expectedName": "Configured focuser name" }
      ],
      "imagingCameraId": "camera",
      "focalLengthMm": 400,
      "alignment": { "mode": "physical", "cameraId": "camera", "telescopeId": "mount" }
    }
  ]
}
```

The example contains placeholders, not qualified equipment bindings. Configuration
does not transfer driver ownership or start Cria. Establish its equipment ownership
separately before connecting Vela. The temporary recovery route records a person's
explicit confirmation after checking the device.

The rig ID also identifies its server configuration. Startup adds a missing
configured rig and seeds an explicit imaging camera and focal length only when
those selections are absent. Existing saved selections remain intact. The initial
observed inventory is empty until Cria supplies observations. To remove a managed
rig permanently, remove its configuration and forget the catalog record; a
configuration that remains present will recreate a forgotten rig at startup.

Provider IDs include the configuration ID and device ID, so two
services' local `camera` IDs cannot collide. A device at one service origin may
belong to only one configured rig. Multiple disjoint bindings on the same service
share one authenticated client and state stream. Application startup starts those
streams; shutdown closes them and cancels reconnects. A Cria restart (a new
instance) leaves in-flight work uncertain with a local hold. A person checks and
recovers the device before starting another workflow against the new instance.

`imagingCameraId`, `focalLengthMm` and `alignment` are optional. Alignment additionally
requires `VELA_ASTAP` and `VELA_STAR_CATALOG`; optional
`VELA_ALIGNMENT_DIAGNOSTICS_PATH` applies to both adapters. Cria alignment selects
the exact rig ID and named bindings, rather than matching a synthesized Alpaca
endpoint. `offline` mode remains explicitly available for simulator fixtures.
Existing `VELA_ALIGNMENT_ENDPOINT`, device-ID and mode settings continue to select
legacy Alpaca alignment.

Explore framing needs an imaging camera, the effective focal length, and the
server's `VELA_ASTAP` executable and `VELA_STAR_CATALOG` directory. It does not
require an alignment configuration. Use absolute solver paths when launching from
a different checkout; missing solver configuration leaves browsing available and
explains why framing actions are unavailable.

## Observations and operations

The normalized contracts live in `@vela/equipment`. Cria transport and wire
validation and the Promise capability adapters live in `@vela/cria`. A successful HTTP response is not proof of
fresh device readings. Inspection carries observation state and command readiness;
page projections preserve last-known values and their age while commands require
the facts relevant to their operation. Workflows already running retain their
context while their acknowledged operation is observed or cancelled.

Browser polling still reads Vela-owned projections: capture progress, saved
selection, framing results and equipment presentation. These reads share the
Cria stream rather than issuing new service state requests. Navigation reads
only the catalog and controller snapshots. Streaming Cria observations does not
replace delivery of those separate Vela projections to the browser.

The server owns capture repetition, focus decisions, plate solving, alignment
geometry, image analysis, previews, FITS and saved images. Cria owns the physical
operation and its cancellation/completion evidence. Shared confirmed-stop errors
are translated into the existing controller outcomes; request abortion alone is
not reported as physical cancellation.

## Fixture verification

The protocol 5 client and server routes use a typed HTTP/SSE fake. No fixture
requires a separate .NET process or a rig connection.

```sh
pnpm exec vitest run packages/cria/test
pnpm exec vitest run apps/server/tests/cria-protocol5.test.ts apps/server/tests/cria-composition.test.ts
```

These checks cover admission loss, cancellation, restart uncertainty, image loss,
hold-aware admission, and operator recovery. They do not qualify physical drivers,
polar-alignment accuracy, or a sky/focus model. The separate
[cutover checklist](../../../../docs/observing/protocol-5-cutover.md) covers the
session with Chris present.

Composition supplies `holdsOf` to `createRigOperations`. Any hold refuses new
lease-taking work and supplies its reason to the page and refusal. The temporary
`POST /api/rigs/:rigId/devices/:deviceId/recover` takes no lease. It requires
`{ externalRecoveryConfirmed: true, note }` and calls the Cria recovery client,
including its fence for an unknown admission. PR 8 replaces this route.

Your Rig mount controls receive a separate `MountControl` capability at this same
composition boundary. The server validates the rig-scoped device identity and
claims the rig operation lane for one explicit Unpark or tracking command.
Commands survive a browser disconnect and never chain or replay. Alpaca retains
the lane while its result is uncertain. Cria releases the settled command's lane
and keeps the rig blocked through its hold until recovery. Fresh stationary adapter observations can resolve
that uncertainty without another write. The existing detail projection carries
action readiness and the latest command identity/outcome to every browser.

A browser with a lost mount-command response can explicitly check its request ID.
The check only reads equipment: it retires an unseen ID before inspection, so a
delayed original request cannot later issue its write. It preserves an admitted
command and any other browser's current command; ordinary refresh does not retire
requests or submit commands. These admission markers last only for this server
process, like the command state itself. Each request also carries the Vela server
instance identity from its control view: a new instance rejects an old write and
reports the old admission as unknown, rather than claiming it never happened.
