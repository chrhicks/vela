# September 20: offline follow-up to FRA polar alignment

[Field review](2026-09-14-first-light.md) · [Alignment investigation plan](alignment-and-framing.md)

## Result

The ideal geometry recovers known offsets in the physical trial's **positive starting
corridor**. No sign correction is justified by that previously missing test coverage.
The September 14 discrepancy remains unresolved: the final displayed **62.08″** and
the later **78.95″/minute southward drift** cannot both describe an unchanged rigid
mount tracking correctly about a pole only 62.08″ from the celestial pole.

The exact three-position baseline could not be recovered from the inspected local
artifacts or Codex tool outputs. This is an evidence-limited investigation, not a
full replay of the final alignment run. No equipment was contacted or moved.

## Recovered evidence and its limits

- The five `data/traces/observing-20260914.jsonl*` files now cover only
  **September 15, 16:01:17.988–16:13:05.973 UTC**. The evening alignment spans have
  rotated out. The trace journal is bounded as documented in
  [local tracing](../local-tracing.md); it is not an observing archive.
- The Codex **Prepare FRA 400 rig** session, ID
  `01a0a257-ea72-74e3-bc4d-b0e406aef2d3`, retains historical command outputs.
  Extraction recovered 15 full-precision *displayed measurement* snapshots and
  selected trace rows/solver console output. A displayed result is not the
  baseline's three numerical inputs; the recovered solver console coordinates
  are rounded and concern earlier exposures.
- The final run is `5f21e9d9-4205-432d-8319-68613947e744`. Its first displayed
  baseline result, at exposure start `2026-09-15T01:24:19.417Z`, was altitude
  **891.636636186″**, azimuth **27593.831828281″**, total **21187.782876539″**.
  The final retained result at `01:47:06.953Z` was altitude **19.087372928″**,
  azimuth **−76.841756493″**, total **62.079781385″**. These are recovered app
  outputs, not independent physical measurements.
- No complete set of that run's baseline centers, WCS, exposure-midpoint inputs,
  and contemporaneous site/motion observations was found. Searches covered the
  saved-image metadata, observing/alignment diagnostic artifacts, and September
  14–15 Codex session command outputs. Saved Capture images that night begin at
  `02:20:42.634Z`, after alignment finished; alignment previews were in memory.
- The original two drift FITS, their full-precision ASTAP `.ini` solutions and
  `measurement.json` remain under `data/alignment-diagnostics/drift-20260914/`.
  Both FITS headers confirm 20-second exposures with `SERVER-ESTIMATE` start times.

Local extraction and provenance, including the source session hash and line
numbers, are retained in Git-ignored
`data/alignment-diagnostics/replay-20260920/{extract-codex.py,codex-evidence.json}`.
The extractor reads historical outputs; it does not execute their commands.

## What the new regression coverage establishes

`apps/server/src/alignment/geometry.test.ts` now constructs independent ideal
horizon rays for a Dec80° cone, starting at mechanical RA−LST **+130°** and moving
westward. It covers 54° nominal legs and the 60° accepted endpoints, elapsed
tracking during the baseline, LST wrap, small and large initial offsets, and
correction toward zero after up to 16° of additional sidereal rotation. It checks
signed knob angles, angular pole separation and the correction target.

The existing large-correction tests exercised the mirrored −130°,−76°,−22°
corridor. Both corridors now have coverage. The helper constructs horizon vectors
without importing the production rotation or fitting functions. These remain
ideal geometry tests: they do not replay measured mount positions, plate solves,
timestamp uncertainty, refraction, flexure or a pointing-side transition. The
existing independent ERFA coordinate fixtures remain a separate conversion check.

Three centers define a plane, so a successful three-center fit alone cannot test
whether the mechanical axis remained fixed. Likewise, a single adjustment center
provides two angular observations for two adjustment angles: other image motion
can be interpreted as a knob adjustment. A small numerical fit residual does not
independently establish the mount's physical axis.

## Quantifying the disagreement with drift

The retained centers differ in declination by **170.917945936″ over 129.896 s**.
Equal 20-second exposures preserve that separation when comparing midpoints.

For a rigid mount rotating at the sidereal rate about an axis separated from the
celestial pole by `epsilon`, the magnitude of declination drift is bounded by
`omega × sin(epsilon)`. Here `omega = 360 × 3600 × 60 / 86164.0905`, or
**902.464119 arcseconds/minute**. Earth's rotation about the celestial pole has
no declination component; only the mount-axis component perpendicular to that
pole contributes to this bound.

- A **62.08″** pole error permits at most **0.27162″/minute** of declination drift,
  or approximately **0.588″** during the retained pair's separation.
- Attributing all **78.94836″/minute** to polar error under this model requires
  **at least 5.0187°**, from `asin(78.94836 / 902.464119)`.

This is a conditional incompatibility check, not a recovered polar-error vector.
It does not identify tracking behavior, mechanical movement, optical flexure,
an intervening change, or a biased alignment baseline as the cause. The recorded
server-estimated timestamps and ASTAP solutions also remain measurement inputs,
not independently calibrated truth.

## Next useful slice

Prepare a narrowly scoped diagnostic capture for the next field comparison:
retain the three baseline images and exact WCS/geometry inputs together, then a
short stationary interval and selected adjustment samples with the same timing
and pointing observations. Retain this evidence explicitly beyond the rotating
trace journal. The storage/activation choice is still to be scoped; this report
does not introduce a durable alignment history or change the solver.

Then compare the resulting axis with an independent fresh axis/drift assessment,
with no intervening knob change. A simulator can exercise capture, cancellation
and replay plumbing indoors; actual physical accuracy still requires sky data.
