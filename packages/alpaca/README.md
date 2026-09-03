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

Malformed UDP packets are ignored. A scan with no responses returns an empty array. Management transport, decoding, and protocol failures reject with structured errors. Configured devices without a non-empty stable ID remain in the normalized inspection so the Vela server can own candidate-eligibility policy.

The intended application flow is server-owned:

```text
wizard request → server → scan() → inspect(each endpoint) → Vela candidate projection
```

Manual host entry skips `scan()` and converges at `inspect(endpoint)`.

## Operational provider

`createAlpacaProvider()` is the normalized operational boundary for known Rigs. `listDevices()` remains the lightweight inventory operation used to observe configured identities, connection state, and driver metadata.

`inspectDevices({ signal })` is the separate read-only detail operation. It reads the operational device name and the small kind-specific status set Vela currently uses for cameras, telescopes, focusers, filter wheels, observing conditions, and switches. Explicitly unsupported properties are omitted. Other individual read failures produce partial telemetry without hiding the device, while endpoint-level inventory failure rejects the operation. A disconnected device retains its identity without triggering predictable telemetry failures.

Switch inspection returns generic channel names, descriptions, values, ranges, steps, and writability. It validates that ranges are ordered, steps are positive, and current values are in range, but it does not require read-only measurements to align to the advertised control step: Pegasus sensors report useful precision finer than `SwitchStep`. It does not infer vendor semantics or units.

Both flows keep HTTP requests serial within each invocation. The provider does not cache, poll, connect devices, or issue writes.

## Testing

Factory injection supports fake `fetch` and UDP scanner boundaries. Package tests use only deterministic fakes and never touch the real LAN.
