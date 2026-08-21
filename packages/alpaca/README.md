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

`createAlpacaProvider()` remains the normalized operational boundary for known Rigs. Its `listDevices()` flow keeps all HTTP requests serial within each invocation.

## Testing

Factory injection supports fake `fetch` and UDP scanner boundaries. Package tests use only deterministic fakes and never touch the real LAN.
