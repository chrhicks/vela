# Polar alignment latency: implementation evidence

October 8, 2026. Baseline `cbe0ba6536f78213fd534a56e39cd3f595d6dc40` (main). Implementation
`26662684cf7bd4e4d2b3f48331d19ecb47c2d837` on `perf/polar-alignment-latency` (the replayed code).
`c6ad68d` later fixed a baseline preview's position label and kept a published correction's
image through Stop. It does not change the correction path the replay measures. Profiling context: [report](2026-10-08-alignment-latency-report.md)
and [brief](2026-10-08-opus-alignment-latency-brief.md).

No observing service, worktree, configuration, shared image or rig state was changed. No device
command, exposure, slew or network probe was issued. Evidence below is labelled as **measured**
(executed or passively observed), **replayed** (isolated harness with recorded delays) or
**modelled** (arithmetic from measured inputs).

## Decision: corrections before images

The [brief](2026-10-08-opus-alignment-latency-brief.md) said to publish a correction only with a
matching ready image. Partway through implementation, Chris chose the opposite: publish a fresh
correction as soon as its solve and geometry complete, and let the preview catch up
asynchronously. Readings now normally arrive about a second before their image. Until the image
arrives, the image area shows the previous frame with that frame's own overlay and timestamp,
labelled as earlier. This is a product decision that Chris's browser review should cover. The
replay below shows why: a correction no longer waits for display preparation, which is what
removed most of the delay after pixels arrive.

The steady-adjustment settling change is part of the same review. The 3 s window after each
reading now also counts as the settling allowance before the next exposure. Its post-settle mount
and camera checks remain. An exposure can therefore start about 3 s after the previous reading is
published, instead of about 6 s. If Chris is still turning a knob at that moment, the frame may
smear or fail to solve. Vibration effects on the physical rig are unverified.

## What changed

A correction now publishes as soon as its solve, geometry and one final mount check finish. It no
longer waits for preview generation or image delivery. Each exposure carries a frame ID, exposure
start and solve time; its display images (a fit-size image, native detail around the correction,
and the full native PNG only for 100%) are prepared beside the correction and follow it. The
browser shows the fresh correction immediately and keeps the newest loaded image with that image's
own overlay, labelled *Earlier solved frame* until the newer image loads. A newer correction
cancels an older image load; a late older display never replaces a newer preview.

Also: capture validation runs alongside the solve; the steady adjustment window doubles as the
settling allowance (post-settle mount and camera checks remain); rig-detail polling pauses on the
alignment page; compact per-frame timing spans and ALPACA image format/byte attributes are recorded.

Camera acquisition and decoding are unchanged and still precede every solve.

## Replayed before/after

Same schedule, inputs and limits for both refs: 3 baseline frames, then tonight's first 40
recorded adjustment attempts in order (33 solved, 7 failed). Each frame replays its recorded
StartExposure → decoded-pixels delay, capture pre-start time and mount-validation and pre-exposure
read durations. Solving is real ASTAP on four saved real FRA400/ASI2600MC RGGB exposures; failed
attempts use a star-free version so ASTAP genuinely exhausts its search. Geometry comes from the
independent physical-coordinate fixture. Real 3 s waits. A client polls state every 750 ms after
each response, like the browser. Node 26.7.0, `nice 19`, four logical CPUs, one process at a time.

| Solved adjustment rounds (n = 33) | Before `cbe0ba6` p50 / P95 / max | After `2666268` p50 / P95 / max |
|---|---:|---:|
| StartExposure → decoded pixels (replayed input) | 9.18 / 12.93 / 16.40 s | 9.18 / 12.93 / 16.40 s |
| StartExposure → server correction | 14.36 / 18.10 / 21.30 s | **10.29 / 13.84 / 17.36 s** |
| StartExposure → browser correction | 14.51 / 18.44 / 21.38 s ¹ | **10.43 / 14.24 / 17.46 s** |
| StartExposure → browser image, loopback | 14.51 / 18.44 / 21.38 s | 11.45 / 15.20 / 18.71 s |
| StartExposure → browser image, Wi-Fi model ² | 19.02 / 22.87 / 25.89 s | 11.73 / 15.48 / 19.00 s |
| Rounds with browser correction ≤ 10 s | 0 of 33 | 12 of 33 |
| Interval between valid corrections (n = 32) | 22.78 / 28.96 / 50.81 s | 14.81 / 21.12 / 36.63 s |
| Image bytes per correction | 64.2 MB native PNG | 4.0 MB fit + detail |
| Mount snapshots / camera geometry reads (whole run) | 206 / 43 | 125 / 43 |
| Solve (FITS + ASTAP), replay CPUs | 0.60 s | 0.60 s |

