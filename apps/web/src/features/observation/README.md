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

Observe now composes Fieldroom capture preparation: the selected subject,
last matching temporary framing exposure, capture settings, confirmed camera
cooling and equipment context. One `useCapture` owns Start and cooling; the old
CaptureHub is removed. Existing active capture opens Tonight instead of starting
a second run. Framing Continue carries explicit target intent but takes no image.
Only a confirmed successful Start response navigates to Tonight; uncertain or
failed responses remain here with explicit state inspection and no replay.

`RigReadiness` preserves device connection and result semantics when preparation
is incomplete, interrupted or has a connection outcome to explain. Successful
connection is still not permission for every observing activity. Autofocus,
Polar alignment and Equipment remain explicit links.

Camera selection is a browser draft until the existing ID-and-name save boundary
confirms it. Start remains unavailable for a changed unsaved camera. A confirmed
selection triggers a readiness read, never a capture command. Cooling switch and
setpoint are distinct commands; a sensor near its requested value is not proof
that the cooler is on. Capture can start while confirmed cooling continues.

The equipment footer shares the same selected-camera cooling projection as its
controls and the shared rig observation for focuser state. See
[imaging camera](../imaging-camera/README.md) for configuration-write reconciliation.
