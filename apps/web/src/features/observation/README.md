# Observation readiness

`/rigs/:rigId/observe` is browser navigation, not a durable observation or a
Start/End API. It redirects to Tonight at `/rigs/:rigId/observe/capture`. The
server owns connection eligibility and device sequencing. The browser renders
`RigObservationView`; it does not derive eligibility from individual device
kinds or claim preparation is permission for every activity.

The API boundary validates both reads and command results. One mounted page
allows one request at a time. Polling pauses during a command and while hidden;
leaving the page aborts its request. A different Rig mounts fresh page state.
Last-known observations remain visible and marked when refresh fails.

An explicit Connect devices action sends one POST. Its result includes a fresh
view and separately describes the last attempt. A missing or invalid command
response triggers a read, never a replay. The uncertainty notice remains until
an explicit check confirms preparation as available or complete. Background
reads can update observed state without claiming that the command succeeded.

Use the approved workshop specimen as a visual reference, with web-owned markup
and state composed from stable `@vela/ui` primitives. The production wording
must remain accurate for unsupported devices and partial telemetry as well as
the specimen's simple fixtures.

Tonight composes `RigReadiness` in its Before you shoot region. It stays hidden
while the rig is prepared and appears when a connection needs attention, a read
fails, or a command outcome is unknown. Device counts, observation age and the
last connection attempt remain in its local disclosure. Check state reads rather
than replays a command. A check that resolves readiness returns focus to Take
exposure, or to the exposure settings if another precondition still disables it.
Connecting devices, an interrupted read or an unknown connection outcome holds
Take exposure until a fresh check; successful connection does not create a new
all-devices-ready capture policy.

`BeforeYouShoot` summarizes the selected camera's cooling projection and the
shared rig observation's focuser state, and links Polar alignment and Autofocus.
The Rig page owns imaging-camera choice and focal length; see
[imaging camera](../imaging-camera/README.md) for configuration-write
reconciliation.
