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
including its fence for an unknown admission. It answers 200
`{ outcome: 'confirmed', found }`, or 409 `{ error, reason }` where `error` is
`device-busy` (Cria refused because an operation is open on the device) or
`recovery-failed`, and `reason` is the message for a person. Rig detail marks a
held device with `observation.hold` (`deviceId` is the id this route takes), and
the Equipment page's Clear hold button calls it. PR 8 replaces this route.

Your Rig mount controls receive a separate `MountControl` capability at this same
composition boundary. The server validates the rig-scoped device identity and
claims the rig operation lane for one explicit Unpark or tracking command.
Commands survive a browser disconnect and never chain or replay. Alpaca retains
the lane while its result is uncertain. Cria releases the settled command's lane
and keeps the rig blocked through its hold until recovery. Fresh stationary adapter observations can resolve
that uncertainty without another write. The existing detail projection carries
action readiness and the latest command identity/outcome to every browser.

Home is one more command of that lane (`action: 'home'`). It is sent to Cria as `mount-home` and the request
stays open until Cria settles it, up to Cria's three-minute bound, while the detail projection shows
`command.state: 'pending'` to every browser. The AM5 reports no at-home state, so Vela cannot read "at home".
`MountControlView.homeConfirmedAt` is instead the time the last home settled `confirmed` through Vela, kept in the
Cria equipment's memory (`packages/cria/src/mount-home.ts`). A restart of Vela forgets it, and so does any
`mount-slew`, `mount-axis`, `mount-rotate` or another `mount-home` that Vela sends, or a slew its readings catch
in progress. A change of tracking does not: tracking on does move the RA axis, so the time says when Vela last saw
a home confirmed, not that the mount is still there. A home that Cria cannot confirm leaves the mount held; once
fresh readings show it idle again, the command resolves to `failed` ("Home is not confirmed"), never `confirmed`,
because no reading can tell. Home needs an idle, unparked mount that reports `canFindHome`.

Stop is not a command of that lane. `POST /api/rigs/:rigId/mount/stop` takes `{ deviceId }` and answers
`{ outcome: 'confirmed' | 'failed' | 'uncertain', message }`. It takes no request ID or server instance, claims no
lane, inspects nothing and records nothing in `command`, so none of these can stand between Stop and the mount: not a
pending home or other command of the panel, not an uncertain one, not a restart of Vela, not a hold. It is
allowed while capture, alignment, autofocus or framing holds the rig, and it interrupts a run that is moving the
mount, because a Stop that cannot reach a slewing mount is worse than one that ends a run; that run reports its own
stop. It is sent to Cria as `mount-stop`, which Cria admits on a busy or held mount, and a stopped home settles
`stopped` and does not hold the mount (cria#23). Sending it twice only stops motion twice. `MountControl.canStop`
says whether the rig's adapter reaches a mount at all (Cria does, Alpaca does not), since the readings that other
actions need are absent while Cria runs the home. `stop.enabled` is false only for a mount that is not connected,
that Vela cannot stop, or that is known to be still (parked, or idle with tracking off); unknown readings, a
slew, tracking or any command of the panel in flight leave it on.

A browser with a lost mount-command response can explicitly check its request ID.
The check only reads equipment: it retires an unseen ID before inspection, so a
delayed original request cannot later issue its write. It preserves an admitted
command and any other browser's current command; ordinary refresh does not retire
requests or submit commands. These admission markers last only for this server
process, like the command state itself. Each request also carries the Vela server
instance identity from its control view: a new instance rejects an old write and
reports the old admission as unknown, rather than claiming it never happened.

Dew heaters are a second, narrower capability at the same boundary: `createSwitchControl(rig)` returns a
`SwitchControl` for a Cria rig and nothing for an Alpaca rig, so an Alpaca rig has no dew section.
`apps/server/src/rig/dew-control.ts` adds `dewControl` to the rig detail view of a switch device that has dew channels,
and `POST /api/rigs/:rigId/dew` (`{ deviceId, requestId, serverInstanceId, action }`) with `/dew/check`, which work
as the mount routes do: one request ID admitted at most once, a check that retires an unseen ID without a write, a
new server instance that refuses an old page. The action is `{ kind: 'auto', on }` or
`{ kind: 'duty', channelId, percent }` with `percent` from 0 to 100; anything else is a 400 and nothing is read. Vela
picks the channels from the names Cria gives the PPBA: `Auto dew` and the `Dew ... duty` channels (`Dew A duty (%)`). The
box's binary `Dew A` and `Dew B` outputs (0 or 1) are not duties and are not offered, so a channel id that is not one
of those is a 404 and the power outputs and USB are unreachable. Auto dew is written as 1
or 0 to its channel; a duty goes to its own channel.

Each dew channel in the view carries `minimum`, `maximum` and `step`, which Cria reports per channel (the PPBA's duties
step by 10; 0, 100 and 1 when the box does not say). A duty that is not `minimum` plus a whole number of steps is a
400 `invalid-dew-duty` whose message gives the allowed step, and nothing is sent: Cria would refuse it anyway.

The command does not take the rig operation lane: a capture run needs the heaters on and nothing in it moves the
rig. A second command for the box is refused while one is in flight. While Auto dew is on the box sets the duty itself,
so every duty control is disabled with "Auto dew is on" (an unknown Auto dew state disables them too). Cria confirms
a duty by what the box holds, which can differ a little from the request (10 % reads back as 9.8 %), so a confirmed
duty reports the held value. An unknown outcome stays `uncertain` and nothing is sent again; Cria holds the box, and
once fresh readings (no hold) show the requested duty within 0.4 points or the Auto dew state asked for, the command
resolves to `confirmed`, otherwise to `failed`. A box that is disconnected has no channel readings, so it has no dew
section.
