# Autofocus

One-shot Star-HFR session owned by the server. Capture still uses conservative
star measurements. This walk uses `measureAutofocusStars`, a bounded focuser
window around the **current** EAF position, and a hyperbola fit.

Start is the focuser position when the session begins. Cancel and failure restore
that start. Position 0 is a mechanical stop, not a home; the adapter will not
command it. Backlash compensation is off (0 in / 0 out).

Each short exposure appends `(position, HFR)` to the view immediately so the
Observe graph can grow as the walk runs. The fit is the hyperbola minimum inside
the sampled window. The lowest sampled HFR is comparison only.

```sh
pnpm exec vitest run apps/server/src/autofocus apps/server/src/imaging/statistics.test.ts packages/alpaca/src/focuser.test.ts
```
