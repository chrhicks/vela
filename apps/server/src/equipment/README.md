# Equipment composition

`composition.ts` selects the server adapter for an explicitly configured rig.
Capture, autofocus, framing and alignment keep their existing Vela controllers;
they receive acquisition, focuser, cooling and framing factories with the full
rig record. Inventory, inspection and connection use the same selection.

A catalog record without `source` uses Alpaca. A record with
`source: { kind: cria, configurationId: … }` uses only that Cria configuration.
Missing configuration, authentication failure or interrupted Cria service never
falls back to Alpaca. Alpaca discovery cannot match or migrate a Cria record.

## Explicit Cria configuration

Set `VELA_CRIA_CONFIG_PATH` to a server-readable JSON file. Keep its token in the
environment variable named by `tokenEnv`, with at least 32 characters. No token is
stored in the rig catalog or sent to the browser. URLs must be HTTP(S) origins
without credentials, paths, queries or fragments. Use the actual service's
`storeId` and exact configured device IDs, kinds and expected operational names.

```json
{
  "rigs": [
    {
      "id": "fra-cria",
      "name": "FRA 400 · Cria",
      "url": "http://rig-host:4319",
      "tokenEnv": "VELA_FRA_CRIA_TOKEN",
      "storeId": "11111111-1111-4111-8111-111111111111",
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
separately before connecting Vela. Vela does not configure or attest external recovery.

The rig ID also identifies its server configuration. Startup adds a missing
configured rig and seeds an explicit imaging camera and focal length only when
those selections are absent. Existing saved selections remain intact. The initial
observed inventory is empty until Cria supplies observations. To remove a managed
rig permanently, remove its configuration and forget the catalog record; a
configuration that remains present will recreate a forgotten rig at startup.

Provider IDs include the configuration ID, Cria store ID and device ID, so two
services' local `camera` IDs cannot collide. A device at one service origin may
belong to only one configured rig. Multiple disjoint bindings on the same service
share one authenticated client and state stream. Application startup starts those
streams; shutdown closes them and cancels reconnects. A replacement Cria store
requires explicit configuration; it is not accepted as the previous service.

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
validation live in `@vela/cria`; `../cria` maps its observations and bounded
operations into those capabilities. A successful HTTP response is not proof of
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

The separate Cria repository provides `dotnet/tests/serve_fixture.py`, which
starts a persistent loopback service containing only fixture workers. Its private
`connection.json` is consumed by this opt-in integration check:

```sh
pnpm --filter @vela/equipment build
pnpm --filter @vela/cria build
pnpm --filter @vela/server exec tsx scripts/check-cria-fixture.ts /path/to/connection.json
```

The check rejects non-loopback and non-fixture connections. It verifies original
pixel layout, cooling, focus, coordinate conversion, axis motion, confirmed
cancellation and actual Vela capture routes through preview/FITS/archive. Focus,
cooling and pointing test movements are restored. Use a dedicated fixture while
it runs; it does not coordinate with another active browser operation.

The current Cria fixture camera produces a mono ramp, not a star field. Browser
capture and cooling checks use that real service; focus analysis and plate solving
must honestly report insufficient image data. Deterministic controller tests prove
their workflow behavior separately. These checks do not qualify physical ASCOM
drivers, polar-alignment accuracy, or a sky/focus model.
