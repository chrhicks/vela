# star-bench

Replays Vela's saved frames through Vela's own star measurement and compares the result with what Vela recorded. It is the check every change to `apps/server/src/imaging/statistics.ts` runs against recorded data before it ships. It reads saved images and writes nothing there. It never touches a rig, Cria or the running Vela.

The design and the reason for each output are in the 2026-10-25 star-measurement review (`bots/observer/specs/star-measurement/review.md` in the home repo, sections 5 and 9).

## Run it on thuban

```sh
pnpm --silent --filter @vela/star-bench star-bench ~/.local/share/vela/saved-images \
  --table ~/scratch/star-bench/frames.tsv
```

Add `--frames LIST` to measure only the frames in a list file (one path per line; a frame directory or its `original.fits`; text after a tab is ignored). The 717 frames the review used are listed in `bots/observer/specs/star-measurement/harness/todo.txt`. A listed frame that is not in the saved images is an error, so a pinned set cannot shrink unnoticed.

| Option | Meaning |
|---|---|
| `--frames LIST` | Measure only the listed frames. |
| `--table FILE` | Write the per-frame table (tab separated) to `FILE`. |
| `--jobs N` | Worker threads. Default 8, or fewer cores. Each holds one 26 MP frame, about 300 MB. |
| `--gap-minutes N` | A gap between light frames longer than this starts a new run. Default 30. |
| `--restart-at TIME` | Start a new run at this UTC time, as the monitor does when autofocus ends. Repeatable. |
| `--labels DIR` | Check the alert replay against the per-night label files in `DIR` (`labels/` in this tool). |
| `--count INPUT` | The star count the alert replay reads, `measured` or `strong`. Default is what the monitor reads (`alertCountInput`). |
| `--sweep` | With `--labels`, find how far each star threshold can move before a labelled night fails. A few seconds. |

The report goes to stdout and is repeatable: two runs of the same code on the same frames print the same text, so `diff` shows what a change did. Progress and timing go to stderr. Exit code 0 means every frame was measured and equals its record, 1 means not, 2 means bad arguments.

Measuring costs about 1.4 s per 26 MP frame on one thread, so 700 frames take a few minutes on 12 threads. The run reads about 50 MB per frame, so the first run is slower while the disk cache is cold.

## What the report says

```
717 of 717 frames match the recorded statistics.
  differ 0, unrecorded 0, not measured 0
```

Each frame's `metadata.json` holds the `detectedStars` and `medianHfrPixels` Vela recorded when it took the frame. The bench measures `original.fits` again with `measureStars` (imported from the server package, not copied) and compares: the count exactly, the HFR within 1e-9 px. A frame is one of:

- **match**: the same count and HFR.
- **differ**: the code now gives other numbers than the night did. The line names the frame and both values, and `largest HFR difference` gives the worst gap in pixels. This is what a deliberate change to the measurement produces, and the frames are the evidence of what moved.
- **unrecorded**: the metadata holds no statistics. Never counted as a match.
- **not measured**: the FITS could not be read or measured. Never counted as a match.

Directories without usable `metadata.json` are listed as skipped and are not frames.

Then, for each run of light frames (one target and exposure, a new run after a gap):

```
Soul Nebula, 90 s: 262 frames, 2026-10-25T02:22:04Z to 2026-10-25T09:32:22Z
  stars median 264, spread 0.114, 43 of 261 pairs jump over 1.5x
  alert stars-dropping 2026-10-25T02:30:14Z to 2026-10-25T02:36:46Z
```

- **spread** is the robust spread of `log(count / previous count)` over neighbouring frames (1.4826 times the median absolute deviation). A steady count has a low spread. A count that swings between healthy frames has a high one, which makes a threshold on it unreliable.
- **jump** is a pair of neighbouring frames whose counts differ by more than 1.5 times. A count of zero reads as one.
- **per frame, median** and **rejected by first failed gate** are the named outputs of each frame, as a median over the run: peaks found, measured (equal to `detectedStars`), strong (measured with a flux S/N of 100 or more), the sky level and noise, and how many peaks each gate turned away. A peak is counted under the first gate it fails, so a star that fails two shows only the earlier. Merged blends in the autofocus policy are not in a capture run.
- **axis ratio of strong stars** is the frame's recorded `axisRatio` (the median axis ratio of its stars at S/N 200 or more), as the number of frames in the run that have one, their median, and how many of them read over 1.3. A frame with fewer than 10 such stars has none. Recorded only; it feeds no alert.
- **strong stars median** is the same line for the strong count, which the star alerts read.
- **alert** is an episode of a frame-derived alert (`no-stars`, `stars-dropping`, `stars-collapsed`, `stars-declining`, `hfr-high`, `hfr-bad`) from replaying the run's frames, in order, through the real `evaluateAlerts` with the default thresholds. The episode starts at the capture time of the frame that raised the alert and ends at the capture time of the frame that cleared it, or at `end of run`. Compare episodes before and after a change; they should agree within one frame (about one exposure). The replay reads the count named by `--count`, through the same `alertFrame` the monitor uses, so a frame of another algorithm version or without its named outputs is left out as it is live.

