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

Frames from a real night swing about 2x with nothing wrong (101, 88, 181, 126, 84 stars, HFR flat),
so no rule compares one frame. Every comparison uses the median of the last `starsSmoothingFrames`
(3) frames. The numbers and their reasons are in `thresholds.ts`; the 2026-10-23 night they come
from is `fixtures/night-20261023-frames.json`.

| Alert | Level | Raised when | Clears when |
| --- | --- | --- | --- |
| `stars-dropping` | warn | The smoothed count is below `1 - starsDropFraction` (0.5) of its highest value within the last `starsDropWindowMinutes` (10), for `confirmFrames` frames. A rate of change, in time, so it means the same at 30 s and 180 s exposures. | The smoothed count is back above `starsRecoveredRatio` (0.5) of the baseline for `confirmFrames` frames. |
| `stars-collapsed` | critical | The smoothed count is below `starsCollapsedRatio` (0.15) of the baseline, or the frame is empty (0 stars on a baseline of 3 or more, counted at once, not smoothed), for `confirmFrames` frames. | Same as `stars-dropping`. |
| `stars-declining` | warn | The median of the last `starsDecliningWindowMinutes` (30) is below `starsDecliningRatio` (0.6) of the median of the 30 before. A slow slide. | It is back above `starsDecliningClearRatio` (0.8). |

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
  `delivery`: `sent`, `sending`, `not-configured`, `outside-dark`, `retrying` (with `failures`, `nextAttemptAt` and
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
  as turning the switch off, and is held again; one waiting to go out, or being retried, is held.
  A warn that was already sent stays sent. There is no `cleared` message in daylight.
- **Nights after the first.** An alert still standing at the next dusk pages again, once, because
  its emergency was stopped by the sun, not by Chris. One he acknowledged does not.
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
