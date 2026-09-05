# Observation workspace

`/rigs/:rigId/observe` is browser navigation, not a durable observation or a
Start/End API. The server owns connection eligibility and device sequencing.
The page renders `RigObservationView`; it does not derive eligibility from
individual device kinds or claim preparation is permission for every activity.

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

Observe is the activity hub. Preparation details collapse when complete; Capture
and Polar alignment remain prominent entry points. The Capture tile reads the
same server-owned capture projection as the Capture page, preserving the last
loaded image with its metadata. Preparation and capture availability remain
separate facts; completing device connection does not imply capture support.

The imaging-camera setting sits between preparation and activities. Its saved
identity comes from the rig catalog; see [imaging camera](../imaging-camera/README.md).
