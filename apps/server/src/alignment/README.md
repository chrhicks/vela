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
are not replayed. Measurement reads retry transport failures every three seconds
until recovery or Stop, preserving the baseline, last solved image and its original
timestamp. The interface marks the device connection interrupted and asks the
operator to pause adjustments until a fresh measurement arrives. Read-only pointing
and validation are retried in place; preparation and motion are never replayed.
A no-solution starts another exposure. Known transport read failures during an
acknowledged exposure retry inside acquisition without replacing that exposure.
The controller shows `retrying`, clears the exposure timer, and preserves its
baseline and timestamped last measurement; recovered reads restore `exposing`
and the original timer but do not publish a measurement. A fresh capture attempt
is allowed only when the adapter explicitly reports a safe pre-start failure.
That retry refreshes and validates the mount observation and solve hint before
requesting exposure. Preparation and motion are not repeated. Lost command responses, failed cleanup, invalid data,
unsupported capabilities and subprocess errors still stop the operation.
The latest acquired full-frame preview is published during baseline
measurement before solving, including frames that cannot solve. Its exposure
timestamp and baseline position are separate from the last solved preview,
measurement and timestamp, which remain together. Image retention is bounded
and preserves the last solved image through repeated unsuccessful exposures.
Restart takes a completely new baseline. Server restart interrupts the operation;
there is no durable execution or recovery.

## Explicit physical trial

`VELA_ALIGNMENT_MODE=physical`, together with the existing endpoint, camera ID,
telescope ID and ASTAP configuration, enables the bounded physical path for that
rig. The saved imaging camera must match the configured ID, and its operational
name is checked before each exposure. The saved effective focal length and
observed pixel size, binning and subframe determine the ASTAP field. Color Bayer
pixels remain intact for solving; the preview is debayered for display.

Prepare a clear view around home, the starting field and the movement corridor
before Start. Every physical attempt first homes the mount, confirms completion,
and restores tracking, then slews to Dec +80° and RA equal to local sidereal time
plus 130°. This consistent starting field is outside the baseline; preparation
does not change the mount's altitude or azimuth knob adjustments. A view along
the mechanical pole cannot establish a rotation baseline. The preparation endpoint
is checked before the reference is set. Stop and failures leave the mount where
it stopped; only a new attempt homes again.

A nominal 0.25° primary-axis probe establishes the driver's mechanical sign. The two
baseline legs each target roughly 54° westward in RA, accepting 54–60° of observed
final travel per leg, including the probe's displacement. Allow up to 120° total
westward travel and 1° on either side for the direction check. The starting field
leaves a nominal margin of at least 10° before the meridian after that travel at
preparation time; this margin shrinks as time passes while tracking.

Each leg uses one continuous primary-axis `MoveAxis` rotation at 1° per second,
with a feedback stop based on observed RA travel and a bounded timeout. The
slower rate leaves room for delayed position reads and stopping travel within
the same endpoint corridor; two nominal legs take about two minutes plus imaging
and settling. A deadline covers in-flight requests, not just the gap between
polls. It bounds the software operation but does not guarantee instantaneous
physical stopping. Coordinate
slews could move DEC to compensate a pointing model and are unsuitable for this
baseline. A rejected, ambiguous or unexpected move ends the measurement without
replay. Stop waits for the acquisition adapter's stop confirmation. The acquisition
adapter allows up to five seconds after an accepted stop command for the driver
to report motion stopped. Before each 2-second physical exposure, alignment waits
three seconds for settling and rechecks mount state; this settling allowance does
not claim to measure vibration. Cancellation interrupts that pause. The mount
remains at the last observed position, with tracking enabled after successful
preparation. An interrupted or failed homing may leave tracking off; Vela does not
claim it was restored.

This trial requires topocentric mount coordinates, a northern site (0–85°),
an idle unparked mount, and sidereal mode with zero RA
and DEC rate offsets. Tracking may be off when preparation begins because Home
can turn it off and preparation restores it. Tracking must be confirmed enabled
after preparation and throughout measurement. Unsupported observations are not treated as success.
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