¹ Before, the browser held each correction until its native image loaded; on a remote browser the
correction arrived with the Wi-Fi image row. ² Modelled: bytes ÷ tonight's measured alignment image
response throughput (64.6 MB in 4.495 s); not measured on a phone.

Both runs ended `stopped` without error. Idle Stop took about 1 ms in both; peak RSS 1.32 → 1.23 GiB
(harness retains four 6248 × 4176 frames); event-loop delay p99 14.3 → 14.4 ms.

An intermediate implementation (`07e069e`) started display preparation as soon as pixels arrived.
Its stretch shared the event loop with the solver's FITS preparation and tripled solve time
(0.60 → 1.87 s), leaving a 11.57 s median server correction. `2666268` starts display preparation
when the solve returns. Both results are retained.

**The ≤ 10 s target is not met.** The median browser correction is 10.43 s and P95 14.24 s. In this
replay, 11 of 33 frames already exceeded 10 s before Vela had pixels. After pixels arrive, the
correction path is now about 1.1 s at the median (capture check alongside the solve, then one final
mount check). A remaining ~0.4 s comes from the 750 ms browser poll. Further progress depends on
acquisition: readiness, ASTROPC's 1.5 s before the first byte and the 52 MB body. Removing rig-detail
polling may shorten real transfers, but this replay cannot show it: its acquisition delays were
recorded with that polling active. The real gain needs a physical measurement.

Not measured here: real browser paint, a phone over Wi-Fi, physical device timing with the new code,
and outdoor accuracy. Geometry tests check fixture agreement, not the sky.

## Passive observing measurements (measured)

Window 01:25:50–01:37:50 UTC (sampler continues to 03:26 UTC), Bubble Nebula imaging with 200 s
exposures, not 2 s alignment. Sources: 1 s kernel socket and interface counters (`ss`,
`/proc/net/dev`), local Tailscale state, existing Vela traces and server log. No payloads,
credentials or probes.

| 200 s frame | Request | First byte | Body | Bytes | Body rate | Other Wi-Fi RX |
|---|---:|---:|---:|---:|---:|---:|
| 01:27:57 | 8.36 s | 1.48 s | 6.88 s | 52,191,203 | 7.6 MB/s | 4.1 MB |
| 01:31:29 | 5.54 s | 1.51 s | 4.04 s | 52,185,813 | 12.9 MB/s | 2.4 MB |
| 01:34:58 | 5.62 s | 1.44 s | 4.18 s | 52,184,367 | 12.5 MB/s | 2.4 MB |

- Vela reaches the camera at `192.168.4.104:11111` on the LAN, not ASTROPC's Tailscale address.
  52.18 MB per frame equals 6248 × 4176 × 2 bytes plus a small header: the live link already
  transfers 16-bit binary ImageBytes, not JSON.
- Polaris uses Wi-Fi only (Ethernet down): 6 GHz, 160 MHz, about 1.15 Gbit/s receive PHY rate,
  −56 dBm. Camera bodies arrive at 61–103 Mbit/s, so Polaris's radio rate is not the limit.
  Competing Wi-Fi traffic during transfers was 2–4 MB.
