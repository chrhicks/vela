# Targets and framing

The target routes adopt the approved Fieldroom Explore/framing composition. The
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
solved check and requests server-owned automatic centering: at most four
corrections, each measured by a fresh solve, stopping within 0.5′ or after two
consecutive worsening measurements. Start remains one Slew & check; Check current
frame never moves the mount. Centering progress belongs to its fixed desired
composition and is hidden when that composition is edited. A centered outcome
requires a current matching solved check. WorkingIndicator is active only while
server-confirmed activity is reachable; offline or uncertain commands retain
measurements without implying current hardware activity. A nonconverging result
remains a valid checked frame, but needs an explicit new Check before centering.

Camera-read interruption (`captureReadState: 'retrying'`) keeps the active framing
operation, solved footprint, measurement timestamp and centering history. It hides
Working feedback and names retries of the same exposure. Stop remains available
while the server is reachable; existing uncertain-command precedence still applies.

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
selected timestamp across refreshes and dialog dismissal. A new subject or night
resets selection. The view reports daylight/twilight/darkness for the selected
sample and keeps the last calculation explicitly marked during interruption.
Explore opens the sky directly from the icon beside the selected subject’s
Through the night heading, using the approved `Panel.explore-sky` composition.
Subject facts retain catalog and imaging advice. Frame keeps a compact sky
summary beside its heading and opens the same sky dialog directly from its icon.
A `#sky` link opens the dialog after target data arrives; dismissal removes the
hash so background refreshes do not reopen it. Framing details and state belong
inside the result card. Optics settings sit inside Frame position & controls;
`SurveyField` accepts the route-owned settings content without owning rig commands. The dialog is portaled inside the app theme, outside the framing
container, with background interaction disabled until dismissal.

No local obstruction profile is currently loaded. The geometric dome explicitly
excludes local obstructions; synthetic workshop fixtures are never imported by
the app. Site coordinates continue to come from the mount at runtime.

Through the night colors the supplied target samples using their geometric
solar altitude: daylight at/above zero, civil twilight below zero, nautical
at/below −6°, astronomical twilight at/below −12°, darkness at/below −18°.
The [NWS twilight definitions](https://www.weather.gov/fsd/twilight) describe
the twilight limits. The zero-degree boundary is a geometric convention, not
a refracted upper-limb sunrise/sunset prediction. Light colors, legend and
selected-phase text come from the approved Light windows specimen. Phase
changes follow the existing 15-minute samples and are explicitly approximate.
Explore and Frame share the same phase presentation.

## Discovery browsing

`TargetBrowser` presents nine catalog cards, a selected-subject summary and an
explicit Frame this subject link. View subject changes selection only; it never
slews. `use-discovery`
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


Fieldroom requests nine results per page. Stored pages with another page size
are ignored rather than painted under the new presentation. Search/type/filter,
page and selected subject travel in URL state; the displayed result remains
associated with its confirmed query when a replacement request fails.

`/explore` uses a separate rig-less catalog projection and no observing-site
values. Reference imagery, intrinsic dimensions/classification and optical-filter
advice remain available. A rig is required for a framing command or a sky window;
browsing alone never commands hardware. The existing operational route retains
its frozen site/time snapshot and explicit Update sky.

`FramingExposure` shows the exact temporary framing acquisition, independent of
whether a position could be solved. Nullable check identity never lends a newer
unsolved preview the authority of an earlier WCS. It uses the shared image
inspection mechanism, with real fitted/native resources and no Capture Keep or
Saved claim. Image retries are exact GETs, not new exposures. Missing native bytes
leave already loaded pixels visible. Source statistics come from that exposure;
unavailable analysis is not zero stars.

Continue to capture keeps its exact current-check/target/composition guards and
opens `/observe?target=…` for preparation. Starting remains a separate explicit
command. Detailed sky inspection, centering history and frame nudges are retained
in progressive disclosures; reference-view reset/zoom never edits composition.

Equipment edits effective focal length through `focal-length-api` and
`useFocalLengthSettings`, without mounting the framing exposure controller. The
existing framing GET exposes saved focal length even when framing is unavailable.
The configuration boundary validates the full projection, rig identity and
observation age, then exposes only focal length, active state and timestamp.
Saving requires a finite 10–20000 mm value and confirms that exact returned
value; a malformed, stale, different or lost response remains uncertain. A
subsequent matching GET confirms persistence, while an explicit differing GET
allows the user to review and retry. No write is automatically repeated.
