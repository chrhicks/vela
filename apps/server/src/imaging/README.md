# Capture image processing

## Lossless FITS interchange

`fits.ts` is the shared encoder for captured originals, plate-solver inputs and
retained alignment diagnostics.
It validates every sample as a signed 32-bit integer. If all samples are in
0–65535, it writes `BITPIX=16`, `BZERO=32768`, `BSCALE=1`, with big-endian signed
storage of `sample - 32768`. Otherwise it writes `BITPIX=32` signed big-endian
samples without scaling cards. Negative and greater-than-65535 values remain
exact; nonfinite, fractional and out-of-range values are rejected.

Selection depends on representability, not inferred sensor bit depth. Neither
path rescales ADU values, clamps, reverses rows, debayers or mutates acquisition
samples. Both validation and writing yield between batches, and header/data
padding remains FITS-compliant. Exposure time, UTC start and its provenance,
camera, `ROWORDER=TOP-DOWN` and origin-adjusted Bayer pattern are preserved.

### Settings in the header

A captured original also records what the frame was taken with, because stacking and
calibration software matches darks, flats and bias frames to lights by gain, offset,
temperature, binning, exposure and filter. Each key below is written only when its value
was read for that frame (`FILTER` is the exception: Chris chose it). A value that could not be read is left out. Nothing is defaulted
or carried over from an earlier frame.

| Key | Value | Source |
|---|---|---|
| `GAIN`, `OFFSET` | Camera gain and offset | Camera reading |
| `XBINNING`, `YBINNING` | Binning on each axis | Camera reading |
| `XPIXSZ`, `YPIXSZ` | Pixel size in micrometres, after binning | Camera reading, scaled by the binning |
| `CCD-TEMP` | Measured sensor temperature in °C | Camera reading |
| `SET-TEMP` | Cooler setpoint in °C | The last setpoint the camera driver acknowledged |
| `FOCALLEN` | Effective focal length in mm | The rig's configured value |
| `OBJECT` | The subject's name | The run's subject. Light frames only; a dark, flat, dark flat or bias has none |
| `FILTER` | The filter's name, as listed for the rig | Chris's choice when the run started. Light and flat frames only, and only when a filter was chosen: with None there is no key, never the word `None`. A dark, dark flat or bias has none |
| `PIERSIDE` | `EAST` or `WEST` | Mount reading. Tells a meridian flip, which turns the image 180 degrees |

Which keys are omitted, by rig:

| Rig | Omitted keys |
|---|---|
| Cria | `SET-TEMP` until a setpoint has been sent, `PIERSIDE` when the rig has not reported exactly one telescope or the mount reports no side, and any camera key whose reading is not fresh. If the camera cannot be read at all, every camera key and `PIERSIDE` |
| Alpaca | `GAIN`, `OFFSET`, `XBINNING`, `YBINNING`, `XPIXSZ`, `YPIXSZ`, `CCD-TEMP`, `SET-TEMP`, `PIERSIDE`. Its adapter does not read them |
| Either, no focal length configured | `FOCALLEN` |

`TELESCOP` is not written: the rig record has no scope name. A read that fails or takes
longer than two seconds costs the frame its settings keys and nothing else: the frame is
still saved. The frame record does not note which keys were left out; the server logs a
warning when a read fails.

