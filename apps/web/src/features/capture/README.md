# Capture presentation

The app implements the approved workshop layout using the server's CaptureView.
The specimen is a design reference, never a runtime dependency. The server owns
capture-run lifetime, completed-image count, readiness and operation outcomes; the browser owns pending
form edits, Fit/100% presentation and loaded-image state.

`useCapture` serializes commands and polls current state. A deliberate command
supersedes a pending GET; request generations prevent its late result from
replacing the newer state. A missing or invalid command response is never
replayed. Starting again requires an explicit read confirming no active exposure.

`useLoadedImage` preloads each immutable image URL and commits its metadata with
the image only when loading succeeds. An in-flight download completes even when
new frames arrive faster than image delivery; after settling, it loads only the
newest pending frame. This keeps a running capture visibly advancing without an
unbounded download queue. A failed new image leaves the previous
frame and metadata together. GET retries are bounded; native dimensions drive
100% scrolling. Observe consumes the same projection and loading primitive.

Large frames offer a smaller fitted preview. Observe and Fit request it first;
100% loads the native image on demand, preserving the fitted view until that
request completes. The requested image URL and metadata commit together, so a
delayed or failed native-image request never labels a scaled preview as 100%.

Repeat until stopped defaults to enabled for a new controller. The form sends
that choice with the exposure duration, and server projections restore it while
a run is active. Stop remains available during image receipt as well as exposure;
the view waits for confirmed cleanup and never starts the next image itself.
Observe shows the same server count, so page navigation does not control the run.

The latest-image statistics row uses the loaded image's dimensions and measured
star count/HFR. Image pixels, exposure metadata and measurements commit together,
including when a newer image fails to load or intermediate arrivals are skipped.
Zero measured stars and unavailable analysis have distinct presentations.

Save frames is an explicit per-run option, off on a new controller and restored
from the active server projection. Keep this image targets the image whose pixels
have actually loaded. Its idempotent storage request has separate pending/error
state, so it never prevents stopping an exposure or claims a camera command failed.
The immutable loaded metadata is supplemented by confirmed save responses and the
matching current projection's saved flag.

Saved images are available at the per-rig Observe/saved-images route independently
of camera readiness. The dated collection and detail page validate retained-image
metadata and exact same-origin download resources. They use the approved workshop
layout with real preview URLs and native download links for FITS and preview PNG.
