# Cria transport

`@vela/cria` is the server-side client for Cria's full .NET v2 service. It owns authenticated HTTP, wire validation, observation freshness, durable operation admission and temporary-original transfer. It follows `dotnet/contract/openapi.json` in Cria, including operation `elapsedSeconds`; the earlier prototype protocol is not supported.

The package depends on `@vela/equipment` for frame contracts and ImageBytes decoding. It imports no ALPACA implementation. Vela's capability adapters belong in `apps/server/src/cria`; repetition, autofocus decisions, plate solving, previews, FITS generation and archive ownership remain in Vela.

## Construction and observation

Construct one `CriaClient` per authenticated service and share it across the service's devices. Configuration pins the HTTP(S) origin, bearer token, durable `storeId`, and each endpoint-local device ID, kind and expected operational name. Construction performs no requests. Credentials stay on the server; redirects are refused.

`state()` shares concurrent reads. It validates the response and returns the state with measured round-trip and receipt times. A caller can abandon its wait without cancelling another consumer's shared read. Raw stale readings remain available for honest last-known display.

`observe(id)` waits for fresh identity and connection facts; it does not require unrelated device fields. Use `reading()` for a required fact and `optionalReading()` for an optional fact. Both check status, generation, read timing and transport delay. Dynamic fields use a six-second default age budget; pass `{ metadata: true }` for cached geometry and capability facts, whose default budget is 65 seconds. Name and connection are dynamic fields. Switch channels can use a copy of the device with `fields` set to the channel's readings.

Freshness uses the server's `generatedAt - readStartedAt`, the entire HTTP round trip, and monotonic time since receipt. This conservatively accounts for a slow field read and delayed transport without assuming the Windows and Vela clocks are synchronized. A response taking more than the configured state round-trip bound cannot supply current facts.

The first state pins the service incarnation and driver bindings. Later store, incarnation or binding changes block new writes. They never resume a previous observing workflow automatically. Create a new client only through an intentional composition change after the new ownership has been inspected.

## Operations

`run(id, command, options)` validates the operation parameters, observes the selected binding, then submits a client-generated request identity. It preserves the exact serialized request through a lost admission response: lookup first, then retry that same request when appropriate. It never changes an unresolved request to a fresh ID. Once cancellation is requested, a missing admission record is followed without resubmitting an exposure.

Unresolved admission blocks further commands on the client. A known operation with uncertain cleanup blocks its failure domain while unrelated domains remain usable. `commandBlockReason` and `commandBlockReasonFor(id)` expose these conditions. Errors retain the request and last observed operation for diagnosis. The client does not implement operator recovery or clear uncertainty automatically.

After admission, an aborted caller signal requests equipment cancellation and continues observing the outcome. `cancel()` acknowledges only a cleanup request. `cancelDevice(id)` requests cancellation of this client's owned work and waits for settlement. Neither method sends a separate competing motion or capture command. A naturally completed capture can still succeed during Stop.

`run()` resolves only for confirmed successful completion. It throws `CriaCancelledError` for confirmed cancellation, `CriaOperationFailedError` for settled failure, and `CriaUncertainError` when completion is unresolved. These extend `EquipmentError`; capability adapters translate known cancellation to their specific workflow errors. A local timeout never means equipment stopped. The operation observation allowance includes the requested exposure duration plus configurable driver cleanup and retention time.

`onProgress` receives a validated `CriaOperation`. `onReadState` reports interrupted observation until a fresh operation response arrives. `elapsedSeconds` is worker progress, including time spent waiting for cleanup; it is not measured shutter-open duration.

## Original ownership

`download(operation)` accepts only a confirmed capture and validates the original's operation, instance, device, binding, geometry and requested exposure. It checks the configured store again, downloads a bounded ImageBytes body, verifies length and SHA-256, and decodes geometry before returning `{ image, frame }`.

A transient transfer failure can retry the same original within `imageRetryMs` and remaining server retention. This never starts another exposure. Invalid metadata, checksum or encoding stops immediately. Completed originals can outlive an API incarnation; operation metadata does not extend their retention. Expired originals remain distinguishable from an uncertain physical operation.

After accepting the pixels, call `release(image.id)` separately. A failed best-effort release must not discard the acquired frame. The client drops its cleanup bookkeeping after the attempt; Cria's retention bounds temporary storage if release fails. No release is permitted before successful pixel acquisition.

## Focused verification

```sh
pnpm exec vitest run packages/cria/test/client.test.ts
pnpm --filter @vela/cria build
pnpm exec oxlint packages/cria
```

The transport fixtures exercise lost admission, identical retry, expiry, cancellation and settlement, domain isolation, identity changes, interrupted reads, clock-independent freshness, and original integrity/ownership. They never contact observatory hardware. Application integration against Cria's separate-process fixtures is verified at the server boundary.
