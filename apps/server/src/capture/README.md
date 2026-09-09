# Capture

Capture owns one server-side capture run and its most recent image. A run takes
one exposure or repeats the requested duration until stopped. Browser requests
start the work and read its projection; disconnecting the browser does not stop
acquisition. A server restart loses the operation and in-memory previews;
explicitly saved images remain available through the saved-images boundary.

The imaging-camera setup API remembers an explicitly selected camera in the
Rig catalog by stable provider ID and its reported camera name. An inventory
camera is never selected automatically. A missing identity or changed reported
name requires explicit reselection; a different camera in the same configured
provider slot is not silently accepted.

The Observe chooser is the setup path. It replaces the temporary
`VELA_CAPTURE_ENDPOINT` / `VELA_CAPTURE_CAMERA_ID` environment configuration;
previously environment-configured rigs need one explicit choice in Observe.
Route
composition acquires the same Rig operation lease used by alignment and
connection commands before checking the selected identity and connection. The lease
lasts across every exposure and through final acquisition cleanup. Device protocol preconditions and abort
confirmation belong to the ALPACA adapter.

The controller depends on `CaptureCamera`, not a concrete transport. A successful
frame publishes its own exposure settings, acquisition start timestamp and
receipt timestamp, and star measurements from its linear samples. Dimensions,
detected-star count and median HFR remain attached to that image. An unavailable
analysis never discards the acquired image; see [image processing](../imaging/README.md)
for measurement limits. Later pending, failed or stopped exposures retain that image and its
metadata. The run count increments only when an image is published and resets
on each start. Any acquisition or preview failure ends the run without replay. Preview stretching preserves native dimensions for 100% inspection;
only the latest three image pairs and their temporary original FITS buffers remain
in memory. Saving releases the temporary original buffer after the archive confirms
the write. This bounded cache lets Keep this image target the displayed frame when
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
boolean repeat and saveFrames. Omitting repeat retains the single-exposure API behavior; the web
interface explicitly requests repetition by default. Runs and counts are ephemeral,
with no durable sequence or resumption after server restart. saveFrames defaults
to false. When enabled, each completed image is published and saved before another
exposure starts. The saving phase remains active and keeps the Rig lease; Stop
waits for that save to settle. A failed automatic save ends the run while retaining
the latest unsaved frame for an explicit retry. Keep this image is an independent,
idempotent artifact command and does not enable saving later frames. Neither
browsing saved images nor keeping an available frame requires a connected camera.
See [saved images](../saved-images/README.md) for durable storage and FITS details.

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
