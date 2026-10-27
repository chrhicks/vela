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

The optional Frames field sits under the repeat checkbox and is disabled when
repeat is off. Blank repeats until stopped and sends no `frameCount`; otherwise it
must be a whole number from 1 to 10000, and an invalid entry disables Start. While
a run with a target is active, the run summary reads "12 of 30 frames" from the
server's `completedCount` and `frameCount`. The server ends the run at the target;
the page never stops it.

The Frame type field sits above the exposure. It lists Light, Dark, Flat, Dark flat
and Bias, and a new page always starts on Light: a calibration run has no target, so it
is never a carried-over default. Dark, dark flat and bias show "Cap the telescope or
camera first" under the field, because Vela cannot see the cap. Flat says to aim at an
evenly lit panel or sky. `frame-types.ts` holds the labels and reminders in one table
keyed by type. A calibration choice hides the target: the subject card reads "Dark
frames" and the page sends no `targetId`. While a run is active the field is gone and
the run's own type shows beside the exposure count. The field is a single select, so it
fits 390 px without wrapping.

The Filter field sits under Frame type, for a light or a flat only. The rig has one manual slot and
nothing reports what is in it, so Chris says. It lists None, then each of the view's `filters` as the
name and, when there is one, its description. A rig with no filters shows no field and sends none.
It starts on the choice Chris last made for this rig, kept in the browser's local storage by rig ID; a
remembered name the rig no longer lists reads as None. A start with None sends no `filter`, a start
with a filter sends its name, and a dark, dark flat or bias sends none. While a run is active the field
is gone and the run's own filter shows beside the exposure count. A view or image without `filter`
shows nothing: unknown is not None.

An interrupted run (phase `interrupted`, `interruption` set) shows a notice above the form:
the reason ("Vela restarted during this run, and nothing has been exposed since"), the subject
or frame type, how many frames were taken and the exposure. Its Resume button reads "Resume · 18
frames left", or "Resume · repeat until stopped" for a run with no count, and posts to
`capture/resume` with no body. A 400 refusal of Stop or Resume shows the server's message and leaves the button available. A run that had taken all its frames shows no button. Resume is
enabled under the same conditions as Start (`canStart`), so a refusal keeps the notice and the
server's reason shows in the usual warning. The form below it still starts a different run, which
replaces the interrupted one. The notice is a status region with the label "Interrupted capture
run" and the button fits 390 px. This replaces the earlier "no longer tracks the exposure" check
only for runs the server reports as interrupted; that check still covers a controller the server
lost with no record.

Unattended ("page my phone") is a per-run choice, off for every new run and never carried over from the last
one. A run the page sees begin, from this tab or another, clears a ticked choice. The start form has it as a checkbox under Save frames, and the start body always carries `unattended`. On a
running run the same checkbox is a live switch with no confirmation: it calls `PUT /api/rigs/:rigId/capture/unattended`
with `{on}` and shows the server's value, "Phone: on, unattended" or "Phone: off", under it. The switch stays
available whenever a run is active and the page is not mid-command, including during image receipt. A 409 (the run
ended) or a failed request shows its message under the switch and never marks the capture command outcome unknown,
because a switch cannot change what the camera is doing. An interrupted Unattended run's notice says Resume keeps
Unattended on, as the server does (vela#198).

Save frames is an explicit per-run option, ticked on a new controller and restored
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
