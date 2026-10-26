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

## Star tables

Each sample is measured from a list of stars, and only the count and the median HFR
reach the walk and the fit. The list is also recorded, so a later estimator can be
tried on real runs without a new night. Recording changes nothing the walk does:
the measurement policy, the samples, the fit and the final approach are the same
with or without it.

Where to read a run:

- `GET /api/web/rigs/:rigId/autofocus/run` returns the current or last run held in
  memory, growing as the walk takes samples. It is 404 until the first sample, and
  lost on a restart. The polled `AutofocusView` carries no star lists, to stay small.
- `VELA_AUTOFOCUS_RECORDS_PATH` names a JSONL file. When it is set, the server
  appends one line when a run settles, whatever the outcome, if it took at least one
  sample. It is off when unset. A write failure, or a backlog over 1 MiB, turns
  recording off until restart and logs why once. The walk is never affected. It uses
  the same appender as the frame records (`apps/server/src/records.ts`).

Both are an `AutofocusRun` (`packages/model/src/web/autofocus.ts`):

```json
{
  "version": 1,
  "rigId": "fra 400",
  "startedAt": "2026-10-26T03:10:00.000Z",
  "settledAt": "2026-10-26T03:11:05.000Z",
  "phase": "complete",
  "error": null,
  "startPosition": 32842,
  "stepSize": 50,
  "offsetSteps": 4,
  "exposureSeconds": 2,
  "fit": { "position": 32838, "p": 32837.9, "a": 2.27, "b": 99.9, "rSquared": 0.999, "minSamplePosition": 32842 },
  "samples": [
    {
      "position": 33042,
      "detectedStars": 35,
      "hfrPixels": 5.184,
      "capturedAt": "2026-10-26T03:10:04.000Z",
      "stars": [{ "x": 99, "y": 274, "snr": 1025.6, "hfr": 5.185 }]
    }
  ]
}
```

- `samples` are in the order measured, the confirming sample last. The same position
  can appear twice, so match a sample by its index, not its position. Each sample is
  exactly the `AutofocusSample` of the view, plus `stars`.
- `stars` lists the stars that passed every gate of the autofocus policy, brightest
  flux S/N first, capped at `autofocusStarTableLimit` (100, in
  `apps/server/src/imaging/statistics.ts`). `detectedStars` still counts every star
  that passed, so `stars` is shorter than it only when the cap bit.
- A star is `x` and `y` in native sensor pixels (a merged blend is its centre), `snr`
  the flux signal-to-noise in the 40 px aperture, and `hfr` the half-flux radius in
  pixels. They are rounded to 0.1 px, 0.1 and 0.001. `hfrPixels` is the median of the
  unrounded HFRs of all passing stars, so the table's median can differ in the last
  digit, and by more when the cap bit.
- A sample whose measurement failed, or one recorded by a build before this, has
  `detectedStars: 0` or an empty `stars`. Read an empty list as "no table", not "no
  stars".
- A run that fails, is stopped, or fits nothing is recorded too, with its `phase`,
  `error` and a null `fit`. `settledAt` is null only in the live route, during the walk.

Size: a star is about 50 bytes of JSON. A simulated 10-sample run of about 25 stars a
sample is 12.6 KB. A run of 12 samples with the cap reached is at most about 60 KB,
and a rich field out of focus usually has 20 to 60 stars a sample. A night of ten
runs is under 1 MB.

To list a run's chosen focus and star counts:

```sh
jq -c '{startedAt, phase, fit: .fit.position, stars: [.samples[] | [.position, .detectedStars, (.stars | length)]]}' autofocus.jsonl
```

Stop needs no body, the same as capture stop: a bare POST, an empty body or `{}` are
accepted, and any other body is refused with 400 while the walk keeps going.

Stop during measurement still restores the start, including the final confirmation
measurement. Only typed cancellation confirmed by a device boundary is reported
as stopped; camera abort or cleanup failures remain failed even when return to the
starting focuser position succeeds.

```sh
pnpm exec vitest run apps/server/src/autofocus apps/server/src/imaging/statistics.test.ts apps/server/src/capture/frame-records.test.ts packages/alpaca/src/focuser.test.ts
```
