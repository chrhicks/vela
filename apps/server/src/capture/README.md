# Capture

Capture owns one server-side exposure and its most recent image. Browser requests
start the work and read its projection; disconnecting the browser does not stop
acquisition. A server restart loses the operation and in-memory previews.

The current rollout is simulator-first, with an explicitly configured endpoint
and stable camera ID. An inventory camera is never selected automatically. Route
composition acquires the same Rig operation lease used by alignment and
connection commands before checking the configured identity and connection. The lease
lasts through acquisition cleanup. Device protocol preconditions and abort
confirmation belong to the ALPACA adapter.

The controller depends on `CaptureCamera`, not a concrete transport. A successful
frame publishes its own exposure settings, acquisition start timestamp and
receipt timestamp. Later pending or failed exposures retain that image and its
metadata. Preview stretching preserves native dimensions for 100% inspection;
only the latest three PNGs remain in memory. This is not an artifact archive.

Stop waits for confirmed cleanup. A typed cancellation result means stopped;
uncertain cleanup remains failed. If a completed frame wins a race with Stop,
the actual completed image is published. Stop and image retrieval do not depend
on the current camera being ready for another exposure.

The HTTP boundary accepts a single exposure duration from 0.1 through 600 seconds.
Repeated capture runs, physical camera configuration, color processing and FITS
retention are separate capabilities.

## Local review

Set both `VELA_CAPTURE_ENDPOINT=http://127.0.0.1:7850` and
`VELA_CAPTURE_CAMERA_ID=vela-simulator-camera` on the Vela server to enable the
simulator camera. These are separate from alignment configuration. Without configuration Capture remains unavailable; partial configuration is
rejected at startup; neither a connected camera nor alignment
configuration implicitly selects an imaging camera. Use the isolated simulator
review catalog and app proxy described in `../alignment/README.md`.

From Observe, open Capture, choose an exposure duration and take an image. Return
to Observe during a longer exposure to see its activity and the previous-image
thumbnail. Stop aborts the pending exposure; it does not discard the last
completed image. Fit displays the whole frame, while 100% provides native-pixel
scrolling. Preview age measures time since receipt; metadata also retains the
camera's exposure-start timestamp.
