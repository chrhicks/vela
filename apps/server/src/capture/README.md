# Capture

Capture owns one server-side exposure and its most recent image. Browser requests
start the work and read its projection; disconnecting the browser does not stop
acquisition. A server restart loses the operation and in-memory previews.

The imaging camera is explicitly selected in Rig setup and remembered in the
Rig catalog by stable provider ID and its reported camera name. An inventory
camera is never selected automatically. A missing identity or changed reported
name requires explicit reselection; a different camera in the same configured
provider slot is not silently accepted. Route
composition acquires the same Rig operation lease used by alignment and
connection commands before checking the selected identity and connection. The lease
lasts through acquisition cleanup. Device protocol preconditions and abort
confirmation belong to the ALPACA adapter.

The controller depends on `CaptureCamera`, not a concrete transport. A successful
frame publishes its own exposure settings, acquisition start timestamp and
receipt timestamp. Later pending or failed exposures retain that image and its
metadata. Preview stretching preserves native dimensions for 100% inspection;
only the latest three PNGs remain in memory. This is not an artifact archive.

Unbinned Bayer frames are bilinearly debayered at native dimensions. A shared
asinh display stretch uses sampled black/white points across sensor phases;
this is a viewing aid, not calibrated color processing. Acquisition samples
are unchanged. Preview computation yields between row batches and compression
runs asynchronously to keep the server responsive with full-resolution frames.

Stop waits for confirmed cleanup. A typed cancellation result means stopped;
uncertain cleanup remains failed. If a completed frame wins a race with Stop,
the actual completed image is published. Stop and image retrieval do not depend
on the current camera being ready for another exposure.

The HTTP boundary accepts a single exposure duration from 0.1 through 600 seconds.
Repeated capture runs, physical camera settings and FITS retention are separate
capabilities.

## Local review

Choose the simulator imaging camera through the same Rig setup API used for a
physical Rig: GET `/api/web/rigs/:rigId/imaging-camera` returns current choices;
PUT `/api/rigs/:rigId/imaging-camera` with `{ id, name }` remembers an explicitly
selected current choice. The name echo rejects a choice that changed since it
was displayed. The server catalog owns the selection; no environment setting
implicitly enables Capture. Use the isolated simulator review catalog and app
proxy described in `../alignment/README.md`.

From Observe, open Capture, choose an exposure duration and take an image. Return
to Observe during a longer exposure to see its activity and the previous-image
thumbnail. Stop aborts the pending exposure; it does not discard the last
completed image. Fit displays the whole frame, while 100% provides native-pixel
scrolling. Preview age measures time since receipt; metadata also retains the
camera's exposure-start timestamp.
