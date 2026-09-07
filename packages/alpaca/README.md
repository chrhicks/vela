# `@vela/alpaca`

Server-side Alpaca protocol boundary for Vela. Raw wire fields, response envelopes, Effect schemas, device numbers, URL construction, UDP sockets, and protocol errors stay inside this package.

The package does not depend on `@vela/model` and performs no network activity during import or factory creation.

## Discovery and inspection

```ts
import { createAlpacaDiscovery } from '@vela/alpaca'

const discovery = createAlpacaDiscovery()
const endpoints = await discovery.scan({ signal })

for (const endpoint of endpoints) {
  const inspection = await discovery.inspect(endpoint, { signal })
  // Map the normalized inspection into server-owned Vela models.
}
```

`scan()` broadcasts `alpacadiscovery1` over active, non-internal IPv4 interfaces and returns de-duplicated `{ host, port }` endpoints. It does not inspect servers or call HTTP endpoints.

`inspect()` performs these read-only Management API requests serially:

1. `/management/apiversions`
2. `/management/v1/description`
3. `/management/v1/configureddevices`

It never connects a device or calls `/api/v1` device-control endpoints.

Defaults:

- Two UDP sends, 250 ms apart
- One-second UDP collection window
- Three-second timeout per Management API request
- `AbortSignal` cancellation for both operations

Malformed UDP packets are ignored. A scan with no responses returns an empty
array. Management transport, decoding, and protocol failures reject with
structured errors. Configured device names are trimmed and unusable blank names
reject the inspection. Configured devices without a non-empty stable ID remain
in the normalized inspection so the Vela server can own candidate-eligibility
policy.

The intended application flow is server-owned:

```text
wizard request → server → scan() → inspect(each endpoint) → Vela candidate projection
```

Manual host entry skips `scan()` and converges at `inspect(endpoint)`.

## Operational provider

`createAlpacaProvider()` is the normalized operational boundary for known Rigs.
`listDevices()` remains the lightweight inventory operation used to observe
configured identities, connection state, and driver metadata. Operational
inventory fails as an invalid response if any configured device lacks a stable
ID or usable name, preventing an incomplete response from replacing a known
Rig's durable identity inventory. A received non-successful HTTP response is a
protocol error, distinct from a transport failure where the server did not
respond.

`inspectDevices({ signal })` is the separate read-only detail operation. It reads the operational device name and the small kind-specific status set Vela currently uses for cameras, telescopes, focusers, filter wheels, observing conditions, and switches. Explicitly unsupported properties are omitted. Other individual read failures produce partial telemetry without hiding the device, while endpoint-level inventory failure rejects the operation. A disconnected device retains its identity without triggering predictable telemetry failures.

Switch inspection returns generic channel names, descriptions, values, ranges, steps, and writability. It validates that ranges are ordered, steps are positive, and current values are in range, but it does not require read-only measurements to align to the advertised control step: Pegasus sensors report useful precision finer than `SwitchStep`. It does not infer vendor semantics or units.

Both read flows keep HTTP requests serial within each invocation. The provider does not cache or poll operational telemetry.

## Device connection command

`connectDevice(providerDeviceId, { signal })` is the operational provider's connection write capability. It accepts the stable normalized provider identity rather than an Alpaca device type or number. It reads `Connected` first and returns confirmed success without a write when the device is already connected.

For a disconnected device, the provider uses the Alpaca v1 compatibility contract: `PUT connected` with an `application/x-www-form-urlencoded` body containing `Connected=true`. A successful response is verified with another `Connected` read. If the provider reports the Platform 7 `Connecting` completion property, Vela observes it at a bounded interval until the transition ends, then reads `Connected` again. This is a narrow connection-completion loop, not a generic retry mechanism, and the write is never replayed.

The result distinguishes confirmed connection, confirmed rejection or remaining disconnection, and an uncertain outcome. A malformed or response-less write is reconciled through read-only state when possible. Cancellation before the write rejects normally because no command was issued. Cancellation during or after the write returns an uncertain result because aborting HTTP cannot prove that physical-device work stopped, unless the provider's decoded response already supplies stronger evidence such as a confirmed protocol rejection.

The newer Platform 7 asynchronous `Connect` method is not used by this compatibility capability. Its command-initiation response and `Connecting` completion contract must not be mistaken for the synchronous legacy setter response if Vela adopts that method later.

## Testing

Factory injection supports fake `fetch` and UDP scanner boundaries. Package tests use only deterministic fakes and never touch the real LAN.

## Exposure and primary-axis acquisition

`createAlpacaAcquisition({ baseUrl })` is a separate narrow capability for a
connected monochrome or unbinned RGGB Bayer camera and equatorial mount. It resolves stable provider
IDs through management inventory; device numbers and JSON wire shapes remain
private. The server owns operation serialization and decides which rigs and
coordinate frames its workflow supports.

