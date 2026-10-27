# Alerts

Tells Chris when a capture run goes wrong, on screen and on his phone. It never stops capture
or moves the mount.

- `rules.ts` is pure: a rig's history in, the conditions that hold now out. All the numbers live in
  `thresholds.ts`.
- `monitor.ts` keeps that history for one rig, feeds the rules, and turns conditions into episodes.
- `pushover.ts` is the phone, behind the `Notifier` interface in `notifier.ts`. `config.ts` reads
  `alerts.json`. `preference.ts` keeps the phone alerts switch. `mount.ts` reads a Cria rig's mount. `site.ts` reads where a rig is. `routes.ts` is the HTTP surface. The browser side (banner and rig-page card) is
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
the frames no alert called bad.

| Cause | Evidence | Threshold |
| --- | --- | --- |
| `sky brightened` | The brightest sky of the three frames against the normal sky | `causeSkyRatio` (1.5) |
| `stars trailed` | The axis ratio of the strong stars, from at least two frames, all of them elongated | `causeTrailedAxisRatio` (1.7) |
| `stars smeared or soft` | The share of peaks left out as blended rose above the normal share | `causeBlendedShareRise` (0.4) |
| `few peaks` | The peaks found before any gate, against the normal | `causePeaksRatio` (0.5) |

Smeared and soft stars look the same to these outputs (every peak blended, no strong star to take a
shape from), so the label says both. The noise output adds nothing: it moves with the sky level
(14.7x with the flash), and in the haze it rises 1.16x, which healthy frames reach too (1.15x).

A run can also never get a baseline to compare with: the cap left on, cloud from the first frame,
stars far out of focus, the wrong target. Every star alert is then silent (an empty frame needs a
baseline of 3 stars, a ratio needs 10), so a whole night is lost without a word.

| Alert | Level | Raised when | Clears when |
| --- | --- | --- | --- |
| `no-stars` | critical | A run that repeats and saves its frames has `noStarsFrames` (5, the `baselineFrames` window) frames with star measurements and still no baseline of `minBaselineStarsForEmptyFrame` (3) stars. Says "No stars after 5 frames". | A baseline forms: a cloudy start clears about three frames after the sky does, as the baseline fills with sky. Once one has formed it does not return. A loss of stars after that is `stars-collapsed`'s. It also clears when the run ends or the history starts over (a focuser move, autofocus ending), which counts the frames again. |

Only an imaging run is watched: the capture route calls `runStarted(exposureSeconds, imaging)` with
`imaging` true for a run that repeats and saves its frames. A single exposure, a repeating run that
saves nothing (framing, focusing) and a run with `frameCount` below `noStarsFrames` never raise it.
A frame whose star measurement failed does not count as a frame without stars.

### Calibration runs

A calibration run (frame type dark, flat, dark flat or bias) has no stars and needs no tracking. The
capture route calls `runStarted(exposureSeconds, imaging, calibration)` with `imaging` false and
`calibration` true, and the monitor knows that from the first reading. Such a run can raise
`rig-unreachable`, `frames-stalled`, `run-failed` and the meridian alerts, which read the mount's pointing
whatever the frame type. It cannot raise a star alert, `no-stars` or `tracking-stopped`: `tracking-stopped`
is not evaluated at all, so a mount left standing still on purpose (indoors, homed, tracking off) neither
shows an alert nor pages the phone. A restart that interrupts a calibration run raises nothing. A light run is
unchanged: it raises `tracking-stopped` after two consecutive readings of a mount that is not tracking, not
slewing and not parked.

The baseline is the median of the last five frames that no alert called bad, so a long cloud never
becomes normal. A weaker alert is hidden while a stronger one covers it (`stars-dropping` and
`stars-declining` by `stars-collapsed`). A drop or collapse also starts the declining trend over, so
the frames of a cloud-out or haze are not read again as a slope once it has passed.