- Camera-socket minimum RTT is about 4 ms (median of 2,404 samples). The roughly 1.5 s before the
  first byte is therefore preparation on the ASTROPC side (driver readout, ASCOM Remote Server
  serialization, or that machine's I/O), not round-trip latency. Which of those is not
  separable from Polaris.
- The body rate ceiling (about 100 Mbit/s) is consistent with, but does not prove, a 100 Mbit/s
  link or a throughput limit on ASTROPC or its access point. Network alone is not proven.
- Exposure end → image request: 0.55–1.18 s (readiness polling at 200 ms; 442–692 polls per
  200 s exposure). Exposure start → decoded pixels: 206.4–209.5 s, i.e. 6.4–9.5 s per image on
  top of the exposure. The same per-image cost appears in tonight's 2 s alignment frames
  (8.70 s median exposure → pixels), so it does not depend on exposure length.
- Polaris → browser: tonight's browser connections come from Polaris itself (its LAN and
  Tailscale addresses); fit image responses took 2 ms. The server log sees only the Vite proxy,
  so it cannot show whether this evening's alignment images went to a phone or the desktop.

Implication for the alignment target: with acquisition unchanged, roughly 8 s from StartExposure
to pixels is the practical floor for a 2 s frame (2 s exposure + about 0.6 s readiness + 1.5 s
first byte + about 4 s body), before any Vela processing.

## Saved 60 s and 200 s frames (measured on read-only copies)

Originals: Bubble Nebula, `ZWO ASI2600MC Pro`, 6248 × 4176 RGGB, `BITPIX=16 BZERO=32768`,
server-estimated `DATE-OBS`. Identity and hashes retained with each copy.

| | 60 s (`3979e021…`) | 200 s (`5c3ee1ed…`) |
|---|---|---|
| Exposure start → received | 66.9 s | 207.4 s |
| Background (clipped mean, RGGB) | 3.5–4.4 ADU | 8.6–13.2 ADU |
| Background σ | 3.4–3.8 ADU | 4.9–5.8 ADU |
| Pixels at or below 0 ADU | 20–27% | 1–5% |
| Row-mean scatter vs. noise expectation | 4.2–4.5× | 3.4–4.0× |
| Column-mean scatter vs. noise | 1.5–1.6× | 1.4–1.5× |
| Vela `detectedStars` / median HFR | 3 / 4.84 px | 36 / 5.19 px |
| Local maxima above 12σ (green superpixels) | 1,270 | 6,538 |
| 60 brightest: median HFR / axis ratio | 2.51 superpixels / 0.95 | 2.63 superpixels / 0.87 |
| Orientation spread | 56° (no preferred direction) | 8° around 46° |

- **Banding is in the originals.** Row-to-row offsets exceed noise by 3.4–4.5× in every Bayer
  channel, with no correlation between adjacent rows (about ±1 ADU). The native preview and fit
  image show the same structure amplified by the display stretch (row excess 5.5–6.7× and
  4.6–5.8×). The native preview's 0.5 adjacent-row correlation comes from bilinear debayering;
  the fit image lacks it. The preview does not create the banding.
- **The black level is at the floor.** A fifth to a quarter of the 60 s background is clipped at
  0 ADU. This loses faint signal and noise statistics, and it may affect star measurement and the
  apparent banding. It points to the camera offset setting; that is Chris's decision, and nothing
  was changed.
- **Stars are present.** Vela's conservative capture statistic accepted 3 and 36 stars, while
  more than a thousand clear peaks exist and the brightest are round at 60 s. The low count is a
  measurement-policy outcome, not an empty frame. Its specific rejection cause (for example
  background estimates on clipped data, the outer-flux or elongation tests) is not established.
  The saved metadata reports 3, not 0; a 0 seen live came from a frame not retained here.
- **200 s stars are mildly elongated in a consistent direction** (axis ratio 0.87, 46° ± 8°),
  consistent with tracking drift over the longer exposure. Cause not established.

## Evidence locations (ignored local files in the isolated worktree)

- Passive network: `.local/evidence-observing-20261008/network-samples.jsonl`,
  `network-correlation.json`, copied `traces/` and `logs/` with SHA-256 sums; sampler and
  correlator in `.local/passive-tools/`.
- Frames: `.local/evidence-observing-20261008/frames/{60s,200s}/` with `SOURCE` and
  `SOURCE.sha256`; analysis `frame-analysis.json` (clipped means) and
  `frame-analysis-median-v1.json` (superseded median metric, quantized at these levels).
- Before-lock alignment capture: `.local/evidence-before-lock-20261008/`.
- Replay: `.local/latency/harness/replay.mts`, `run-replays.sh`, `summarize-replay.py`; results
  in `.local/latency/results/replay/`.
