# Rig controls

One **Controls** button sits in the header of every rig page (Tonight, Explore the sky, Photographs,
Preparation, polar alignment, autofocus and Your rig). It opens a panel: a bottom sheet on a phone, a side panel
from 900 px up. The panel is the only place for the controls below; the pages that used to hold them keep readings
only. The spec is `bots/observer/specs/rig-controls/spec.md` in the home repo (Chris agreed it 2026-10-27).

`RigControls` (in the Shell, inside the rig observation) owns whether the panel is open, so the header button and a
page link (`useRigControls().open`, used by the Explore page's mount reminder) open the same panel.
`RigControlsPanel` mounts only while the panel is open. It calls `useCapture` for the cooler and the run, so the
capture poll runs only then, next to the page's own poll. It reads the Shell's rig observation for the mount and
for holds, and asks it for one fresh read when it opens: polar alignment pauses the periodic read, so what the
panel would show could be minutes old.

Sections, in this order. Each is present only when the rig has what it controls; with none, the panel says so.

## Mount

Tracking on or off, Unpark while the mount is not unparked, Home and Stop: `MountControls`. It disables a button
with the server's reason when the state does not permit the action, waits for the mount to confirm, and offers
Check mount state after an unknown outcome. It never repeats a command. Closing the panel mid-command keeps the
server's record; reopening reads it back.

**Home** opens a dialog titled "Are you sure?" with Cancel and "Home the mount", and nothing else. It is the same
kind of command as Unpark and tracking, with a request ID, so a lost reply is never replayed. The button reads
"Homing…" and the status line "Homing… Stop ends it." for as long as Cria's operation runs (tens of seconds; the
request waits up to 200 s), including in another browser or after a reload, because the server's record is
`pending`. When it confirms, the section shows "Home confirmed at HH:MM" in the browser's clock. The AM5 reports no
at-home state, so that is the last home Vela saw confirmed, not a reading. It disappears on the next slew Vela
commands or sees begin, another home, or a restart of Vela; a tracking change does not clear it. A home that is
stopped or whose outcome is unknown never shows it: a stopped home says "Homing was stopped." and an unknown one
resolves to "Home is not confirmed" once the mount is idle.

**Stop** has no confirmation and sits beside Home. It is enabled whenever the mount could be moving, which is
anything but a connected mount known to be still (parked, or idle with tracking off), so unknown readings, a
slew, homing and tracking all leave it on. It is never gated by the panel's own state: not by a pending home,
tracking or Unpark, not by an unknown outcome or Check mount state, not by a stale view, and not by a run holding
the rig. It sends `POST /api/rigs/:rigId/mount/stop` with `{deviceId}` and shows the answer: "Stopped. The mount
confirmed it is still.", or Cria's message when it did not confirm, with the button free to press again. While a
capture, alignment, autofocus or framing run holds the rig, Stop still goes to the mount and interrupts a run that is
moving it: a Stop that cannot reach a slewing mount is worse than one that ends a run. A rig whose mount Vela cannot
stop (Alpaca) shows it disabled with that reason; Home is Cria-only too.

## Cooler

`CoolerControls`: the cooler switch and the target temperature, with the sensor, requested temperature and power.
These are the capture page's former cooling card and the Observe page's former cooling block, now one component.
Confirmed CoolerOn, sensor temperature, requested setpoint and power are server projections. A sensor near the
requested temperature is not treated as cooling enabled. Cooler on/off and target temperature are separate commands;
setting a target does not turn the cooler on. Cooling is disabled while a capture run is active so Stop stays
available. Cooler command failures stay in this section and do not label capture unavailable.

When the server marks cooling `blockedBy` another operation, the switch is disabled and the section names what
holds the rig, with a link to alignment or autofocus where Chris can resolve it (`cooling-blocker.ts`). Command
feedback (blocker, refusal or unknown outcome) has one slot directly below the switch. The description above it never
changes with a command; the switch's own note and "Confirming cooler state…" share one cell, and a previous refusal
keeps its space invisibly while the next command confirms, so a tap never moves the control. While capture is
offline or a cooling outcome is unknown, the heading reads "Cooler · last known".

An uncertain command retains the affected setting until an explicit check observes it again: CoolerOn for a
switch command, requested setpoint for a temperature command. A fresh setting resolves uncertainty even if it differs
from the requested value; the panel shows the observed state rather than claiming the write won. Closing the panel
forgets the unknown outcome (the state lives in the panel's own `useCapture`); reopening reads the camera fresh and
shows what it reports, never the command's intent.

## Phone

The live Unattended switch (vela#198, #200), shown only while a run is active. It sends
`PUT /api/rigs/:rigId/capture/unattended` with `{on}` and shows the server's value, "Phone: on, unattended" or
"Phone: off". It stays available whenever a run is active and nothing else is mid-command, including during image
receipt. A 409 (the run ended) or a failed request shows its message under the switch and never marks the capture
command outcome unknown, because a switch cannot change what the camera is doing.

The start form on the capture page keeps its checkbox, because that choice belongs to the run being started. While a
run is active the capture page shows the server's value as text only. The switch is here and nowhere else.

## Clear hold

One row and one Clear hold button for each device Cria holds (quarantined, or a command whose outcome Vela does not
know). Your rig still lists the hold reason on the device row and says to clear it in Controls.

Clear hold opens a confirmation: the hold reason as Cria gave it, then "Clearing the hold tells Cria it is safe to
command <device> again. Only do this after you have checked the equipment." Only "I have checked it, clear the hold"
sends the request, and both buttons are disabled while it is in flight, so a double click sends once. The note is
generated ("Cleared from the Vela page by the operator at <time>"); nothing is typed.

| Reply | The panel |
| --- | --- |
| 200 | Closes the confirmation and refreshes the view; the hold disappears once Cria stops reporting it. |
| 409 `device-busy` | "An operation is still running on this device. Stop it first." The hold stays. |
| Any other failure | Shows the server's message in the confirmation. The hold stays. |

Vela never clears a hold by itself, and the control is separate from polar alignment's Stop.

## Layout and what comes next

The panel is a stack of sections; a section's buttons sit in a wrapping row, and the Mount row holds Unpark,
tracking, Home and Stop. The dew heaters get a section after Cooler. Park stays out: parking rotates the rig sideways
and the home is unknown after a restart.
