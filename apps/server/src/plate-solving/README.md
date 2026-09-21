# Plate solving

This is the shared ASTAP process/WCS boundary. Consumers provide a raw exposure,
J2000 hint and cancellation signal. Composition supplies the executable, local
star catalog and camera field height. A solve returns either a checked WCS and
fixed catalog center, or the documented no-solution outcome. Process, catalog,
malformed WCS and cleanup failures remain errors.

The shared [imaging FITS encoder](../imaging/README.md#lossless-fits-interchange)
uses lossless unsigned 16-bit storage when all samples fit, otherwise signed
32-bit, preserving acquisition samples and origin-adjusted Bayer metadata.
Bayer input enables ASTAP's `-check` option.
Each solve owns a scratch directory and waits for process termination before
removal. Search starts at 10° around the hint, then expands to 15°, 30°, 60°,
120° and 180° only after ASTAP exit 1 (no match). The first small expansion
supports moderately inaccurate mount coordinates; doubling thereafter reaches
the full sky in a bounded number of attempts. 180° covers the celestial sphere,
so there is no unexplained angular exclusion. All attempts reuse the same FITS,
hint, field height and options; no new exposure or device command is issued.
Exit 2 (insufficient stars) stops immediately because expanding the catalog
search cannot add stars. Other errors and cancellation also stop immediately.

The configured timeout (30 seconds by default) is one monotonic elapsed-time
budget shared by preparation and every process attempt, not a fresh timeout
for each radius. A slow search may exhaust it before reaching the full sky.
This is a responsiveness budget, not a claim that the image has no solution. Mount coordinate conversion belongs to the astronomy boundary,
not this adapter. Alignment's solver module re-exports this boundary for existing
consumers.

Reference: [ASTAP CLI](https://www.hnsky.org/astap.htm#command_line).

When local tracing is enabled, `astap.solve` records the overall checked outcome
(`solved`, `no-match`, `insufficient-stars`, `error`, or `cancelled`), search hint,
configured field height, total timeout and input image dimensions. Each child
`astap.attempt` records its radius, remaining timeout, exit code and checked outcome.
The final 4096 characters of each stdout/stderr stream are retained, with explicit
truncation flags. Output is available even on a failed or cancelled process;
no image pixels are traced. See [local tracing](../../../../docs/local-tracing.md).
