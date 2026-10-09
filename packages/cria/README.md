# Cria transport

`@vela/cria` is the server-side client for Cria's full .NET v2 service. It owns authenticated HTTP, wire validation, observation freshness, durable operation admission and temporary-original transfer. It follows `dotnet/contract/openapi.json` in Cria, including operation `elapsedSeconds`; the earlier prototype protocol is not supported.

The package depends on `@vela/equipment` for frame contracts and ImageBytes decoding. It imports no ALPACA implementation. Vela's capability adapters belong in `apps/server/src/cria`; repetition, autofocus decisions, plate solving, previews, FITS generation and archive ownership remain in Vela.

## Construction and observation

Construct one `CriaClient` per authenticated service and share it across the service's devices. Configuration pins the HTTP(S) origin, bearer token, durable `storeId`, and each endpoint-local device ID, kind and expected operational name. Construction performs no requests. Credentials stay on the server; redirects are refused.

Call `start()` at service composition to open one authenticated `/v2/events` stream shared by every configured device and operation. `state()` also starts the stream lazily. Call `close()` when composition shuts down; it releases the stream, timers and waiters without claiming that physical equipment stopped. There is no steady HTTP state polling path.

`state()` returns the latest validated full snapshot with transport-delay and receipt times. Concurrent readers share the subscription; one caller abandoning its wait does not cancel other consumers. The client retains one snapshot, accepts sequence gaps, ignores duplicates, and rejects backwards sequences. Events have a four-MiB bound. Complete heartbeat comments maintain transport liveness but never renew driver facts. Interrupted connections retry with bounded exponential backoff. New writes require facts accepted from the current connection; old snapshots remain unsuitable after reconnection.

`observe(id)` waits for fresh identity and connection facts; it does not require unrelated device fields. Use `reading()` for a required fact and `optionalReading()` for an optional fact. Both check status, generation, read timing and transport delay. Dynamic fields use a six-second default age budget; pass `{ metadata: true }` for cached geometry and capability facts, whose default budget is 65 seconds. Name and connection are dynamic fields. Switch channels can use a copy of the device with `fields` set to the channel's readings.

Required reads preserve transient interruption: pending/error/stale readings, refreshes, previous generations and excessive age or transport delay report a transport error, even when HTTP succeeded. Missing or unsupported required facts, malformed values and inconsistent timestamps remain invalid data. Alignment requires its pointing, geometry, site and tracking facts; optional elevation and pointing side may be omitted only when explicitly unsupported. Display telemetry can still omit unavailable optional fields without hiding the rest of the view. Unresolved ownership is a protocol error, never a retryable read interruption.

Freshness uses the server's `generatedAt - readStartedAt`, a conservative transport-delay bound, and monotonic time since receipt. Cria generates its initial snapshot after the subscription request: the complete connection round trip bounds that first snapshot's delay. Subsequent events compare elapsed server time with monotonic time since that anchor, so a delayed frame cannot become fresh merely by arriving. This does not compare absolute Windows and Vela clocks. Backwards service time, excessive delay, or a large forward clock discontinuity interrupts the stream and requires a new connection anchor. Heartbeats and snapshot envelopes do not change a field's read timestamps or generation.

The first state pins the service incarnation and driver bindings. Later store, incarnation or binding changes block new writes. They never resume a previous observing workflow automatically. Create a new client only through an intentional composition change after the new ownership has been inspected.

Confirmed admission invalidates locally cached facts for every device in the operation's failure domain. A fast HTTP completion cannot turn the pre-write snapshot into confirmation: subsequent reads require a newer observation generation with current fields. Cria invalidates the domain at admission and completion and accepts no poll results while its write lane is held, so generation establishes this ordering without comparing wall-clock timestamps. Explicit refresh replies impose the same generation boundary.

## Operations

`run(id, command, options)` validates the operation parameters, observes the selected binding, then submits a client-generated request identity. It preserves the exact serialized request through a lost admission response: lookup first, then retry that same request when appropriate. It never changes an unresolved request to a fresh ID. Once cancellation is requested, a missing admission record is followed without resubmitting an exposure.

Unresolved admission blocks further commands on the client. A known operation with uncertain cleanup blocks its failure domain while unrelated domains remain usable. `commandBlockReason` and `commandBlockReasonFor(id)` expose these conditions. Errors retain the request and last observed operation for diagnosis. The client does not implement operator recovery or clear uncertainty automatically.

