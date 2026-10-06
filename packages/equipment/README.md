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