Star counts rise as focus worsens (167 to 278 stars while HFR went 1.55 to 2.12), so a refocus
makes them fall. The history starts over, as it does when autofocus ends, whenever the focuser
position changes between two mount polls.

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
  `delivery`: `sent`, `sending`, `not-configured`, `outside-dark`, `stopped-at-dawn`, `retrying` (with `failures`, `nextAttemptAt` and
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
calls `runInterrupted(message)` for a light run, and the rules raise `run-interrupted` (critical,
an emergency) with "Capture was interrupted: Vela restarted (12 of 30 frames taken)". A
calibration run raises nothing. It clears when a run starts, like `run-failed`, and obeys the
switch, astro dark and one page per alert like every alert.

A server that has only just started often cannot reach the mount yet, and an unknown site pages at any hour. So
the alert first asks for the site, up to four tries 30 s apart, and only then evaluates: a daytime
deploy does not buzz the phone. If the mount never answers the alert fails open, as any alert does
for an unknown site. A run started during the wait supersedes it. The episode is in memory, so every
server start with an unfinished record raises it again.

## The phone alerts switch

Each rig has a switch, on unless Chris turns it off from the app. Off means Vela sends that rig
nothing to Pushover: no new alert, no retry, no `cleared` message and no test. Alerts still raise,
clear and show in the banner, with delivery `muted`. Turning it off while an emergency repeats
cancels its receipt the same way acknowledging does; if Pushover will not take the cancel, the
receipt joins the strays above and the view says phone alerts are failing until it succeeds.

Turning it back on does not replay anything. An alert raised or silenced while off stays `muted`
until it clears, and only alerts raised afterwards page. An alert the phone was told about as a
quiet message before the switch went off still gets its `cleared` message if the switch is on again
by then.

- `PUT /api/rigs/:rigId/alerts/phone` with `{ "on": boolean }` saves the choice, applies it to
  the monitor and answers with the alerts view (`phoneAlertsOn`). A save that fails answers 500
  and changes nothing.
- The choice is stored in `phone-alerts.json` next to the rig catalog (`rigs.yaml`), as
  `{ "phoneAlerts": { "<rigId>": false } }`, so it survives a restart. A rig with no entry is on.
  The server will not start on a file it cannot read, rather than page a phone Chris turned off.
  `alerts.json` is never touched.
- With no Pushover keys there is nothing to switch, and the browser hides the control.

## Astronomical darkness

The phone is paged only while the sun is below -18 degrees (`astronomicalDarkDegrees` in
`../astronomy/sun.ts`, fixed in code) at the rig's site, because that is the only time a rig is
left unattended. Outside it, alerts still raise, clear and show in the banner, with delivery
`outside-dark` ("Not sent · outside astro dark"). The switch comes first: off is `muted`, and
only a switch that is on goes on to ask about the sun. A test message is Chris asking for a page,
so it ignores the sun.

- **Site.** `site.ts` asks the rig's only telescope for the latitude and longitude its mount
  already reports, so Chris types no coordinates. A mount reporting nothing, a value off the globe,
  or exactly 0 N 0 E (what a mount with no location set says) counts as no site. The monitor reads
  it when the alerts view is asked for and the site is unknown (no more often than every 30 s),
  and again when a run starts. A site that is known is not read again between runs. If the mount
  answers at run start with no usable location, the old site is dropped (the rig may have moved)
  and the rig pages at any hour; a mount that does not answer leaves the old site.
- **Unknown site fails open.** A missed alert on an unattended rig costs more than an extra page, so
  an unknown site pages at any hour, as before. The view says `pagingWindow: site-unknown` and the
  switch reads "pages at any hour · rig location unknown". Learning the site later in daylight
  takes the same step as dawn, below.
- **Sun.** `sunAltitudeDegrees` and `darkOutlook` use Astronomy Engine, already a dependency, with
  no refraction, as twilight is defined. `darkOutlook` also finds the coming dusk and dawn, or null
  when the sun does not cross -18 within two days (a Greenwich midsummer, or a polar winter).
- **Held alerts.** An alert raised in daylight has delivery `held`. The view shows `outside-dark`.
  An alert that cleared before dark was never sent, so it never pages.
- **Dusk.** When dark begins, or the site becomes unknown, every alert still standing that was held
  and not acknowledged is told to the phone, once, as if raised then. An evaluation reconciles the
  conditions first, so an alert it clears is never released. Its retry hour starts at dusk. The monitor notices
  from its next evaluation (a frame or a mount poll) or from its own timer, which sleeps until the
  next crossing (never more than 6 h), so a failed run's alert still pages at dusk with no poll
  running.
- **Dawn.** When dark ends, an emergency repeating on the phone is cancelled through the same path
  as turning the switch off. That was its page, so its delivery becomes `stopped-at-dawn` ("Sent once
  · stopped at dawn") and it stays that way until it clears. One waiting to go out, or being retried,
  is held. A warn that was already sent stays sent. There is no `cleared` message in daylight, and a
  stopped emergency gets none when it clears later.
- **One page per alert.** An alert that reached the phone never pages again: not at the next dusk, not
  after the switch goes off and on. An alert that never did (raised in daylight, waiting, or still
  failing to send at dawn) pages once at the next dusk. A condition that clears and raises again is a
  new alert and may page. Learning in daylight that the site is not dark stops what was paged at any
  hour the same way.
- **Switch and sun.** Turning the switch off mutes held alerts too, so turning it on again before
  dusk does not page them. Turning it on pages nothing it had not already.

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
