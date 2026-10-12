# Capture presentation

The app implements the approved workshop layout using the server's CaptureView.
The specimen is a design reference, never a runtime dependency. The server owns
capture-run lifetime, completed-image count, readiness and operation outcomes; the browser owns pending
form edits, Fit/100% presentation and loaded-image state.

`useCapture` serializes commands and polls current state. A deliberate command
supersedes a pending GET; request generations prevent its late result from
replacing the newer state. Start accepts an optional selected target ID; the server
returns its fixed `subject` intent snapshot. `savedCount` and `integrationSeconds`
are server-owned per-run totals; `savedImageCount` still describes the archive.
Image subject metadata may be absent on legacy artifacts. A missing or invalid command response is never
replayed. Starting again requires an explicit read confirming no active exposure.

`useLoadedImage` preloads each immutable image URL and commits its metadata with
the image only when loading succeeds. An in-flight download completes even when
new frames arrive faster than image delivery; after settling, it loads only the
newest pending frame. This keeps a running capture visibly advancing without an
unbounded download queue. A failed new image leaves the previous
frame and metadata together. GET retries are bounded; native dimensions drive
100% scrolling. Preparation consumes the same command projection, with a separate temporary
framing-exposure preview.

Large frames offer a smaller fitted preview. The image viewer requests it first;
100% loads the native image on demand, preserving the fitted view until that
request completes. The requested image URL and metadata commit together, so a
delayed or failed native-image request never labels a scaled preview as 100%.

Repeat until stopped defaults to enabled for a new controller. The form sends
that choice with the exposure duration, and server projections restore it while
a run is active. Stop remains available during image receipt as well as exposure;
the view waits for confirmed cleanup and never starts the next image itself.
Preparation links to the active run, so page navigation does not control it.

`captureReadState` separates interrupted camera reads from the underlying capture
phase and browser/server reachability. While retrying the same exposure, the page,
Tonight and navigation keep the completed count and previous image, hide
exposure progress, and explain the pending read. Stop remains available. A current
read resumes the supplied phase; it does not imply that an image completed.
The interruption panel preserves the last exposure and labels the interrupted read.

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

Cooling controls sit with capture prep. Confirmed CoolerOn, sensor temperature,
requested setpoint and power are server projections. A sensor near the requested
temperature is not treated as cooling enabled. Cooler on/off and target temperature
are explicit commands; setting a target does not turn the cooler on. Cooling is
disabled while a capture run is active so Stop stays available. Cooler command
failures stay in the cooling region and do not label capture unavailable.
When the server marks cooling `blockedBy` another operation, the switch is disabled
and the cooling region names what holds the rig, with a link to alignment or
autofocus where Chris can resolve it. Command feedback (blocker, refusal or unknown
outcome) has one slot directly below the switch. The description above it explains
observed state without claiming freshness and never changes with a command; the
switch's own note and "Confirming cooler state…" share one cell, and a previous
refusal keeps its space invisibly while the next command confirms, so a tap never
moves the control. While capture is offline or a cooling outcome is unknown, the
card heading reads "Cooling · last known", matching the Tonight footer.
An uncertain command retains the affected setting until an explicit check observes
it again: CoolerOn for a switch command, requested setpoint for a temperature
command. Missing telemetry and successful exposure commands do not dismiss that
warning. A fresh setting resolves uncertainty even if it differs from the requested
value; the interface shows the observed state rather than claiming the write won.

Saved images are available at the per-rig `/observe/saved-images` route independently
of camera readiness. [Photographs](../photographs/README.md) owns the dated
collection and selected-image composition, validating retained metadata and exact
same-origin download resources. Capture owns retention actions; browsing uses
real preview URLs and native download links for FITS and preview PNG.

Manual-save feedback is owned by the image viewer rather than a keyed frame
button. A new exposure may replace displayed pixels while an earlier save is
pending; its outcome and explicit retry stay associated with the selected image.
## Retained-preview versions

Saved-image validation pins native, fit and PNG-download URLs to the same declared
renderer version, or to the legacy original URLs when refresh is unavailable.
The saved-image page displays server-owned rendering status separately from the
capture facts. Opening a legacy detail may take time to prepare its bounded
display derivative; collection loading does not initiate archive-wide work.
Downloads match the displayed treatment at native resolution; originals remain
preserved. Capture's live image IDs are already immutable per new acquisition.

## Fieldroom inspection

Tonight opts into the Fieldroom image presentation with `LatestImage.fieldroom`.
Fit follows the bounded latest-image loader. Entering 100% or enlargement holds
the currently decoded fitted frame and its metadata. The independent native GET
loads and decodes that exact identity; a failed read keeps the fitted pixels and
offers an explicit same-resource retry. Show latest releases the hold and returns
to Fit. New arrivals cannot rename the held image or redirect its Keep request.

The viewer owns native scale and bounded scroll coordinates across dialog entry
and dismissal. Pointer/touch drag and arrow keys pan the native pixels, with no
astronomy overlays. The shared Dialog restores focus to Enlarge image. Cache
expiry (native GET 404/410 or Keep 410) leaves the loaded image visible and marks
unavailable operations. Dimensions and acquisition timestamps remain in Image
details; the primary metadata describes the displayed exposure and measured stars.

Tonight's camera-temperature/cooler summary consumes `CaptureView.cooling`, the
same selected-camera projection as the cooling controls. Inventory order and
camera names do not identify the imaging camera. Missing cooling is unavailable;
it never falls back to another camera's measurements. Its last-known label follows
the capture connection/uncertain-cooling state independently of rig inventory.

### Shared inspection mechanism

`features/image-inspection` owns `ImagePixels`, the bounded fitted loader,
`useImageInspection<T>`, `ImageViewport`, and `ImageEnlargement`. The typed owner
snapshot publishes atomically with decoded pixels. Its resource identity includes
both fitted/native URLs as well as acquisition ID, so a saved renderer version
cannot inherit another version's native read result. Owners explicitly supply a
scope (for capture, the rig); URL directory shape never determines reset behavior.
Photographs resets selected inspection on deliberate selection or renderer
replacement without remounting its collection.

The shared mechanism owns hold/native/pan state and themed portal focus, inert,
and body-scroll restoration. Feature owners supply image descriptions, chrome,
actions and missing-resource wording. Native 404/410 means a missing exact
resource; only capture interprets that as camera-cache expiry. Keep outcomes,
Show latest, receipt age and capture metadata remain in `LatestImage`.
`useLoadedImage` and `CameraMark` remain compatibility exports for older consumers.
