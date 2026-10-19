# Alerts

Tells Chris when a capture run goes wrong, on screen and on his phone. It never stops capture
or moves the mount.

- `rules.ts` is pure: a rig's history in, the conditions that hold now out. All the numbers live in
  `thresholds.ts`.
- `monitor.ts` keeps that history for one rig, feeds the rules, and turns conditions into episodes.
- `pushover.ts` is the phone, behind the `Notifier` interface in `notifier.ts`. `config.ts` reads
  `alerts.json`. `mount.ts` reads a Cria rig's mount. `routes.ts` is the HTTP surface.

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
  (`stars-low`/`stars-declining` by `stars-collapsed`, `hfr-high` by `hfr-bad`, `meridian-near` by
  `meridian-imminent`) is hidden from the banner and not sent to the phone while the stronger stands.
- An alert that failed to reach the phone is tried again, until it arrives, is acknowledged or
  clears. The first retry comes after a minute, and each pause doubles up to five minutes. Vela
  gives up once the next try would fall an hour (an emergency's `expire`) after the alert was raised,
  because Pushover would have stopped repeating by then. Each alert in the alerts view carries its
  `delivery`: `sent`, `sending`, `not-configured`, `retrying` (with `failures`, `nextAttemptAt` and
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

## What feeds the monitor

The capture routes call `runStarted`, `frameCaptured` (from the controller's `onFrame`) and
`runEnded`. While a run is active the monitor reads the mount every 10 s. A read that fails marks
the rig as not answering, which becomes `rig-unreachable` after 30 s. Only Cria rigs have mount
readings here; for others the mount watches say they are unavailable.

`autofocusStarted` and `autofocusEnded` are for an autofocus inside a run: frames do not arrive
meanwhile, so `frames-stalled` waits, and the frame baseline starts over afterwards. Nothing calls
them yet, because autofocus and capture hold the same rig lease and cannot overlap today. A new
target would reset the frame history the same way.

## Keys

`alerts.json` sits next to `cria.json` (`VELA_ALERTS_CONFIG_PATH`): `pushover.token`,
`pushover.user` and optional `thresholds`. `scripts/set-pushover-keys.sh` writes it. The keys go
nowhere else: not into logs, traces, errors or API responses.
