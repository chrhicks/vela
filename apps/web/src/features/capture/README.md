# Capture presentation

The app implements the approved workshop layout using the server's CaptureView.
The specimen is a design reference, never a runtime dependency. The server owns
exposure lifetime, readiness and operation outcomes; the browser owns pending
form edits, Fit/100% presentation and loaded-image state.

`useCapture` serializes commands and polls current state. A deliberate command
supersedes a pending GET; request generations prevent its late result from
replacing the newer state. A missing or invalid command response is never
replayed. Starting again requires an explicit read confirming no active exposure.

`useLoadedImage` preloads each immutable image URL and commits its metadata with
the image only when loading succeeds. A failed new image leaves the previous
frame and metadata together. GET retries are bounded; native dimensions drive
100% scrolling. Observe consumes the same projection and loading primitive.