## Adjustment geometry

There is no fixed five-degree correction cutoff. Finite-value, usable-baseline,
local sensitivity and final fit checks determine whether the calculation can
produce a result. Azimuth rotation preserves a sightline's elevation, so a
single new sightline can admit two altitude solutions. The iterative update
must stay on the local inverse branch established by its baseline estimate;
a numerical jump across that elevation fold is rejected rather than displayed
as a different physical correction.

This is a local adjustment model, not proof that arbitrary large physical knob
movements are uniquely recoverable from one image. A new three-position baseline
is needed when the local model becomes ambiguous. Independent ideal fixtures
exercise corrections beyond five degrees, including twenty-degree corrections
at the physical starting declination, and a known alternate-root rejection.
They do not establish absolute outdoor accuracy.

## Offline configuration and local review

### Opt-in diagnostic evidence

Set `VELA_ALIGNMENT_DIAGNOSTICS_PATH` to an absolute local directory to retain
replayable evidence for each new alignment trial. It is off by default. With
`pnpm dev:observing`, the same setting in `.env.observing.local` may be relative
to the repository root; the launcher resolves it before starting the server.

Each trial has its own directory and retains:

- the three successfully solved baseline exposures as original-sample FITS;
- the latest successfully solved adjustment exposure as FITS;
- a bounded numerical journal containing the run identity/mode, exposure start
  and provenance, geometry midpoint, exact solved centers/full WCS, hints,
  baseline inputs, calculated corrections and final outcome;
- for physical trials, the site, camera geometry and existing mount observations
  before/after capture and before a correction is published. Recording does not
  introduce another device read or command.

Earlier adjustment originals are replaced as later solved images arrive; their
numerical records remain. The three baseline originals remain throughout the
trial. An acquired image is recorded only after it solves, so a failed solver or
preview does not imply that its original was retained. A recorded calculation
is distinct from a published reading: later validation/projection or cancellation
can still end the operation.

The journal is limited to 4 MiB and each FITS to 128 MiB. Successful recording keeps
at most four retained originals per trial (roughly 400 MiB at FRA resolution);
replacing an adjustment image needs space for one more, which may remain after an
interruption or storage failure. A storage or recording
limit failure is reported in the server log and disables further diagnostics for
that trial while the observing operation continues. A missing final record means
the diagnostic record is incomplete, not a successfully finished trial.

Previous trial directories are never pruned automatically. Keep the ones needed
for comparison and remove them explicitly when finished. Disable the setting
after the diagnostic session to avoid accumulating new bundles. These files are
evidence, not resumable operations or a user-facing alignment history.

After building the server, replay a trial without hardware or another solver run:

```sh
pnpm --filter @vela/server build
node scripts/replay-alignment.mjs /absolute/path/to/trial-directory
```

Replay validates the recorded input and retained FITS integrity, reconstructs the
baseline, recomputes its corrections and reports numerical discrepancies. Physical
trials also replay J2000-to-midpoint conversion from the recorded site and timing.
It uses Vela's production mathematics: this establishes reproducibility, not an
independent physical alignment measurement. A simulator can exercise recording
and replay indoors; a fresh sky comparison is still required for physical accuracy.

### Simulator setup

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

Route tests inject the acquisition, framing, physical alignment, solver and controller
factories at composition. Controller tests inject the next-exposure pause and preview
renderer, retaining real cancellation and image rendering without replacing modules.
Independent coordinate fixtures are parsed as exactly three baseline samples before use.

Default tests use deterministic device/process boundaries and independent
analytic geometry. The opt-in simulator HTTP proof uses external catalog and
ASTAP assets. The renderer and solver share a catalog; this verifies integration
and ideal geometry rather than outdoor precision. There is no atmospheric,
mechanical-flexure or mount-calibration claim.
