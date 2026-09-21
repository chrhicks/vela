# Capture image processing

## Lossless FITS interchange

`fits.ts` is the shared encoder for captured originals and plate-solver inputs.
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
These optimizations preserve the prior native and fitted image bytes; they do
not change stretching, resolution or acquisition data. Equivalence tests cover
all Bayer patterns and borders, and an independent bitwise checksum reference
checks PNG framing across multiple batches.
