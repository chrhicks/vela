# Targets and framing

The target routes adopt the approved target/framing workshop composition. The
catalog, site-based sky paths, calibrated camera dimensions, and operation
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
start. Last-known state survives transport interruption and device commands remain
blocked. Local composition edits stay available during recovery; an active or
pending framing operation pauses them, and a checked composition requires the
explicit Adjust composition action. A centering action identifies the displayed
solved check and requests one server-owned correction and recheck.

Aladin attribution: retain the renderer’s linked CDS logo and the footer credit.
The npm manifest lists GPL-3; the distributed LICENSE is LGPL-3.0 and incorporates
GPL-3.0. Both texts ship under `apps/web/public/third-party/`. Upstream source for
the exact version: https://github.com/cds-astro/aladin-lite/tree/v3.8.2 .

Browser tests use generated flat gray JPEGs (`tests/fixtures/survey-allsky.jpg`
and `survey-tile.jpg`), created with ImageMagick on 2026-09-07. They contain no
survey imagery: dimensions match the HiPS Allsky atlas (1728×1856) and tile
(512×512) so tests exercise the real renderer without external downloads. They
are generated Vela test fixtures, never application assets.

`SkyInspection` adopts the promoted SkyPath primitive in Through the night.
The server supplies target azimuth/altitude and topocentric Moon positions at
matching 15-minute timestamps. The browser formats local time and retains the
selected timestamp across refreshes and compact/expanded views. A new night
resets selection. The view reports daylight/twilight/darkness for the selected
sample and keeps the last calculation explicitly marked during interruption.
The expanded dialog is portaled inside the app theme, outside the framing
container, with background interaction disabled until dismissal.

No local obstruction profile is currently loaded. The geometric dome explicitly
excludes local obstructions; synthetic workshop fixtures are never imported by
the app. Site coordinates continue to come from the mount at runtime.

## Discovery browsing

`TargetBrowser` adopts the Target discovery workshop specimen. `use-discovery`
restores the last validated page from localStorage per rig, immediately and
without a background recalculation. Type, optical preference, search and page
requests share the server snapshot. Refresh deliberately replaces that snapshot
from the current time. The saved calculation timestamp remains visible; card
altitudes describe that instant, not live telemetry.

Failures retain the last displayed result and identify a pending selection that
could not load. Expired server snapshots require explicit Refresh. Storage
failures do not prevent browsing. Search/filter/page choices travel in the detail
link so returning from framing preserves the discovery context. The cache owns
no rig control state.
