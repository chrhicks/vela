# Autofocus

One-shot Star-HFR session owned by the server. Capture still uses conservative
star measurements. This walk uses `measureAutofocusStars`, a bounded focuser
window around the **current** EAF position, and a hyperbola fit.

Start is the focuser position when the session begins. Cancel and failure restore
that start. Position 0 is a mechanical stop, not a home; the adapter will not
command it. A window that cannot fit around start, including a reported start of
0, returns to setup without moving and does not claim a restore. Idle setup
includes MaxStep from focuser inspection so the page can preview that limit.
This slice does not read or write focuser backlash compensation, so setup does
not present it as a device fact. “Backlash zero” would mean compensation off,
not EAF position 0.

Each short exposure appends `(position, HFR)` to the view immediately so the
Observe graph can grow as the walk runs. The fit is the hyperbola minimum inside
the sampled window. The lowest sampled HFR is comparison only.

```sh
pnpm exec vitest run apps/server/src/autofocus apps/server/src/imaging/statistics.test.ts packages/alpaca/src/focuser.test.ts
```
