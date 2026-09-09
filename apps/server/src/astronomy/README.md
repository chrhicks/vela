# Astronomy coordinates

`coordinates.ts` converts distant J2000 catalog positions to and from airless
topocentric apparent coordinates, using Astronomy Engine precession/nutation and
annual/diurnal aberration. Site longitude is east-positive. It owns no mount
commands, target discovery, or alignment operation state. The targets sky module
re-exports these helpers for its existing consumers.

Physical alignment converts each solved sightline at exposure midpoint and pairs
it with Greenwich apparent sidereal time plus site longitude. Its geometry output
must convert back to J2000 before projection through ASTAP WCS. This is separate
from the explicitly configured simulator's synthetic clock/frame convention.
Capture start and timestamp provenance remain the image's display metadata.

The independent ERFA fixtures in the alignment tests construct a known physical
axis in horizon coordinates, then convert it to catalog coordinates. They test
frame conversion, midpoint timing, sidereal wrap, pole recovery and correction
projection together. They do not establish outdoor precision: atmospheric
refraction, flexure and mount motion are outside this mathematical boundary.
