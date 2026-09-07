# Plate solving

This is the shared ASTAP process/WCS boundary. Consumers provide a raw exposure,
J2000 hint and cancellation signal. Composition supplies the executable, local
star catalog and camera field height. A solve returns either a checked WCS and
fixed catalog center, or the documented no-solution outcome. Process, catalog,
malformed WCS and cleanup failures remain errors.

The existing imaging FITS encoder preserves signed acquisition samples and
origin-adjusted Bayer metadata. Bayer input enables ASTAP's `-check` option.
Each solve owns a scratch directory, bounds process duration and waits for
termination before removal. The fixed 5° search radius is a hint bound, not an
automatic retry. Mount coordinate conversion belongs to the astronomy boundary,
not this adapter. Alignment's solver module re-exports this boundary for existing
consumers.

Reference: [ASTAP CLI](https://www.hnsky.org/astap.htm#command_line).
