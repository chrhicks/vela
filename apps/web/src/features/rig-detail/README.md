# Equipment

The shell's keyed `RigObservationProvider` owns the only rig-detail poller. Polar
alignment reads the same devices every few seconds, so on its page the poller keeps
its first observation and pauses periodic inspection; leaving the page refreshes at
once. Other open Vela pages for the rig still poll.
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

## Clear hold

A device Cria holds (quarantined, or a command whose outcome Vela does not know)
carries `observation.hold` with Cria's reason and the id the recover route takes.
Its Equipment row shows the reason and a Clear hold button outside the collapsed
details, so a phone at the rig sees it without opening anything. The button is
the only recovery control; a device that is not held never shows it, and one
button clears one device.

Clear hold opens a confirmation: the hold reason as Cria gave it, then
"Clearing the hold tells Cria it is safe to command <device> again. Only do this
after you have checked the equipment." Only "I have checked it, clear the hold"
sends the request, and both buttons are disabled while it is in flight, so a
double click sends once. The note is generated ("Cleared from the Vela page by
the operator at <time>"); nothing is typed.

| Reply | The page |
| --- | --- |
| 200 | Closes the confirmation and refreshes the view; the hold disappears once Cria stops reporting it. |
| 409 `device-busy` | "An operation is still running on this device. Stop it first." The hold stays. |
| Any other failure | Shows the server's message in the confirmation. The hold stays. |

Vela never clears a hold by itself, and the control is separate from polar
alignment's Stop.
