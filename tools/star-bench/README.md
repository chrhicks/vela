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
Soul Nebula, 90 s: 262 frames, 2026-10-25T02:03:10Z to 2026-10-25T06:36:44Z
  stars median 264, spread 0.114, 43 of 261 pairs jump over 1.5x
  alert stars-dropping 2026-10-25T02:30:14Z to 2026-10-25T02:36:46Z
```

- **spread** is the robust spread of `log(count / previous count)` over neighbouring frames (1.4826 times the median absolute deviation). A steady count has a low spread. A count that swings between healthy frames has a high one, which makes a threshold on it unreliable.
- **jump** is a pair of neighbouring frames whose counts differ by more than 1.5 times. A count of zero reads as one.
- **alert** is an episode of a frame-derived alert (`no-stars`, `stars-dropping`, `stars-collapsed`, `stars-declining`, `hfr-high`, `hfr-bad`) from replaying the run's frames, in order, through the real `evaluateAlerts` with the default thresholds. The episode starts at the capture time of the frame that raised the alert and ends at the capture time of the frame that cleared it, or at `end of run`. Compare episodes before and after a change; they should agree within one frame (about one exposure).

The replay differs from the live monitor in two ways. It has no focuser log, so a run is not restarted at an autofocus unless you name the time with `--restart-at` (the review's Heart night needs `--restart-at 2026-10-24T00:00:00Z`, the autofocus at 23:54Z to 00:01Z). And it uses capture times, not the times the server received the frames. `Frames outside any run` counts darks, flats and bias frames, and light frames that could not be measured.

## The per-frame table

`--table` writes one row per frame, oldest first: `frame` (the image id), `captured_at`, `frame_type`, `target`, `exposure_seconds`, `detected_stars`, `median_hfr_pixels`, the two recorded values, and `comparison`. It has no timings, so two tables of the same code are identical. `measureStars` returns only the count and median HFR, so peaks found before the gates are not in the table yet. The planned split of the function (PR 2 of the plan) adds them.

## Tests

`pnpm check` runs this tool's tests and typecheck. They use `fixture/saved-images`, four made-up frames (three lights and a dark, 192 x 144, Bayer) in the layout of Vela's store, recorded with the measurement as it stands. They need no real data. The real-data run above is a command you run, not part of `pnpm check`.

If the measurement changes on purpose, the fixture frames will differ from their records and the bench tests fail. Regenerate them with `pnpm --filter @vela/star-bench make-fixture` and commit the diff; it shows how far the numbers moved. The generator is seeded, so it gives the same frames on every machine.

## Import path

The tool imports `measureStars`, `readRetainedFits`, `evaluateAlerts`, the default thresholds and `encodeCaptureFits` through the `exports` of `@vela/server`, which point at the source. The bench therefore always measures the code in the checkout and never a stale `dist`.
