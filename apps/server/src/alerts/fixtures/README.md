# Alert rule fixtures

Recorded on the night of 2026-10-17 local (2026-10-18 UTC), Andromeda Galaxy, 60 s exposures.

- `night-20261018-frames.json` — every frame Vela kept from 02:27:54Z to 05:11:23Z (132 frames).
  The camera snagged a tripod leg after the 03:30:02Z frame; frames from 03:31:10Z have 0-2 stars.
  Chris recovered by 04:12:09Z. The 02:11 and 02:22 frames (focusing, before the run proper) are left out.
- `night-20261018-mount.csv` — the AM5 polled every 10 s from 03:42:22Z to 04:12:24Z, trimmed to these rows, with `ra_h` and `lst_h` shifted by one
  constant (hour angle unchanged) so the UTC/LST pairing implies the fake site (40°N, 75°W) used by the rig simulator. Tracking stopped at 04:03:33Z, at hour angle +0.0669 h,
  and came back after the slew to the other pier side at 04:10:33Z.

Recorded on the night of 2026-10-23 local (2026-10-23T23:22Z to 2026-10-24T05:58Z UTC), 90 s frames through a 3 nm dual-band filter.

- `night-20261023-frames.json` — `{target: [[capturedAt, detectedStars, medianHfrPixels], ...]}`, 100 frames of the Heart Nebula and 137 of the North America Nebula.
  Healthy consecutive frames swing about 2x with HFR flat. Heart 23:22Z-23:54Z is a focus drift: HFR 1.55 to 2.12 while stars rise 167 to 278
  (a refocus then dropped them, so the 00:01Z frame starts a new run). Heart 00:01Z-01:25Z is a noisy healthy run (52-187 stars). Heart 01:26Z-01:38Z is haze:
  counts of 14-46 with HFR unchanged. North America is a healthy run (127-325 stars).

These counts and HFRs were recorded by star measurement version 1 (Bayer HFR floor 1.4 px). Frames measured today read higher counts and lower HFRs on sharp frames, so do not mix the two without checking `statistics.algorithm.version`.