`FILTER` is the one key that is Chris's word and not a reading. The rig has one manual
filter slot and nothing reports what is in it, so Chris names the filter when he starts a
run (see [the capture filter](../capture/README.md#filter)). A failed settings read never
costs the frame its `FILTER`. FITS has no standard keys for a passband, and Siril and
PixInsight group lights with their flats by the `FILTER` string, so the header carries the
name alone, and it must stay the same from night to night. The description is shown in the
app and never written.

The site and the mount's pointing are never written: no `SITELAT`, `SITELONG`, `LAT`,
`LONG`, `ELEVATION` or similar, and no right ascension or declination. Chris shares these
files. A test fails if a key outside the lists above is ever written.

`SET-TEMP` is the last setpoint Cria sent that the driver acknowledged, since INDI does not
report the target back. After a Cria restart it is absent until a new setpoint is sent.

Already-retained FITS originals are immutable and are not rewritten. Future
retained-preview readers must support both Vela encodings above and apply the
unsigned offset exactly once; preview treatment must not alter original samples.

## Display previews and measurements

Preview stretching and star measurements consume linear acquisition samples;
measurements never use the stretched PNG. Both finish before a completed image
and its metadata are published. Star-analysis failure leaves the acquired image
available with unavailable statistics, rather than failing the capture run.

`statistics.ts` reports the number of usable detected stars and their median
half-flux radius (HFR), in native image pixels. Each accepted star's HFR is the
radius enclosing half its background-subtracted light inside a circular aperture.
Fractional pixel coverage keeps the calculation from depending on pixel-center
steps. This is a circular curve-of-growth measurement, not the flux-weighted
mean radius approximation used by ASTAP's HFD output.

Detection uses a fixed noise-relative threshold and local median/MAD background.
Close candidates, incomplete edges, obvious clipping, strongly elongated or
undersampled profiles, and stars whose outer aperture has not converged are
excluded. A capture star with a flux signal-to-noise below 200 is not judged on
elongation, because the second moments of a faint star are mostly noise: on a sharp
Soul frame half the stars at S/N 30 to 60 failed the gate while the bright stars on
the same frame read round. Those stars count, with unknown shape. An autofocus
measurement still judges every star. The count is this measured population, not a catalog of every star in
the field. A valid image with none reports zero stars and no HFR. An unavailable
analysis is a separate result. Dim or very defocused stars may not be measurable.

The measurement runs in four steps. `findPeaks` lists the candidate peaks.
`measureStar` returns every quantity around a peak without judging it.
`classify` names the first gate that peak fails, or accepts it with its HFR.
`summarize` turns the verdicts into the recorded statistics.

Besides the count and median HFR, the statistics name what the measurement found.
`detections` is every peak above the sky, before any gate. `measured` is the peaks
that passed every gate, and equals `detectedStars`. `strong` is the measured stars
whose flux signal-to-noise is 100 or more, the same signal-to-noise the faint gate
uses at 30. `rejected` counts the peaks each gate turned away, under the first gate
a peak fails, so a star that fails two is counted under the earlier. `sky` and
`noise` are the medians of the 64 px tile backgrounds the peaks were judged
against. Only `detectedStars` and `medianHfrPixels` feed alerts and autofocus. A
peak that a gate before the half-flux radius step turns away never has its radius
computed, so these outputs add no measurement cost. They are additive: the named outputs leave the values of the older fields
as they were, and records saved without them still read. `algorithm.version` is 3: the
elongation gate on faint stars raised the count (606 of 717 recorded frames, a median of
84 stars more per frame), so a count from version 2 or 1 is not comparable with it.

`axisRatio` is the median ratio of the principal axes of the stars with a flux signal-to-noise
of 200 or more that pass the faint, clipping and wings gates, whether or not the elongation
gate then rejects them. It is null when fewer than 10 stars qualify, and it is recorded only:
no alert reads it. The elongation gate judges the same stars. Each star's ratio
comes from second moments under a Gaussian window that follows the star (adaptive moments),
because a hard aperture adds the noise of its corners to the moments and a round window pulls an
elongated star toward 1. The moments run only for stars that reach the elongation gate at
that signal-to-noise, about 65 per 26 MP frame. A ratio reads below the star's true axis ratio
by the blur of the Bayer luminance, up to 9% at 2.0, and round stars read 1.00 to 1.02. On the
recorded Soul frames the scale is higher than the hard aperture's, which gave a median 1.19 where
the windowed estimate gives 1.40; the independent Siril PSF fits of the same stars give 1.38.

Bayer detection uses cell averages, but HFR uses native bilinear RGB luminance
before stretching. Interpolation can broaden an undersampled star; native pixels
are the measurement units, not an optical calibration. Counts and HFR are useful
for comparisons within the same camera, framing and settings. The current frame
contract has no sensor saturation level: flat clipped cores are rejected, but
not every saturated star can be identified reliably.

The analysis keeps tile background estimates and candidate-local patches rather
than additional full-size RGB images. It yields between row and candidate batches
so device commands and status reads remain responsive.

Numerical tests use independently integrated Gaussian profiles and a known
circular profile, as well as Bayer patterns, background/noise and invalid-source
cases. Relevant references:

- [Photutils circular curve of growth](https://photutils.readthedocs.io/en/stable/api/photutils.profiles.CurveOfGrowth.html)
- [Photutils detection criteria](https://photutils.readthedocs.io/en/stable/api/photutils.detection.DAOStarFinder.html)
- [ASTAP HFD implementation](https://github.com/han-k59/astap/blob/main/command-line_version/unit_command_line_general.pas)

Preview orchestration stays in `preview.ts`. `bayer.ts` owns bilinear color
reconstruction: complete interior neighborhoods use direct channel sums, while
borders retain in-frame neighbor averaging. `display-stretch.ts` reuses exact
quarter-step sensor values in a lookup table capped at 256 KiB, with the original
asinh calculation for other values and larger ranges. Table construction yields
in batches. `png.ts` owns lossless compression and PNG framing, including a
byte-table CRC-32 and bounded checksum batches.
The Bayer, stretch-lookup and PNG optimizations preserve their numerical behavior.
Equivalence tests cover all Bayer patterns and borders, and an independent
bitwise checksum reference checks PNG framing across multiple batches.

## Display-only background treatment

`background.ts` owns renderer version `background-v1`, selected in the retained
image workshop. It estimates RGB background medians from the same dimmest quarter
of an 8 × 8 spatial grid, subtracts each channel's excess over the lowest channel,
and caps each offset at 10% of the existing linked display range. The original
shared raw-sample 1% black point, 99.9% ceiling (minimum 100 ADU range), and linked
asinh strength 10 remain unchanged. There are no channel gains or separate channel
stretches. Field-filling emission can bias the estimate; a cap is not a color
calibration. Mono and insufficient/invalid background estimates remain unchanged.

`previewPng`, `capturePreviews` and alignment display images use the same `stretchImage`
transform; fit, region and native encoders share one stretch. Native pixels and the
fitted displayed-pixel averages therefore agree; thumbnails use the fitted
derivative. This affects display only: acquisition samples, statistics and solver
inputs remain independent. Rendering and compression retain cooperative yields.

`read-retained-fits.ts` is a bounded reader for Vela's exact original encodings:
signed `BITPIX=32` without scaling, or `BITPIX=16` with `BZERO=32768` and `BSCALE=1`.
It accepts the settings keys above and ignores their values. It applies that unsigned offset once, preserves row order and the declared Bayer
origin, and checks header shape, allowed cards, dimensions, exact payload/padding
and a 30-million-sample bound. It rejects other encodings rather than approximating
them. It is not a universal FITS import library. Saved-image refresh owns file
selection and publication; the reader and renderer do not know about the archive.
