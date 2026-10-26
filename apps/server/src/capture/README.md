# Capture

Capture owns one server-side capture run and its most recent image. A run takes
one exposure, repeats the requested duration until stopped, or repeats until it
has finished a requested number of frames. Browser requests
start the work and read its projection; disconnecting the browser does not stop
acquisition. A server restart ends the operation and loses in-memory previews, and the run
is reported as interrupted (see [Restarts](#restarts)); explicitly saved images remain
available through the saved-images boundary.

The imaging-camera setup API remembers an explicitly selected camera in the
Rig catalog by stable provider ID and its reported camera name. An inventory
camera is never selected automatically. A missing identity or changed reported
name requires explicit reselection for Alpaca. Cria matches the saved camera by
its stable device ID and checks the actual name against `cria.json` instead.
A different device in the configured slot is not silently accepted.

The Observe chooser is the setup path. It replaces the temporary
`VELA_CAPTURE_ENDPOINT` / `VELA_CAPTURE_CAMERA_ID` environment configuration;
previously environment-configured rigs need one explicit choice in Observe.
Route
composition acquires the same Rig operation lease used by alignment and
connection commands before checking the selected identity and connection. The lease
lasts across every exposure and through final acquisition cleanup. Device protocol preconditions and abort
confirmation belong to the selected equipment adapter.

For Cria rigs, the server composition provides the same acquisition and cooling
capabilities. Cria performs one exposure and holds the original among its newest
images. Vela fetches it right after the capture succeeds and verifies the image
identity, checksum, byte length and geometry before accepting pixels. Vela then owns
preview creation, FITS, the saved-image gallery and repetition. A failed transfer
ends the run without requesting another exposure; so does a failed Keep write. If
Cria has already dropped the image, the frame is lost: the run ends and says so.

The controller depends on `CaptureCamera`, not a concrete transport. A successful
frame publishes its own exposure settings, acquisition start timestamp and
receipt timestamp, and star measurements from its linear samples. Dimensions,
detected-star count and median HFR remain attached to that image. An unavailable
analysis never discards the acquired image; see [image processing](../imaging/README.md)
for measurement limits. Later pending, failed or stopped exposures retain that image and its
metadata. The run count increments only when an image is published and resets
on each start. During an acknowledged exposure, the adapter retries known transport
read failures in place without another exposure command. The controller projects
`captureReadState` independently of exposing/reading, including in navigation.
Read recovery is not image completion: it preserves the last image, count and lease.
Stop clears the interruption indicator immediately and still waits for cleanup;
late callbacks cannot update a cancelled or settled acquisition.
A stop request needs no body, so `curl -X POST .../capture/stop` stops the run. A bare POST, an
empty body or `{}` is accepted under any content type except `text/plain`, and every other
request is refused with 400, a `text/plain` one included. A refused stop leaves the run going, as
every other Vela command refuses unknown fields. The same rule covers autofocus stop, alignment
stop and finish, and framing stop; `../http/halt-body.ts` holds it.
Any terminal acquisition or preview failure ends the run without replay. Preview stretching preserves native dimensions for 100% inspection;
only the latest three image pairs and their temporary original FITS buffers remain
in memory. Saving releases the temporary FITS buffer after the saved-image store confirms
the write. Keep is a gallery selection. This bounded cache lets Keep this image target the displayed frame when
browser image loading trails the latest acquisition. An expired unsaved frame
returns an explicit unavailable result; it never saves a different frame instead.

Unbinned Bayer frames are bilinearly debayered at native dimensions. A shared
asinh display stretch uses sampled black/white points across sensor phases;
this is a viewing aid, not calibrated color processing. Acquisition samples
are unchanged. Preview computation yields between row batches and compression
runs asynchronously to keep the server responsive with full-resolution frames.
Frames larger than 1600 pixels on their longest edge also receive an averaged
fitted preview. Observe and Fit load that smaller image; 100% requests the native
PNG and stays fitted until the native image is available. Image metadata always
describes the original exposure and its native dimensions.

Stop waits for confirmed cleanup. A typed cancellation result means stopped;
uncertain cleanup remains failed. If a completed frame wins a race with Stop,
the actual completed image is published. Stop during readout or preview preparation
prevents another exposure; it waits for that acquisition and preview to settle. Stop and image retrieval do not depend
on the current camera being ready for another exposure.

The HTTP boundary accepts exposureSeconds from 0.1 through 600 and optional
boolean repeat and saveFrames, plus an optional targetId. The injected subject
lookup resolves that ID before acquiring the Rig lease or inspecting hardware.
Unknown IDs are rejected. Omitting repeat retains the single-exposure API behavior; the web
interface explicitly requests repetition by default. The server snapshots `subject` as target ID, name and catalog identity; targetless
starts explicitly use null. This is chosen intent, never proof of pointing. Each
image receives that snapshot, so later selections cannot relabel a retained frame.

`savedCount` counts unique images retained from the current or most recent run;
`integrationSeconds` sums only published exposure durations. Both reset on an
accepted start along with `completedCount`. A private generation on cached frames
keeps an older run's Keep completion from incrementing the new run's saved count.
Concurrent manual/automatic Keep counts once after archive confirmation. The
archive-wide `savedImageCount` remains separate. Runs and counts are ephemeral: only the
active run's request and progress are kept so a restart can report it, never a sequence or
history. saveFrames defaults
to false. When enabled, each completed image is published and saved before another
exposure starts. The saving phase remains active and keeps the Rig lease; Stop
waits for that save to settle. A failed automatic save ends the run while retaining
the latest unsaved frame for an explicit retry. Keep this image is an independent,
idempotent artifact command and does not enable saving later frames. Neither
browsing saved images nor keeping an available frame requires a connected camera.
See [saved images](../saved-images/README.md) for durable storage and FITS details.

Capture views include confirmed imaging-camera cooling when the camera reports
CoolerOn. Sensor temperature near a retained setpoint is not CoolerOn. POST
`/api/rigs/:rigId/capture/cooling` accepts `coolerOn` and/or `setpointC`. Setting
a temperature does not turn the cooler on. Vela does not enable cooling on its
own, wait for the sensor to reach the setpoint, or block capture on temperature.
Each write is confirmed by a matching device read; an uncertain write is never
replayed. The web Capture page treats cooling as prep and disables it while a run
is active so Stop stays available. Every cooling command acquires its own exclusive
Rig lease through readback; an existing capture owner never permits another
cooling command to join that operation.

Whenever any operation owns the Rig, the cooling projection carries `blockedBy`:
`alignment`, `autofocus`, `framing`, `capture` for an active run, or `rig` for any
other short command. It uses the same condition under which the cooling command is
refused, so the browser can disable the control and name the reason instead of
discovering a 409. A confirmed cooling response is read after its own lease ends.

### Frame count

`frameCount` is an optional whole number from 1 to 10000 on start, valid only with
`repeat: true`; anything else, including `frameCount` without repeat, is a 400.
Omitted means repeat until stopped. The view carries it as `frameCount` for the
run (null when there is none), so a client can show `completedCount` of
`frameCount`.

A frame counts toward the target once it is published and, when `saveFrames` is
on, saved. A lost frame never counts: the run takes another, as it does today. A
failed read or a failed save ends the run as `failed`, so it never reaches the
target. After the Nth finished frame no further exposure starts and the run
ends the way a single exposure does: phase `complete`, `active: false`, no error,
the frames saved and one frame record each, and the Rig lease released. A manual
Stop before then ends it as `stopped` and keeps the count taken so far. A run that
reached its target is told from one stopped early by `completedCount` against
`frameCount`. `completedCount` counts a frame as it is published, so while the
last frame is saving it already reads N; a failed save then ends the run `failed`.

### Frame type

A run takes one frame type: `light` (the default), `dark`, `flat`, `dark-flat` or
`bias`. Start accepts it as the optional `frameType` field. Any other value is a 400.
The view carries `frameType` for the current or most recent run, `light` before any
run. Each image carries its own `frameType`, so a later run never relabels an earlier
frame.

Only a light run has a subject. `targetId` with any other type is a 400, and a
calibration run's `subject` is null. A calibration frame therefore never joins a
target's light set.

The type reaches the frame in two places, and both are written on the Vela side.
The FITS header gets `IMAGETYP`: `LIGHT`, `DARK`, `FLAT`, `DARKFLAT` or `BIAS`.
The saved-image record gets `frameType`, and so does each frame record line and
the `capture.frame` span. Vela writes the FITS itself from the pixels it fetched,
so `IMAGETYP` is always right, whatever Cria's own file says.

The run's type also reaches the camera. Through Cria, the adapter sets the camera's
INDI frame type before each exposure (see `packages/cria/README.md`), so a dark, dark
flat or bias frame is a closed-shutter exposure and a flat is an open one. An Alpaca
camera is not told: it exposes with the shutter open whatever the type. Against a Cria
that has not been updated, darks and dark flats still work, and a flat or bias run fails
on its first frame.

A Cria bias frame is exposed for the camera's own minimum, whatever time was requested
(3.2e-5 s on the ASI2600MC Pro). The frame's exposure is that minimum, not the request.
Before each bias exposure the adapter reads the camera's `exposureMinimum` from Cria's
current state, the reading Cria uses for the same exposure, and the controller records it
as the frame's exposure: the FITS `EXPTIME`, the image's `exposureSeconds`, the frame
record's `exposureSeconds`, the `capture.frame` span's `capture.exposure.seconds` and the
run's `integrationSeconds`. The requested time stays validated as before (0.1 to 600) and
goes to the camera unchanged; it is also what the run view, the interrupted-run record, a
resume and the frames-stalled alert use. The other frame types record the requested time.

If the minimum cannot be read (no fresh reading, or not a positive number), the bias run
ends `failed` before its first exposure with a message that says so, and nothing is
exposed or recorded for that attempt. Vela does not fall back to the request: that would
write an exposure the sensor never integrated into a file Chris may stack later. An Alpaca
camera is not told the frame type, so its "bias" is a short exposure for the requested
time; it records that time, because that is what the camera did.

Cap the telescope or camera for dark, dark-flat and bias runs; Vela cannot see the cap.
The ZWO cameras here have no shutter, so the cap is what makes the frame dark.

The alert rules judge stars, which a calibration frame lacks. A calibration run is
never an imaging run for the monitor, so it raises no no-stars alert, and its frames
reach the monitor without star measurements, so they cannot raise a star-count or HFR
trend alert. They still show the camera is producing frames.

### Restarts

A restart used to drop a running capture and show idle, so an unattended night could be lost
unseen. Now the active run is written to `capture-runs.json` next to the rig catalog
(`rigs.yaml`; `run-store.ts`), as `{ "runs": { "<rigId>": record } }`. A record holds the
request (exposure, repeat, `frameCount`, `frameType`, `saveFrames`, the `subject` snapshot), the
start time and the progress (`completedCount`, `savedCount`, `integrationSeconds`). It is
written when the run starts and after each completed frame and each save, and removed when the
run ends by itself, fails or is stopped by Chris. A run that ends because the server is shutting
down (`controller.close()`, from the app's close hook) keeps its record. So a record found at
startup is a run that did not end: after a deploy (SIGTERM) or a crash alike.

- **Nothing exposes after a restart.** At startup each such rig's controller reports phase
  `interrupted` (terminal, `active: false`) with the run's settings and counts, and
  `interruption: { reason: "Vela restarted", remainingCount }`. The camera is not asked for
  anything until Chris starts or resumes a run. Starting any new run replaces the record. There
  is no dismiss: the interrupted view stays, across further restarts, until a run starts.
- **Resume.** `POST /api/rigs/:rigId/capture/resume` takes no body (as stop does) and starts a
  new run with the same exposure, repeat, `saveFrames`, frame type and subject snapshot. A run
  with a count resumes with `frameCount - completedCount`; a repeat with no count repeats until
  stopped; an unfinished single exposure repeats once. It is an ordinary start: the Rig lease,
  camera connected and idle, and the alert monitor all apply, so a refusal leaves the run
  interrupted and Resume available. 409 when nothing is interrupted or nothing is left. The
  subject is the stored snapshot, not a fresh lookup, so a target removed meanwhile does not
  block it. The new run counts from zero; the earlier frames stay in the saved-images
  gallery, and a second interruption reports what is left of the resumed run.
- **A light run raises one alert.** On startup the route tells the rig's monitor
  (`runInterrupted`), which raises `run-interrupted` (critical) through the usual phone rules:
  the switch, astro dark and one page per alert. See [alerts](../alerts/README.md#an-interrupted-run).
  A calibration run raises none. The alert is raised once per server start while the record
  stands, because the monitor's episode is memory only: an alert held for daylight is not
  lost if the server restarts again before dusk.
- **A frame in flight at the restart.** Cria keeps exposing: it owns the camera and its
  operation ledger holds the capture after Vela's connection is gone. Vela cannot see that
  operation after a restart, never fetches its image, and does not count it. The camera
  reports exposing, so the start checks refuse a resume ("The camera has not confirmed it is
  idle") until the exposure and its readout end; the orphaned image then ages out of Cria's
  newest images. A resumed run therefore never starts an exposure on a busy camera, and
  never replays or tries to recover the lost one: it takes a fresh frame, and `remainingCount`
  counts only frames Vela published. If Cria restarted too, its ledger is empty and the camera
  settles on its own. Either way what was in flight is unknown, as the product rules say.
- **Bad state starts clean.** A missing, unreadable or corrupt file means no unfinished runs,
  with a line in the log; an unreadable record is dropped on its own. A failed write is logged
  and never ends the run. The file is rewritten whole through a temporary file with mode 0600.

## Local review

Choose the simulator imaging camera through the same Rig setup API used for a
physical Rig: GET `/api/web/rigs/:rigId/imaging-camera` returns current choices;
PUT `/api/rigs/:rigId/imaging-camera` with `{ id, name }` remembers an explicitly
selected current choice. The name echo rejects a choice that changed since it
was displayed. The Observe chooser uses those same routes. Use the isolated simulator review catalog and app proxy described
in `../alignment/README.md`.

From Observe, open Capture, choose an exposure duration and take an image. Return
to Observe during a longer exposure to see its activity and the previous-image
thumbnail. Stop aborts the pending exposure; it does not discard the last
completed image. Fit displays the whole frame, while 100% provides native-pixel
scrolling. Preview age measures time since receipt; metadata also retains the
exposure-start timestamp and its camera-reported or server-estimated source.

The navigation projection reads catalog identities and synchronous snapshots of
known capture controllers. It never inspects devices or saved-image storage.
Terminal controllers remain visible so a browser can distinguish a confirmed end
from a controller lost after a server restart. Forgotten rigs are excluded.
