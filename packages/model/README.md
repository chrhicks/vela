# `@vela/model`

`@vela/model` owns the dependency-free contracts shared by Vela's server and
web applications. It gives both sides one normalized vocabulary without
assigning protocol, transport, persistence, or application behavior to this
package.

## Boundaries

- `@vela/model/device` describes normalized device kinds and live device
  projections.
- `@vela/model/rig` describes Rig identities, endpoints, reachability, and
  discovery projections.
- `@vela/model/web` composes those contracts into page-level views.

Server application code resolves domain state into those views so the browser
can render the result without reconstructing precedence, reconciliation, or
capability decisions. Views remain semantic, typed contracts rather than
generic property bags or preformatted display strings; visual composition,
copy, and formatting remain browser concerns. Home Rig projections carry a
compact connection aggregate; per-device observations belong to the Rig-detail
view. Observation views compose that existing Rig detail with a focused
connection-preparation state. `complete` means no currently supported interface
needs a connection command; it is not permission to perform every observing
activity. Connection command results report interfaces confirmed connected by
the current operation separately from a failed or uncertain interface and from
interfaces that were not attempted. Interfaces already connected before the
operation remain represented by the refreshed Rig connection aggregate. When a
refresh resolves an uncertain write after sequencing has already stopped,
`stoppedAfter` identifies the now-confirmed interface while later interfaces
remain `notAttempted`.

The package has no runtime dependencies. In particular, it does not own:

- Alpaca wire fields, response envelopes, schemas, or device numbers;
- HTTP, UDP, or other network behavior;
- YAML schemas, file I/O, or persistence;
- device-specific control behavior;
- React components or client state.

Protocol adapters normalize their values before they cross into these
contracts. Recognizing a `DeviceKind` does not mean Vela implements operations
for that kind. Rig-detail views distinguish connected devices whose detail is
`unsupported` from devices whose current status is `unavailable`.

## Verification

Run the focused checks with:

```sh
pnpm --filter @vela/model test
pnpm --filter @vela/model build
```

The contract tests compile representative server/web usage and verify that the
package manifest stays free of runtime dependencies.

The polar-alignment page contract carries ephemeral operation phase/activity,
last solved measurements and the matching preview reference. It contains no
Alpaca wire fields or simulator ground truth. Geometry and operation ownership
remain on the server.

The Capture view describes one ephemeral capture run, its readiness and phase,
its repeat setting and count of published images in that run,
and the latest completed image with its own duration, camera, dimensions and
start/receipt timestamps and optional star measurements. `capturedAtSource`
distinguishes camera-reported starts from `server-estimate` values recorded on the
host before requesting exposure; an absent source preserves the camera-reported
meaning of legacy images. Null measurements mean
analysis unavailable; zero detected stars with null HFR is a valid measured
result. HFR is the median half-flux radius in native image pixels. It is shared by the Observe thumbnail and Capture
page. The count resets on start, while the latest image remains until a new image is
published. The saveFrames flag is the active run's retention choice; savedImageCount
is null when storage cannot be inspected. The saving phase remains active while
the server writes an image. CaptureImage.saved confirms retention of that image's
original data and preview. `cooling` is confirmed CoolerOn plus optional sensor
temperature, requested setpoint and power; a near-setpoint sensor is not cooler-on.
Null cooling means the imaging camera does not report cooler state. SavedImage and SavedImagesView describe durable artifacts
and their download resources separately from the ephemeral capture run. Neither
contract represents a durable sequence or resumable execution.

Target views carry fixed J2000 catalog positions, reference-image resources and
server-calculated sky paths. Framing views expose the ephemeral slew/exposure/
solve phase, requested center, camera field size and timestamped solved footprint.
`checkCurrent` distinguishes a current check from a preserved older exposure;
`canCenter` is the server's separate correction precondition. Neither contract
contains a device protocol, coordinate conversion or durable observing plan.

NavigationView combines catalog identities with small snapshots of known capture
controllers, including terminal phases. An absent controller does not confirm
that a previously observed run finished; these snapshots are lost on restart.
