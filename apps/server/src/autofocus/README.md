# Autofocus

One-shot Star-HFR session owned by the server. Capture still uses conservative
star measurements. This walk uses `measureAutofocusStars`, a bounded focuser
window around the **current** EAF position, and a hyperbola fit.

Start commands the same inspected focuser that made the idle view enabled, not a
later inventory lookup. Start is the focuser position when the session begins.
Cancel and failure restore that start. Position 0 is a mechanical stop, not a home; the adapter will not
command it. A window that cannot fit around start, including a reported start of
0, returns to setup without moving and does not claim a restore. Idle setup
includes MaxStep from focuser inspection so the page can preview that limit.
This slice does not read or write focuser backlash compensation, so setup does
not present it as a device fact. “Backlash zero” would mean compensation off,
not EAF position 0.

## Final approach from above

The EAF has backlash, so the side a move arrives from changes where the optics
land. The walk samples every position after a downward move (it starts at the top
of the window and steps down), so the fit describes the focuser as it sits after
coming down. Every move that ends a run therefore comes down onto its target too:

- the confirming move to the fitted best focus;
- the return to the start after a failed fit, a failure or Stop.

Each goes first to `target + APPROACH_OVERSHOOT_STEPS` (300, in `walk.ts`), then
down onto the target, so the slack is taken up the same way the samples saw it.
The overshoot is clamped to the focuser travel. It may pass above the walk window
by up to that amount, never beyond travel. At the very top of travel there is no
room above, and the move goes direct. The 300 is a guess at several times the EAF
backlash, not a measurement on this rig. The curve fit is unchanged.

The view's `finalApproach` records the last such move (`purpose`, `target`, `via`;
`via` is null for a direct move), so a real night can confirm it. The walk's first
sample still follows an upward move from the start to the top of the window, so it
carries any backlash offset the later samples do not.

Each short exposure appends `(position, HFR)` to the view immediately so the
Observe graph can grow as the walk runs. The fit is the hyperbola minimum inside
the sampled window. The lowest sampled HFR is comparison only.

An acknowledged short exposure can remain pending while the adapter retries
transport reads. `captureReadState` shows that interruption without changing the
walk phase or exposing activity. Recovery does not append a sample or advance the
focuser: those wait for the actual frame and measurement. Prior sample timestamps,
the current position and the operation lease remain intact. Stop clears the read
indicator and waits for camera cleanup and restoration; settled or cancelled
capture callbacks cannot revive it.

Stop needs no body, the same as capture stop: a bare POST, an empty body or `{}` are
accepted, and any other body is refused with 400 while the walk keeps going.

Stop during measurement still restores the start, including the final confirmation
measurement. Only typed cancellation confirmed by a device boundary is reported
as stopped; camera abort or cleanup failures remain failed even when return to the
starting focuser position succeeds.

```sh
pnpm exec vitest run apps/server/src/autofocus apps/server/src/imaging/statistics.test.ts packages/alpaca/src/focuser.test.ts
```
