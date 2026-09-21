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
excluded. The count is this measured population, not a catalog of every star in
the field. A valid image with none reports zero stars and no HFR. An unavailable
analysis is a separate result. Dim or very defocused stars may not be measurable.

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

`previewPng` and `capturePreviews` use the same transform. Native pixels and the
fitted displayed-pixel averages therefore agree; thumbnails use the fitted
derivative. This affects display only: acquisition samples, statistics and solver
inputs remain independent. Rendering and compression retain cooperative yields.

`read-retained-fits.ts` is a bounded reader for Vela's exact original encodings:
signed `BITPIX=32` without scaling, or `BITPIX=16` with `BZERO=32768` and `BSCALE=1`.
It applies that unsigned offset once, preserves row order and the declared Bayer
origin, and checks header shape, allowed cards, dimensions, exact payload/padding
and a 30-million-sample bound. It rejects other encodings rather than approximating
them. It is not a universal FITS import library. Saved-image refresh owns file
selection and publication; the reader and renderer do not know about the archive.
