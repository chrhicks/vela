# Autofocus

One-shot Star-HFR session owned by the server. Capture still uses conservative
star measurements. This walk uses `measureAutofocusStars` at focuser positions
around the **current** EAF position, takes a coarse pass and then a fine pass, and
lands on what it measured.

Start commands the same inspected focuser that made the idle view enabled, not a
later inventory lookup. Start is the focuser position when the session begins.
Cancel and failure restore that start. Position 0 is a mechanical stop, not a home; the adapter will not
command it. A coarse window that cannot fit around start, including a reported start of
0, returns to setup without moving and does not claim a restore. Idle setup
includes MaxStep from focuser inspection so the page can preview that limit.
This slice does not read or write focuser backlash compensation, so setup does
not present it as a device fact. “Backlash zero” would mean compensation off,
not EAF position 0.

## Coarse pass, fine pass, landing

```
coarse   150 steps apart, 4 each side of the start      (±600)
fine      25 steps apart, 6 each side of the coarse minimum (±150)
landing  fitted position (or best fine sample), confirm frame, fall back once
```

The three recorded runs of 2026-10-31 are why. Run 1 (step 50) failed with its
minimum at the window's edge. Run 2 (step 100) fitted well and landed 15 % worse
than a measured sample. Run 3 (step 50) fitted 32562, HFR 2.59, while 32524 had
measured 1.75. One hand-picked step size could not serve an unknown starting
error, and a fit could land worse than a place already measured.

**A pass** samples its planned positions from the top down, then looks at the
lowest HFR (`passes.ts`). It is closed when that sample has a sampled position on
both sides, so HFR rose away from it either way. When it sits at an edge the window
moves one step that way, toward the lower HFR, and samples again, up to the
focuser travel (`FocuserTravel`, from the focuser's reported MinStep and MaxStep).
An edge minimum never fails a pass. A sample with no stars counts as worse than any
measured one. A pass fails only when it measured no star, or when HFR is still
falling at the end of travel; both restore the start.

**The coarse pass** is centred on the start. Its lowest sample centres the fine pass.
The coarse window must fit the travel at start, as the one window did before, or the
run returns to setup without moving. The fine window is clipped to the travel.

**The fine pass** (`choice.ts`) feeds its samples to the robust fit in
`hyperbola.ts`. It weights each sample by the spread of its stars' HFRs, fits only the
V around the minimum, where HFR keeps rising with defocus, and gates on the weighted R².
The recorded high side of run 3 was flat (2.4 to 2.8 from 32574 to 32674), and the old
fit over every sample was pulled onto that plateau. If the fit passes its gate and its
vertex lies inside the sampled positions it gives the landing position. Otherwise the
position is the best measured fine sample (`landing.attempts[0].source` is
`best-sample`, and `fit` is null).

**Landing** comes down onto its target from above like every move that ends a run (next
section), takes a confirm frame (`pass: 'confirm'`), and compares its HFR with the best
fine sample's. Within `confirmTolerance` (0.1, so 10 %), the run is `confirmed`. Worse by
more, and the target was not already the best sample, the focuser goes to the best
sample, again from above, and takes a second confirm frame: `fell-back` if that one is
within tolerance, otherwise `unconfirmed`. A first target that was already the best sample
that confirms badly is `unconfirmed` straight away. Vela does not search again. A frame
with no stars never confirms. Every run that reaches the end is `complete`; read
`landing.outcome` for how far to trust it.

Settings, all optional on the start request and in `AutofocusRunOptions`:

| Field | Default | Meaning |
|---|---|---|
| `stepSize`, `offsetSteps` | 150, 4 | The coarse pass: step, and steps each side of the start. |
| `fineStepSize`, `fineOffsetSteps` | 25, 6 | The fine pass around the coarse minimum. |
| `confirmTolerance` | 0.1 | How much worse than the best fine sample a confirm frame may be. Above 0, at most 1. |
| `exposureSeconds` | 2 | |

The 300-step overshoot, the three step sizes and the 10 % are starting values. They have
not been tuned on the rig.

## Final approach from above

The EAF has backlash, so the side a move arrives from changes where the optics
land. Every sample therefore follows a downward move. A sample below the focuser's
position is one move. One at or above it goes first to `target + APPROACH_OVERSHOOT_STEPS`
(300, in `walk.ts`), then down onto the target. This includes the first coarse sample and
the first fine one, and an extension upward. Every move that ends a run comes down onto
its target the same way:

- the landing, on the fitted position or the best sample;
- the fall back to the best sample;
- the return to the start after a failure or Stop.

The overshoot is clamped to the focuser travel; at the very top of travel there is no
room above, and the move goes direct. The 300 is a guess at several times the EAF
backlash, not a measurement on this rig.

The view's `finalApproach` records the last run-ending move (`purpose`, `target`, `via`;
`via` is null for a direct move; `purpose` is `best-focus` for the fitted position,
`best-sample`, or `restore-start`), so a real night can confirm it.

