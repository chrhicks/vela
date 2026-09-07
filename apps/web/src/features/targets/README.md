# Targets and framing

The target routes adopt the approved target/framing workshop composition. The
catalog, site-based altitude paths, calibrated camera dimensions, and operation
state arrive from the server. The browser owns unsaved composition offsets and
survey navigation. It never derives observatory readiness from device telemetry.

`SurveyField` is the Aladin Lite boundary. Its lazy npm bundle includes the renderer
and WASM (Aladin Lite 3.8.2); reference tiles and properties use the same-origin `/api/survey/dss2`
proxy. Disable the library's startup logging, catalog search, survey selection,
and external controls. An Allsky image probe establishes survey availability.
Read properties from the proxy: Aladin 3.8.2's documented minimal-property shortcut
omits `dataproduct_type`, causing its WASM renderer to fail. Do not enable that
shortcut by supplying every optional imageHiPS geometry property.

Desired corners use a gnomonic camera plane and project through the same viewer
as the sky. Actual corners come directly from the solved exposure's WCS. Before
a solve, camera orientation is explicitly assumed north-up. Zoom and pan only
change the reference view; dragging the frame or using its arrow keys changes
the requested J2000 position. No command rotates the camera.

Command responses supersede outstanding reads. Ambiguous commands are never
repeated automatically, and require an explicit current-state read before a new
start. Last-known state survives transport interruption and controls remain
blocked. A centering action requests one server-owned correction and recheck.

Aladin attribution: retain the renderer’s linked CDS logo and the footer credit.
The npm manifest lists GPL-3; the distributed LICENSE is LGPL-3.0 and incorporates
GPL-3.0. Both texts ship under `apps/web/public/third-party/`. Upstream source for
the exact version: https://github.com/cds-astro/aladin-lite/tree/v3.8.2 .

Browser tests use generated flat gray JPEGs (`tests/fixtures/survey-allsky.jpg`
and `survey-tile.jpg`), created with ImageMagick on 2026-09-07. They contain no
survey imagery: dimensions match the HiPS Allsky atlas (1728×1856) and tile
(512×512) so tests exercise the real renderer without external downloads. They
are generated Vela test fixtures, never application assets.
