# Polar alignment

The default offline integration connects the approved alignment interface to the local
simulated rig through ordinary Alpaca acquisition and real ASTAP image solves.
It is an explicitly configured synthetic-clock workflow, not yet a physical-rig
polar-alignment implementation. No generator state or true offsets enter the
server's measurement path.

`routes.ts` composes the configured acquisition adapter, ASTAP boundary and
server-owned controller. `controller.ts` takes three solved positions, constructs
a baseline, and then solves fresh exposures to measure physical adjustments.
`geometry.ts` operates on solved sightlines and observed sidereal angles;
`solver.ts` owns FITS, the bounded external process and WCS. `../imaging/preview.ts` stretches
only the display copy. Solver input retains original integer pixels.

The operation remains active across browser disconnects. Stop cancels the current
acquisition, movement or solver and waits for cleanup. Failed physical commands
are not replayed. Only a genuine no-solution starts another exposure automatically;
transport, invalid data, unsupported capabilities and subprocess errors stop the
operation. The last solved preview, measurement and timestamp remain together.
Restart takes a completely new baseline. Server restart interrupts the operation;
there is no durable execution or recovery.

## Explicit physical trial

`VELA_ALIGNMENT_MODE=physical`, together with the existing endpoint, camera ID,
telescope ID and ASTAP configuration, enables the bounded physical path for that
rig. The saved imaging camera must match the configured ID, and its operational
name is checked before each exposure. The saved effective focal length and
observed pixel size, binning and subframe determine the ASTAP field. Color Bayer
pixels remain intact for solving; the preview is debayered for display.

Prepare a clear view around the home position and the movement corridor before
Start. Every physical attempt first homes the mount, confirms completion, and
restores tracking before settling and taking the first image. Stop and failures
leave the mount where it stopped; only a new attempt homes again. A small primary-axis probe establishes the
driver's mechanical sign; the subsequent two positions are approximately 18°
and 36° westward in RA. Each step accepts 16–20° of observed travel rather than
requiring a precise motor endpoint, so allow up to 40° total westward travel.
Allow 1° on either side for the direction check. Motion
uses primary-axis `MoveAxis` only, in bounded increments with observed progress;
coordinate slews could move DEC to compensate a pointing model and are unsuitable
for this baseline. A rejected, ambiguous or unexpected move ends the measurement
without replay. Stop waits for the acquisition adapter's stop confirmation.
The acquisition adapter allows up to five seconds after an accepted stop command
for the driver to report motion stopped. Before each physical exposure, alignment
waits two seconds for settling and rechecks mount state; this initial settling
allowance does not claim to measure vibration. Cancellation interrupts that pause.
The mount remains at the last observed position, with tracking enabled after successful preparation. An interrupted or failed
homing may leave tracking off; Vela does not claim it was restored.

This trial requires topocentric mount coordinates, a northern site (0–85°),
an idle unparked mount, and sidereal tracking with zero RA
and DEC rate offsets. Unsupported observations are not treated as success.
Tracking, changes between known pointing sides, site and unexpected pointing changes are checked around
capture/motion and again before publishing a result. Camera geometry changes
require a fresh baseline. Do not move the mount through another controller
during measurement. Only the altitude and azimuth adjustments belong in the
adjustment phase.

ASTAP's J2000 sightline is converted to the apparent equator/equinox of date at
exposure midpoint, paired with actual local apparent sidereal time. The fitted
correction target is converted back to J2000 before WCS projection. The interface
continues to show exposure *start* and its camera/server-estimate provenance,
not midpoint or solve completion. One second of timing uncertainty corresponds
to about 15 arcseconds of Earth rotation; server-estimated exposure starts do
not establish precision at that scale.

Use a high, clear field for the first outdoor trial. Independent ERFA fixtures
validate coordinate conversion, ideal pole recovery and image projection, and
device-boundary tests validate both mechanical signs and interrupted state.
They do not establish outdoor accuracy, atmospheric refraction, flexure, or the
actual mount's motion response. Direction and repeatability require a prepared
physical-rig trial. The configured offline path remains available separately.

## Offline configuration and local review

Configure the endpoint and stable device IDs deliberately. The first model uses
northern latitude, the simulator's fixed catalog frame (`EquatorialSystem=J2000`, synthetic sidereal clock),
2-second mono exposures, a 3-degree camera field, and a prepared baseline near RA 12°, 30° and 48° at nominal Dec 60°. Reset the simulator
after target framing before starting this workflow. Axis movement uses
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
