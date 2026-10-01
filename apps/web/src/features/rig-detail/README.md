# Equipment

The shell's keyed `RigObservationProvider` owns the only rig-detail poller.
Equipment consumes that observation, preserving last-known telemetry when a
read fails and exposing each device's complete supported metrics in a disclosure.
The saved imaging camera sorts first only when the camera projection's
`selectedDeviceId` and reported name match a rig-detail device. The server resolves
this association: saved selection IDs and rig-detail IDs have different scopes.
Mount/focuser, other cameras and other device kinds follow.

Connection eligibility and command outcomes come from `useObservation`, not
from device cards. Equipment reuses `ConnectionResult` for per-device outcomes
and refreshes the shell observation after a completed command or explicit check.
An uncertain connection requires inspection before another explicit attempt.
Opening Equipment or a preparation link sends no device commands.

Imaging setup composes the camera and focal-length configuration capabilities.
Rig identity keys the page so drafts and uncertainty cannot cross into another
rig. Secondary endpoint/inventory facts and Forget stay under Rig details in
the freshness footer. Forget begins with focus on Cancel, blocks duplicate writes
and dismissal while pending, and retains an unknown outcome across dismissal.
Its explicit Check saved rigs uses the validated Home projection: absence confirms
removal; presence permits a later explicit DELETE. A confirmed removal navigates
to Home, whose route-local provider mounts with a fresh catalog read.
The inspection read has a five-second deadline so a stalled request cannot lock
the dialog. Timeout restores dismissal and keeps the unknown outcome for the
next explicit check; it never enables an uninspected DELETE retry.
