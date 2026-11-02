# Plate solving

`@vela/rig-astap` owns the ASTAP process, its FITS file and its WCS parsing. This
folder adds the verdict for the two workflows that move or measure the rig.

`judgedSolver` wraps an ASTAP solver for one purpose, `framing` or `alignment`.
Each solve goes through `judgeSolve` and comes back as either a position with its
plate (`solved`) or `no-solution` with the verdict's reasons: `no-match`,
`few-stars`, `scale`, `parity` or `off-hint`. A rejected solve is treated as a
failed one, so no workflow centres on it or counts it as a measurement. The reasons
reach the framing message, the alignment warning and the trace.

The verdict compares the solution with three facts the caller supplies:

- the expected scale, from the field height the caller gives ASTAP (the rig's
  focal length and the camera's pixels) and the frame's height;
- the parity, always positive: the camera path never mirrors;
- where the mount claims to point. Alignment's claim is its hint. Framing's hint is
  the composition, so it passes the mount's reading from just before the exposure.

The solver searches from 10° to the whole sky, so a solution can be found
anywhere. A solution more than 10° from the mount's claim is rejected `off-hint`,
and the workflow asks for another exposure instead of using it. The message names the
distance in degrees. Vela no longer recovers a lost mount position by trusting a far
solve: a mount that is not where it thinks it is must be stopped and fixed.

The rig simulator renders with east on the left, as the real camera does, so a solve of
a simulated frame has the same parity as a solve of a real one.

The star count is not read from ASTAP, so the verdict does not check it.

`projectSky` (a sky position to a pixel of a WCS) lives in `../targets/sky.ts`,
beside the inverse.