Each short exposure appends `(position, HFR)` to the view immediately so the
Observe graph can grow as the walk runs. `phase` is `walking` through both passes,
`fitting`, then `confirming` for the landing. Each sample's `pass` says which pass took
it.

An acknowledged short exposure can remain pending while the adapter retries
transport reads. `captureReadState` shows that interruption without changing the
walk phase or exposing activity. Recovery does not append a sample or advance the
focuser: those wait for the actual frame and measurement. Prior sample timestamps,
the current position and the operation lease remain intact. Stop clears the read
indicator and waits for camera cleanup and restoration; settled or cancelled
capture callbacks cannot revive it.

## Star tables

Each sample is measured from a list of stars. The walk reads the count and the median
HFR, and the fine pass's fit also reads the spread of the star HFRs to weight the sample.
The list is also recorded, so a later estimator can be tried on real runs without a new
night. With or without a table the walk takes the same positions; a sample with no table is
weighted on its count alone.

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
  "startedAt": "2026-10-31T23:44:08.359Z",
  "settledAt": "2026-10-31T23:46:10.000Z",
  "phase": "complete",
  "error": null,
  "startPosition": 32474,
  "stepSize": 150,
  "offsetSteps": 4,
  "fineStepSize": 25,
  "fineOffsetSteps": 6,
  "confirmTolerance": 0.1,
  "travel": { "min": 15500, "max": 38000 },
  "exposureSeconds": 2,
  "fit": { "position": 32531, "p": 32530.6, "a": 1.44, "b": 44.2, "rSquared": 0.986, "minSamplePosition": 32524 },
  "landing": {
    "position": 32524,
    "outcome": "fell-back",
    "bestSample": { "position": 32524, "hfrPixels": 1.753 },
    "tolerance": 0.1,
    "attempts": [
      { "source": "fit", "position": 32531, "sampleIndex": 22, "hfrPixels": 2.1, "withinTolerance": false },
      { "source": "best-sample", "position": 32524, "sampleIndex": 23, "hfrPixels": 1.78, "withinTolerance": true }
    ]
  },
  "airTemperatureC": { "start": 9.1, "end": 9.2 },
  "samples": [
    {
      "position": 33074,
      "pass": "coarse",
      "detectedStars": 3,
      "hfrPixels": 19.1,
      "capturedAt": "2026-10-31T23:44:12.000Z",
      "stars": [{ "x": 99, "y": 274, "snr": 1025.6, "hfr": 19.2 }]
    }
  ]
}
```

- `samples` are in the order measured: the coarse pass, the fine pass, then one or two
  confirm frames. The same position can appear more than once (the fit's position can
  equal a sample's, and the fine pass revisits the coarse minimum), so match a sample by
  its index, not its position. Each sample is exactly the `AutofocusSample` of the view,
  plus `stars`. `pass` is `coarse`, `fine` or `confirm`; a record from before the two-pass
  walk has no `pass` and its `fit` came from one pass over all its samples.
- `stepSize` and `offsetSteps` are the coarse pass, which is what they meant when there was
  one pass. `fineStepSize`, `fineOffsetSteps`, `confirmTolerance` and `travel` are new, and
  absent from older records. `travel` is the range of positions the run could command and
  the limit of every window extension. A pass that ended in the travel limit says so in
  `error`.
- `fit` is the fine pass's fit, or null when the fine pass had no usable fit and the run used
  its best measured sample. It is also kept when the first confirm frame sent the focuser
  elsewhere, because it is what was tried. `landing` says where the run left the focuser.
  It is null until the landing finishes, and for a run that failed or was stopped first.
- `landing.attempts[i].sampleIndex` is the index in `samples` of that attempt's confirm
  frame. `outcome` is `confirmed` (the first confirm frame was within `tolerance` of the best
  fine sample), `fell-back` (it was not, the focuser went to the best sample, and that frame
  was), or `unconfirmed` (the last frame was not).
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
- A run that fails or is stopped is recorded too, with its `phase` and `error`. Its
  `fit` is the fit the walk had reached, or null if it reached none. A stop or failure
  during the confirming sample keeps the fit, yet the focuser went back to
  `startPosition`, so `fit.position` is where the run chose to go, not where the
  focuser ended. Only a `complete` run ended at `landing.position`. `settledAt` is null
  only in the live route, during the walk.

- `airTemperatureC` is the air temperature in degrees Celsius when the run began and when it
  settled, so a run's best focus can be set against it. Best focus moved about 14 steps per degree
  on this rig, and the EAF has no temperature compensation. It is the reading the rig page shows
  as `temperatureC` for the rig's observing-conditions device (the Pegasus PPBA on the FRA 400). The
  start is the reading from the check that the rig was ready, so it adds no read. The end is one more
  read that starts when the walk finishes and runs beside the restore. It is abandoned after 3 s.
  Either is `null`, never a guess, when the rig has no such device, it reports no temperature, it is
  disconnected, its reading is last-known after an interruption, two devices report, or the read
  failed or ran out of time. A `null` never fails or delays the walk. A run recorded by a build
  before this has no `airTemperatureC`. In the live route the end is `null` until the run settles.

Size: a star is about 50 bytes of JSON. A run is now about 23 samples (9 coarse, 13 fine,
1 or 2 confirm) plus any extension. At the cap of 100 stars that is at most about 120 KB,
and a rich field out of focus usually has 20 to 60 stars a sample, so about 50 KB. A night
of ten runs is about 0.5 MB.

To list a run's landing, its confirm frames and the air temperature:

```sh
jq -c 'select(.phase == "complete") | {startedAt, landed: .landing.position, outcome: .landing.outcome, best: .landing.bestSample, confirm: [.landing.attempts[] | [.position, .hfrPixels]], airC: .airTemperatureC}' autofocus.jsonl
```

Two runs at the same air temperature should land within 25 steps of each other, and the
confirm HFR within 10 % of the best sample. That is the check on a real night, and the
runs' landing against air temperature builds the focus-against-temperature model.

Stop takes no input. Send it as a POST with an empty body. Any non-empty body, `{}` included, is
refused with 400 under every content type and the request does nothing; a `Content-Type` header on
an empty body is ignored. A refused stop leaves the walk going.

Stop during measurement still restores the start, including a confirm frame. Only typed cancellation confirmed by a device boundary is reported
as stopped; camera abort or cleanup failures remain failed even when return to the
starting focuser position succeeds.

## Replay on recorded runs

`focus-replay.test.ts` runs the pass logic and the estimator over five runs recorded on the rig
(`fixtures/recorded-focus-runs.ts`: positions, star counts and HFR values only), with no focuser
and no camera. A recorded sample stands in for the exposure at its position. It pins that on the
third run of 2026-10-31 the estimator lands within 25 steps of the measured best (32524) where
the old fit chose 32562, that the first run's window extends twice and closes instead of failing,
and that the confirm check would have rejected both of that night's bad landings. Run it before
changing `passes.ts`, `choice.ts` or `hyperbola.ts`.

```sh
pnpm exec vitest run apps/server/src/autofocus apps/server/src/imaging/statistics.test.ts apps/server/src/capture/frame-records.test.ts packages/alpaca/src/focuser.test.ts
```