The replay differs from the live monitor in two ways. It has no focuser log, so a run is not restarted at an autofocus unless you name the time with `--restart-at` (the review's Heart night needs `--restart-at 2026-10-24T00:00:00Z`, the autofocus at 23:54Z to 00:01Z). And it uses capture times, not the times the server received the frames. `Frames outside any run` counts darks, flats and bias frames, and light frames that could not be measured. Frames saved before Vela recorded a frame type read as lights, so old dark frames show up as runs of `(no target)` that raise `no-stars`.

## Labelled nights

`--labels DIR` reads one JSON file per night from `DIR` and checks the replayed alerts against it. The files in `labels/` say what a person knows about the night, not what the counter says, and each window carries the evidence in its `note`. A window is one of:

- `healthy`: nothing may start in it.
- `event`: every alert in `expect` must start in it. The report gives the delay from the window's start, when the alert cleared and what it said, cause included.
- `transition`: only the alerts in `allow` may start in it.

An alert that starts in no window fails the night, so the files must cover it. A label with no matching run (same target and exposure, overlapping the windows) fails. A file that does not parse stops the run before anything is measured. `use` is `calibration` for the nights the thresholds are picked on and `holdout` for the nights that only check them. To label a new night, add a file; do not widen a window to make a night pass.

```
Labelled nights (alert count: strong)
2026-10-24 Heart Nebula, 90 s, calibration: pass
  healthy 2026-10-24T00:01:00Z to 2026-10-24T00:44:00Z: quiet
  event haze 2026-10-24T01:26:00Z to 2026-10-24T01:40:30Z
    stars-dropping raised 2026-10-24T01:33:27Z (+7.5 min), cleared 2026-10-24T01:38:21Z: Star count dropping: ..., few peaks
Calibration: 3 of 3 nights pass, 5 of 5 expected alerts raised, 0 unexpected
```

With `--sweep` the report ends with the range each star threshold can move through before the alert it governs fails a night: `calibration`, `held out` and `both`, with the distance from the default to each end. This is what `thresholds.ts` quotes. Only that alert is judged for its threshold, so another alert's miss on a night does not hide the range.

## The per-frame table

`--table` writes one row per frame, oldest first: `frame` (the image id), `captured_at`, `frame_type`, `target`, `exposure_seconds`, `detected_stars`, `median_hfr_pixels`, the two recorded values, and `comparison`. Then the named outputs: `detections` (peaks found before any gate), `measured`, `strong`, one `rejected_<gate>` column for each of the eight gates in the order they run, `sky_level` and `sky_noise`, and last `axis_ratio` (empty when the frame has fewer than 10 stars at S/N 200 or more). For a capture frame `detections` equals `measured` plus the `rejected_*` columns. The table has no timings, so two tables of the same code are identical. The first ten columns do not change when the named outputs are added, so `cut -f1-10` of two tables can be diffed, and `cut -f1-23` of two tables from before and after the axis ratio was added.

## Tests

`pnpm check` runs this tool's tests and typecheck. They use `fixture/saved-images`, four made-up frames (three lights and a dark, 192 x 144, Bayer) in the layout of Vela's store, recorded with the measurement as it stands. They need no real data. The real-data run above is a command you run, not part of `pnpm check`.

If the measurement changes on purpose, the fixture frames will differ from their records and the bench tests fail. Regenerate them with `pnpm --filter @vela/star-bench make-fixture` and commit the diff; it shows how far the numbers moved. The generator is seeded, so it gives the same frames on every machine.

## Import path

The tool imports `measureStars`, `readRetainedFits`, `evaluateAlerts`, the default thresholds and `encodeCaptureFits` through the `exports` of `@vela/server`, which point at the source. The bench therefore always measures the code in the checkout and never a stale `dist`.
