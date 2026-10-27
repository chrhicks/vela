# `@vela/equipment`

Small capability contracts shared by server-side equipment adapters. Acquisition,
framing, focuser motion, cooling, inventory, inspection and connection have separate
interfaces. They describe normalized observations and confirmed operation outcomes;
they do not select adapters, discover equipment, own workflow state or perform I/O.

The package has no runtime dependencies. Browser page projections remain in
`@vela/model`; protocol clients and device behavior remain in their adapters.
`EquipmentProvider` only composes the existing inventory, inspection and connection
interfaces for adapters that implement all three. Consumers can depend on each
capability separately.

`EquipmentError` retains boundary failure classification and cause. Adapters may
subclass it to preserve protocol-specific diagnostic names. Confirmed cancellation
has distinct capture, focuser and framing errors; an aborted HTTP request alone
must never produce one. `CaptureRetryableError` means a fresh exposure is safe
because no exposure began or its cleanup confirmed that the camera is idle.

`@vela/equipment/image-bytes` is a separate ASCOM ImageBytes v1 wire primitive.
It validates the binary envelope and decodes rank-two Int32 source images into
row-major pixels. `ImageBytesError` distinguishes malformed data from an encoded
device error. It knows nothing about HTTP, URLs, bearer tokens or Alpaca clients.
Adapters translate its error into their own boundary context.

The Alpaca package retains its existing public and internal decoder entrypoints
as compatibility exports and wrappers, so existing consumers need not migrate
with the extraction.

`MountControl` exposes fresh parked/tracking/motion facts and the explicit Unpark
or tracking on/off commands, Home, and Stop. Missing booleans remain unknown. Home needs `canFindHome` and a
stationary unparked mount; it is always sent, because the AM5 reports no at-home state, and `homeConfirmedAt`
records when the adapter last saw one confirmed. Stop is the exception to "check, then write once": it needs no
readings, is safe to repeat, and `canStop` says whether the adapter has one. A home a Stop ended is `failed` with
reason `stopped`. Adapters check
identity, connection, stationary state and the relevant capability before one
write, and distinguish confirmed readback, known failure and unresolved outcome.
It does not compose unpark, tracking and motion into a workflow.

`SwitchControl` writes one channel of a power box (`set({ switchId, channelId, value })`), once, and returns the
value the device reports holding. It offers no reading and no list of channels; the caller chooses which channels
it may write. The device decides whether a value is allowed; Cria, for instance, refuses a duty off a channel's step.
