# Capture image processing

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
