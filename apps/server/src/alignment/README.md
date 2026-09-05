# Offline polar alignment

This first integration connects the approved alignment interface to the local
simulated rig through ordinary Alpaca acquisition and real ASTAP image solves.
It is an explicitly configured synthetic-frame workflow, not yet a physical-rig
polar-alignment implementation. No generator state or true offsets enter the
server's measurement path.

`routes.ts` composes the configured acquisition adapter, ASTAP boundary and
server-owned controller. `controller.ts` takes three solved positions, constructs
a baseline, and then solves fresh exposures to measure physical adjustments.
`geometry.ts` operates on solved sightlines and observed sidereal angles;
`solver.ts` owns FITS, the bounded external process and WCS. `preview.ts` stretches
only the display copy. Solver input retains original integer pixels.

The operation remains active across browser disconnects. Stop cancels the current
acquisition, movement or solver and waits for cleanup. Failed physical commands
are not replayed. Only a genuine no-solution starts another exposure automatically;
transport, invalid data, unsupported capabilities and subprocess errors stop the
operation. The last solved preview, measurement and timestamp remain together.
Restart takes a completely new baseline. Server restart interrupts the operation;
there is no durable execution or recovery.

## Configuration and local review

Configure the endpoint and stable device IDs deliberately. The first model uses
northern latitude, the simulator's fixed catalog frame (`EquatorialSystem=Other`),
2-second mono exposures, a 3-degree camera field, and a prepared baseline near RA 12°, 30° and 48°. Axis movement uses
1.5 degrees/second with observed pointing for the first position. These assumptions must not silently carry over to physical
rigs: epoch conversion, mount direction, field calibration and actual device
validation are future work. The ordinary app leaves alignment unavailable unless
an endpoint is configured.

Start the simulator and controls as documented in `apps/rig-simulator/README.md`.
After building `@vela/model`, `@vela/alpaca` and `@vela/server`, start a review server:

```sh
PORT=3002 \
VELA_RIG_CATALOG_PATH="$PWD/apps/rig-simulator/.local/review-rigs.yaml" \
VELA_ALIGNMENT_ENDPOINT=http://127.0.0.1:7850 \
VELA_ALIGNMENT_CAMERA_ID=vela-simulator-camera \
VELA_ALIGNMENT_TELESCOPE_ID=vela-simulator-telescope \
VELA_ASTAP=/absolute/path/to/astap_cli \
VELA_STAR_CATALOG=/absolute/path/to/catalog \
node apps/server/dist/server.js
```

Use an isolated review catalog to keep the saved physical rigs unchanged. Start
Vela with `API_PROXY_TARGET=http://127.0.0.1:3002 pnpm --filter @vela/web exec vite
--host 127.0.0.1 --port 5178`. Add `127.0.0.1:7850` through the normal Add rig
flow, connect its devices, then follow Observe → Polar alignment.

In the separate simulator controls, select Large error and reset before starting.
Keep offsets still during the three-position baseline. Once readings appear,
lower the altitude and move azimuth east toward zero. There is a three-second
adjustment window between exposures; the simulator rejects mount adjustments
during exposure. Fine steps support the final approach. Obscure the camera to
exercise failed solves, then clear it to recover. Stop before resetting or
repositioning; Measure again takes a fresh baseline. Finish keeps the final
measurement for reference without claiming an automatic alignment threshold.

The interface preserves the approved workshop hierarchy and fixed 20-arcminute
crop, using actual captured pixels and WCS target coordinates. Its reference is
the optical center, not an invented detected star. Readings report capture age,
not the time a cached preview finished loading.

## Validation limits

Default tests use deterministic device/process boundaries and independent
analytic geometry. The opt-in simulator HTTP proof uses external catalog and
ASTAP assets. The renderer and solver share a catalog; this verifies integration
and ideal geometry rather than outdoor precision. There is no atmospheric,
mechanical-flexure or mount-calibration claim.
