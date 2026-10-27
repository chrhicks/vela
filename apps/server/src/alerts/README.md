# Alerts

Tells Chris when a capture run goes wrong, on screen always and on his phone only when the run is
[Unattended](#unattended). It never stops capture or moves the mount.

- `rules.ts` is pure: a rig's history in, the conditions that hold now out. All the numbers live in
  `thresholds.ts`.
- `monitor.ts` keeps that history for one rig, feeds the rules, and turns conditions into episodes.
- `pushover.ts` is the phone, behind the `Notifier` interface in `notifier.ts`. `config.ts` reads
  `alerts.json`. `mount.ts` reads a Cria rig's mount. `routes.ts` is the HTTP surface. The browser side (banner and rig-page card) is
  `apps/web/src/features/alerts`; its contract is `AlertsView` in `@vela/model/web`.

## Star counts

The count every star alert compares is the run's `strong` stars: measured stars with a flux
signal-to-noise of 100 or more (`alertCountInput` in `frame.ts`). It is steadier than `measured` where
it matters. The usable `stars-declining` threshold range is 0.09 wide with it (a slow fall caught at
0.57, a healthy night quiet to 0.66) and no wider than a point with `measured`. A camera that smears
the stars takes it to zero one frame sooner. The bench numbers are in `thresholds.ts`.

Frames from a real night swing about 2x with nothing wrong, so no rule compares one frame. Every
comparison uses the median of the last `starsSmoothingFrames` (3) frames. The numbers and their
reasons are in `thresholds.ts`; the 2026-10-18 night they were first checked against is
`fixtures/night-20261018-frames.json`.

A frame enters the history only through `alertFrame` (`frame.ts`), and only if its statistics are of
the running algorithm version and carry the named outputs. The history is in memory and starts over
with each run, a new server and an autofocus, so a count of one version never meets a count of
another; `alertFrame` keeps that true if a record of another version ever arrives. A frame without
its named outputs is a frame whose measurement failed: it is not in the history, and it is never
zero stars.

| Alert | Level | Raised when | Clears when |
| --- | --- | --- | --- |
| `stars-dropping` | warn | The smoothed count is below `1 - starsDropFraction` (0.5) of its highest value within the last `starsDropWindowMinutes` (10), for `confirmFrames` frames. A rate of change, in time, so it means the same at 30 s and 180 s exposures. | The smoothed count is back above `starsRecoveredRatio` (0.5) of the baseline for `confirmFrames` frames. |
| `stars-collapsed` | critical | The smoothed count is below `starsCollapsedRatio` (0.15) of the baseline, or the frame is empty (0 stars on a baseline of 3 or more, counted at once, not smoothed), for `confirmFrames` frames. | Same as `stars-dropping`. |
| `stars-declining` | warn | The median of the last `starsDecliningWindowMinutes` (30) is below `starsDecliningRatio` (0.62) of the median of the 30 before. A slow slide. | It is back above `starsDecliningClearRatio` (0.8). |

### The cause of a star alert

`stars-dropping`, `stars-collapsed` and `stars-declining` end their message with a cause when the
last three frames show it: `Star count dropping: median 20 (normal ≈49 stars), few peaks`. No cause
is named when the evidence is not clear, and the message is as it was. `cause.ts` holds the table,
checked in this order; the first that holds is named, and each compares the last three frames with
the frames no alert called bad (except `behind the trees`, which compares the mount's position with the
[horizon](../targets/README.md#backyard-horizon-approximate-warn-only)).

| Cause | Evidence | Threshold |
| --- | --- | --- |
| `behind the trees` | The mount's position at the latest frame is at or below the rig's horizon (traced or observed) | none |
| `sky brightened` | The brightest sky of the three frames against the normal sky | `causeSkyRatio` (1.5) |
| `stars trailed` | The axis ratio of the strong stars, from at least two frames, all of them elongated | `causeTrailedAxisRatio` (1.7) |
| `stars smeared or soft` | The share of peaks left out as blended rose above the normal share | `causeBlendedShareRise` (0.4) |
| `few peaks` | The peaks found before any gate, against the normal | `causePeaksRatio` (0.5) |

`behind the trees` goes first because a position behind the skyline explains everything else on the table. It
needs the frame's pointing (below) and a horizon profile; without either, or when the position is above the
skyline or in an unknown bin, it does not hold and the causes below apply unchanged. The horizon it reads is
loaded when the run starts, so an observation this run records does not rename the alert that caused it.

Smeared and soft stars look the same to these outputs (every peak blended, no strong star to take a
shape from), so the label says both. The noise output adds nothing: it moves with the sky level
(14.7x with the flash), and in the haze it rises 1.16x, which healthy frames reach too (1.15x).

A run can also never get a baseline to compare with: the cap left on, cloud from the first frame,
stars far out of focus, the wrong target. Every star alert is then silent (an empty frame needs a
baseline of 3 stars, a ratio needs 10), so a whole night is lost without a word.

| Alert | Level | Raised when | Clears when |
| --- | --- | --- | --- |
| `no-stars` | critical | A run that repeats and saves its frames has `noStarsFrames` (5, the `baselineFrames` window) frames with star measurements and still no baseline of `minBaselineStarsForEmptyFrame` (3) stars. Says "No stars after 5 frames". | A baseline forms: a cloudy start clears about three frames after the sky does, as the baseline fills with sky. Once one has formed it does not return. A loss of stars after that is `stars-collapsed`'s. It also clears when the run ends or the history starts over (a focuser move, autofocus ending), which counts the frames again. |

Only an imaging run is watched: the capture route calls `runStarted(exposureSeconds, { imaging, calibration, unattended })` with
`imaging` true for a run that repeats and saves its frames. A single exposure, a repeating run that
saves nothing (framing, focusing) and a run with `frameCount` below `noStarsFrames` never raise it.
A frame whose star measurement failed does not count as a frame without stars.

### Calibration runs

Rules apply by run kind. A calibration run (frame type dark, flat, dark flat or bias) has no stars,
needs no tracking and is not pointed anywhere, so only the rig can go wrong: it can raise
`rig-unreachable`, `frames-stalled`, `run-failed` and `run-interrupted`, and nothing else. An
Unattended overnight dark series therefore pages only for a rig problem. The capture route calls
`runStarted(exposureSeconds, { imaging, calibration, unattended })` with `imaging` false and
`calibration` true, and the monitor knows that from the first reading; the meridian watch is not
evaluated for it, so it does not report itself unavailable either. A light run raises `tracking-stopped`
after two consecutive readings of a mount that is not tracking, not slewing and not parked.

The baseline is the median of the last five frames that no alert called bad, so a long cloud never
becomes normal. A weaker alert is hidden while a stronger one covers it (`stars-dropping` and
`stars-declining` by `stars-collapsed`). A drop or collapse also starts the declining trend over, so
the frames of a cloud-out or haze are not read again as a slope once it has passed.

Star counts rise as focus worsens (167 to 278 stars while HFR went 1.55 to 2.12), so a refocus
makes them fall. The history starts over, as it does when autofocus ends, whenever the focuser
position changes between two mount polls.

### Observed obstructions

When `stars-collapsed` is raised (the empty-frame case included) in an imaging run, the monitor records the
mount's position at the frame where the collapse began as an observation in the rig's
[horizon observations](../targets/README.md#learned-from-star-dropouts-observed-obstructions), so a tree the
survey missed, or a survey whose north is off, corrects itself. One record per `stars-collapsed` episode, with
the time, altitude and azimuth, the baseline `strong` count before the drop, the `strong` count of the
dropping frame and the run id.

- **Pointing of a frame.** Altitude and azimuth are computed from the mount's right ascension, declination,
  sidereal time and the latitude the mount reports (`pointing.ts`); geometric, no refraction. It needs a
  topocentric mount. A frame's pointing is the latest mount reading since the previous frame (or the run
  start), and only if there was at least one, the mount was not reporting itself slewing or unreadable in any
  of them, and every needed value was present. Otherwise the frame has no pointing, and a drop at a frame
  without pointing records nothing and names no tree. The poll is every 10 s and a tracking mount moves
  0.25° a minute, so the position is good to well under a bin.
- **Not recorded.** Calibration runs (no stars, not pointed), runs that do not save their frames (framing and
  focus runs lose stars to defocus, not to trees), frames without pointing, and any drop while the mount was
  slewing. Chris deletes an observation that was a cloud.
- **Limit.** A cloud looks like a tree to these numbers. Nothing here tells them apart; deleting a wrong
  record is the correction, and the next run reads the file again.
- Nothing is logged: the file is the only place the numbers go. A failed write leaves one warning without
  values and the alert unchanged.

## Episodes

A condition that starts to hold raises an alert; one that stops holding clears it. Each alert is
one episode: one message to the phone when it begins and one `cleared` message when it ends. Vela
sends nothing in between. An emergency (priority 2) repeats on the phone every 60 s for an hour
until it is acknowledged, because Pushover does that, not Vela.

- A cleared alert cannot be raised again for five minutes, so a flapping HFR does not buzz all night.
  A new run starts without that guard.
- Acknowledging stops the repeats by cancelling the emergency's receipt. The alert stays in the
  banner until it clears. If the phone cannot be told to stop, the alert is not marked acknowledged.
- Overlapping alerts are separate episodes. A weaker alert that a stronger one covers
  (`stars-dropping`/`stars-declining` by `stars-collapsed`, `hfr-high` by `hfr-bad`, `meridian-near` by
  `meridian-imminent`) is hidden from the banner and not sent to the phone while the stronger stands.
- An alert that failed to reach the phone is tried again, until it arrives, is acknowledged or
  clears. The first retry comes after a minute, and each pause doubles up to five minutes. Vela
  gives up once the next try would fall an hour (an emergency's `expire`) after the alert was raised,
  because Pushover would have stopped repeating by then. Each alert in the alerts view carries its
  `delivery`: `sent`, `sending`, `covered`, `not-configured`, `attended`, `stopped`, `retrying` (with `failures`, `nextAttemptAt` and
  `giveUpAt`) or `gave-up`. The retry has its own timer, so it carries on after the run has ended:
  a `run-failed` emergency refused during a phone outage still goes out when the phone is back, if
  that is within the hour. The alerts view says "phone alerts failing" with the reason meanwhile.
  A "cleared" message is only sent for an alert the phone was told about, and is sent once: it is a
  courtesy, and a failure shows in the view without being retried.
- If an alert clears but Pushover will not take the cancel, the emergency keeps repeating with
  nothing left in the banner. The monitor keeps retrying the cancel once a minute (until the hour
  is up) and the alerts view says phone alerts are failing until it succeeds.
- Alerts, receipts and retries live in the server's memory. After a restart nothing is retried
  and the monitor has no receipt to cancel, so an emergency Pushover already holds repeats until
  its hour is up. Chris can stop it in the Pushover app.
- When the run ends, everything clears. `run-failed` is raised for a run that failed (not for Stop)
  and clears when the next run starts.

## An interrupted run

A server restart that finds a capture run unfinished (see [capture restarts](../capture/README.md#restarts))
calls `runInterrupted(message, unattended)`, with `unattended` read from the run's record, and the rules raise
`run-interrupted` (critical, an emergency) with "Capture was interrupted: Vela restarted (12 of 30 frames
taken)". It is raised for a calibration run too, since a restart is a rig problem whatever the frame type.
It pages the phone if the run was Unattended and is shown in the banner either way. It clears when a run
starts, like `run-failed`. The episode is in memory, so every server start with an unfinished record raises it
again.

## Unattended

Alerts raise, clear and show in the banner on every run. The phone is paged only while the current run is
**Unattended**, a per-run choice of Chris's, and a new run starts with it off. There is no per-rig switch and
no sunlight rule: leaving the rig to itself is the one thing that says nobody is looking, and he says so.

- **Where it lives.** In the run record (`unattended`, see [capture restarts](../capture/README.md#restarts)),
  so it survives a Vela restart and an interrupted Unattended run pages. The capture routes own it: the start
  body takes `unattended` (default false), and `PUT /api/rigs/:rigId/capture/unattended` with `{ "on": boolean }`
  switches it on a running run at any time, with no other condition, and answers with the capture view
  (`unattended`). It is 409 when no run is active. The monitor holds a copy for the run it watches
  (`runStarted`, `setUnattended`, `runInterrupted`) and shows it as `unattended` in the alerts view. A resumed
  run keeps the Unattended choice of the run it resumes.
- **An alert raised while it is off** has delivery `attended` ("Not sent · Unattended is off"). Nothing is sent
  for it, no retry, no `cleared` message.
- **Switching it on pages what is standing, once** (the choice for open question 1 of the spec: going to bed
  with a live problem must still wake Chris). Every alert that was not told to the phone and is not
  acknowledged is sent as if raised then, with its retry hour counted from the switch. A weaker alert that a
  stronger one covers is still covered, not sent.
- **Switching it off** stops what is repeating the way acknowledging does: the emergency's receipt is cancelled,
  and if Pushover will not take the cancel the receipt joins the strays below and the view says phone alerts are
  failing until it succeeds. A retry that was waiting is dropped, and nothing more is sent for the run until it
  is switched on again.
- **One page per alert.** An alert that reached the phone never pages again: an emergency cancelled by switching
  off has delivery `stopped` and switching on does not release it; a quiet message still gets its `cleared`
  message if Unattended is on again by the time the alert clears. A condition that clears and raises again is a
  new alert and may page.
- **`run-failed` and a retry outlive the run.** Unattended stays as the run left it until the next run starts, so
  a failed Unattended run still pages, and a send the phone refused keeps being retried after the run ended.
- A test message still pages on request, whatever the run (`POST /api/rigs/:rigId/alerts/test`).
- With no Pushover keys there is nothing to page and the browser says phone alerts are not set up.
- A leftover `phone-alerts.json` from the removed per-rig switch is ignored; the server logs one warning at start.

## What feeds the monitor

The capture routes call `runStarted`, `frameCaptured` (from the controller's `onFrame`) and
`runEnded`. While a run is active the monitor reads the mount every 10 s. A read that fails marks
the rig as not answering, which becomes `rig-unreachable` after 30 s. Only Cria rigs have mount
readings here; for others the mount watches say they are unavailable.

On the same poll it reads the focuser position (`focuser.ts`, for a rig with exactly one focuser).
A changed position starts the frame history over. A failed or missing read is skipped: it says
nothing about the rig answering, and it never counts as a move. The poll is every 10 s, so a frame
exposed across a move lands in whichever history is current when it arrives.

`autofocusStarted` and `autofocusEnded` are for an autofocus inside a run: frames do not arrive
meanwhile, so `frames-stalled` waits, and the frame baseline starts over afterwards. Nothing calls
them yet, because autofocus and capture hold the same rig lease and cannot overlap today. A new
target would reset the frame history the same way.

## Keys

`alerts.json` sits next to `cria.json` (`VELA_ALERTS_CONFIG_PATH`): `pushover.token`,
`pushover.user` and optional `thresholds`. An older file may still set `thresholds.starsLowRatio`
for the removed single-frame `stars-low` alert: the server ignores it, logs one warning at start,
and runs. Delete it. Overrides written to quiet that alert (a `starsCollapsedRatio` of 0.05, say)
still apply and now make `stars-collapsed` less sensitive than its defaults, so delete them too. `scripts/set-pushover-keys.sh` writes it. The keys go
nowhere else: not into logs, traces, errors or API responses.