- `capture({ cameraId, exposureSeconds, signal, onProgress })` starts one light
  exposure, observes `ImageReady`, and returns `{ width, height, pixels,
  capturedAt, color }`. Pixels are row-major `Float64Array`; the timestamp is UTC.
  The boundary requests ImageBytes with JSON fallback on the same ImageArray
  GET, using the response Content-Type to choose decoding. It accepts rank-2
  Int32 source images and transposes Alpaca's `[x][y]` layout without changing
  samples. ImageBytes v1 supports Int32, Int16, UInt16, and Byte transmission
  elements; metadata, offsets, dimensions, payload length, and UTF-8 protocol
  errors are checked before allocating normalized samples.
  `color` is `{ kind: 'mono' }` or `{ kind: 'bayer', pattern }`, where the pattern
  (`rggb`, `grbg`, `gbrg`, `bggr`) describes the returned image's top-left 2×2
  samples. ASCOM Bayer offsets refer to the full sensor; the adapter combines
  them with the subframe origin before exposing this normalized pattern.
  Debayering and display stretching belong to the consumer. Bayer capture
  requires 1×1 binning because mixed or driver-specific binned color samples
  cannot be interpreted reliably from the Bayer offsets alone. Missing or
  malformed color metadata rejects before exposure. Multi-plane RGB, other
  color matrices, and other binary source/transmission types remain unsupported. `monochromeOnly: true`
  retains a pre-exposure mono restriction for consumers such as alignment.
  Images remain bounded to 40 million pixels. Binary data is decoded directly
  into Float64 samples without an intermediate nested array. JSON fallback
  still requires substantial transient memory for a full 26 MP camera. Image transfer has a separate 60-second
  timeout (`imageTimeoutMs`); ordinary device requests retain their 5-second
  default (`requestTimeoutMs`).
- Optional `expectedCameraName` checks the fresh operational name immediately
  before the exposure write. This detects a changed attached camera when a
  driver retains the same stable slot identity. A mismatch or missing name
  rejects without commanding or aborting that camera.
- An already active camera is rejected before writing. A retained image with
  the same exposure timestamp is rejected as unconfirmed freshness; drivers
  with coarse timestamps may therefore require more spacing between captures.
  Completion is bounded by exposure duration plus 60 seconds. Failed or
  cancelled captures attempt an independent, bounded abort. A lost start
  response never causes a second exposure command.
- `pointing(telescopeId, signal)` returns right ascension, declination, local
  sidereal time, and site latitude in degrees, plus tracking and the named
  equatorial coordinate system. It does not convert epochs or treat `other`
  as J2000. Consumers must resolve their own coordinate-frame requirements.
- `move(telescopeId, rateDegreesPerSecond, durationSeconds, signal)` checks
  primary-axis capability and advertised unsigned rate ranges, issues one
  signed mechanical rate, and always sends rate zero in cleanup—even when
  the start response is lost or the caller cancels. Stop confirmation requires
  `Slewing=false`. Mechanical rate sign is mount-dependent, not a promise of
  increasing/decreasing sky RA. This narrow operation allows at most 120
  seconds and rates up to 10 degrees/second.
- `abort(cameraId, telescopeId)` attempts both stop operations independently
  and reports failures rather than claiming that both devices stopped.

Protocol references: [ASCOM camera interface](https://ascom-standards.org/newdocs/camera.html),
[ASCOM telescope interface](https://ascom-standards.org/newdocs/telescope.html), and
[Alpaca API reference](https://ascom-standards.org/AlpacaDeveloper/ASCOMAlpacaAPIReference.html).

Capture's optional `onReadout` callback marks the actual image transfer after
freshness is confirmed. A cancelled acquisition throws `AlpacaCaptureStoppedError`
when cancellation precedes the exposure write, or after independent abort and
idle confirmation succeed. Cleanup failures
remain failures, allowing the server to distinguish stopped from unconfirmed
physical state without inferring success from an aborted browser request.

## Framing geometry and absolute slews

`createAlpacaFraming({ baseUrl })` provides a separate camera-geometry and telescope
capability; acquisition callers do not change. `cameraGeometry({ cameraId,
expectedCameraName }, signal)` validates the connected camera's operational
identity, physical sensor dimensions and pixel sizes, and current binning and
subframe. Sensor dimensions and pixel microns are unbinned; `width`, `height`,
`startX`, and `startY` are binned pixels. Contradictory subframes reject.

`telescopeStatus(telescopeId, signal)` reports degrees with the driver's named
coordinate system, tracking, slewing, park state, and observation time. Optional
site latitude, east-positive longitude, and elevation are omitted only when the
driver explicitly reports them unsupported. Unsupported frame metadata becomes
`unknown`; ASCOM `equOther` remains `other`. Neither is treated as J2000.

`setTracking(telescopeId, boolean, signal)` confirms the requested state by reading
it, including after a lost setter response. `slew({ telescopeId,
rightAscensionDegrees, declinationDegrees, coordinateSystem }, signal)` requires
an explicit supported frame matching the driver. Frame conversion belongs to the
consumer. The mount must be connected, unparked, idle, tracking, and capable of
asynchronous slews before a single `SlewToCoordinatesAsync` write is issued.
The boundary converts RA degrees to protocol hours and waits for confirmed
`Slewing=false`, bounded by a 180-second default deadline. That confirms driver
completion; it does not substitute for plate-solved pointing accuracy.

A failed or cancelled slew independently sends `AbortSlew` and confirms stopping,
with a cleanup deadline of at most 15 seconds. No command is blindly retried.
A lost slew response remains an error even after stopping is confirmed.
`AlpacaFramingStoppedError` identifies cancellation only after successful cleanup;
an unconfirmed stop remains a failure. `abortTelescope(telescopeId)` provides the
same independent stop without touching a camera. Factory options expose request,
slew, and polling intervals for deterministic boundary tests.

Protocol contracts are the [ASCOM telescope interface](https://ascom-standards.org/newdocs/telescope.html)
and [ASCOM camera interface](https://ascom-standards.org/newdocs/camera.html).