After admission, an aborted caller signal requests equipment cancellation and continues observing the outcome. `cancel()` acknowledges only a cleanup request. `cancelDevice(id)` requests cancellation of this client's owned work and waits for settlement. Neither method sends a separate competing motion or capture command. A naturally completed capture can still succeed during Stop.

Operation progress and completion come from the same state stream. HTTP operation reads are reserved for a missing operation, an interrupted connection, or observation that has stopped advancing; these gaps reconcile at a paced interval until events resume or the existing observation allowance expires. This covers Cria's bounded recent-terminal list without polling alongside healthy operation events. Reconnection never dispatches a replacement command. HTTP remains responsible for durable admission lookup, explicit cancellation and original transfer.

`run()` resolves only for confirmed successful completion. It throws `CriaCancelledError` for confirmed cancellation, `CriaOperationFailedError` for settled failure, and `CriaUncertainError` when completion is unresolved. A cancelled error with `operation: null` establishes that no admission request was sent; otherwise it retains the settled operation. These extend `EquipmentError`; capability adapters translate known cancellation to their specific workflow errors. A local timeout never means equipment stopped. The operation observation allowance includes the requested exposure duration plus configurable driver cleanup and retention time.

A transient observation failure before admission throws `CriaNotAdmittedError`. It establishes that no command was dispatched. The acquisition adapter translates this into `CaptureRetryableError`, allowing alignment to retain its baseline and retry at its existing cancellable cadence. Ownership uncertainty, failures after dispatch, and original-transfer failures never grant permission to repeat an exposure.

`onProgress` receives a validated `CriaOperation`. `onReadState` reports interrupted observation until a fresh operation response arrives. `elapsedSeconds` is worker progress, including time spent waiting for cleanup; it is not measured shutter-open duration.

## Original custody

Cria protocol 3 keeps every original until it accepts an archive receipt. The client requires `protocolVersion: 3` on its first state read, so an older Cria is refused before any command is admitted.

`download(operation)` accepts only a confirmed capture and validates the original's operation, instance, device, binding, geometry and requested exposure. It checks the configured store again, downloads a bounded ImageBytes body, verifies length and SHA-256, and decodes geometry before returning `{ image, frame, original }`. `original` holds the exact verified bytes so the caller can preserve them before processing. If the stream is interrupted after an operation's terminal result was confirmed, a bounded HTTP state read reconciles store identity; loss of the stream alone does not discard a reachable original. A transient transfer failure retries the same original within `imageRetryMs`. Invalid metadata, checksum or encoding stops immediately. None of these paths starts another exposure.

Existing results are reached through custody, independently of an operation's outcome:

- `custody(imageId)` reads Cria's record in any state (reserved, retained, quarantined, absent, archived, released, missing, legacy-removed).
- `retainedOriginals(after)` pages verified originals still awaiting archive.
- `originalOf(record)` transfers the same verified bytes for a retained or archived record. It works while the operation that produced it remains uncertain and never clears the command interlock.
- `acknowledgeArchive(receipt)` sends an exact-byte receipt after Vela has verified its archive. Repeating the same receipt is safe; Cria rejects a different receipt or mismatched identity with `receipt-conflict`.

- `decodeOriginal(operation, original)` decodes the same original from another verified source, such as Vela's archive after Cria released its copy. The bytes must still match the confirmed capture's digest and length.

`run()` accepts `beforeAdmission(request)`, awaited after the exact request (including its request ID) is built and before it is sent. A failure there means nothing was sent. Callers use it to record intent and ownership before Cria can act on the request.

There is no release call. Cria deletes its redundant copy only after accepting a receipt, and only when its own release setting allows it. When Cria has stopped admission after an essential storage failure, `state.admissionStoppedReason` explains why and write attempts fail with that reason.

## Focused verification

```sh
pnpm exec vitest run packages/cria/test/client.test.ts packages/cria/test/events.test.ts
pnpm --filter @vela/cria build
pnpm exec oxlint packages/cria
```

The transport fixtures exercise lost admission, identical retry, custody reads, archive receipts, protocol refusal, cancellation and settlement, domain isolation, identity changes, interrupted reads, clock-independent freshness, and original integrity/ownership. They never contact observatory hardware. Application integration against Cria's separate-process fixtures is verified at the server boundary.
