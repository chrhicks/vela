# Targets and framing

This capability serves an offline target catalog, reference survey images and
one explicit slew/exposure/solve operation. `app.ts` composes its routes with
the shared rig operation lease. A capture run, connection change, or another
framing request cannot take that lease until device work and cleanup finish.

`catalog/` owns the pinned OpenNGC adaptation and its CC BY-SA provenance.
Search accepts familiar aliases, catalog numbers and object types. Discovery
ranks the full catalog for photographic interest and remaining observing time. Sky paths use the
mount's observed site and current UTC time; no saved obstruction map or implicit
environmental safety policy exists. Darkness means Sun below −18°. The paths
and displayed windows are sampled at 15-minute intervals and are approximate.
Morning after astronomical dawn selects the coming night; before dawn retains
the active night. Polar day/night and unavailable site data remain explicit.
Every sample includes target azimuth and the Moon's topocentric azimuth and
altitude at the same time and site, without atmospheric refraction. Azimuth is
0° north, increasing eastward. Lunar illumination is the geocentric illuminated
fraction from Astronomy Engine `Illumination`; waxing means `MoonPhase` is
between new and full (0° inclusive to 180° exclusive). These provide observing
context, not a brightness forecast or a target-quality restriction.

`sky.ts` isolates Astronomy Engine's precession/nutation and the distant-object
aberration correction. Catalog and solved coordinates are J2000. Only J2000 and
topocentric mount frames are currently supported; other or unknown frames are
never relabeled. Independent ERFA reference values exercise the conversion.
Atmospheric refraction, proper motion of foreground stars, solar-system targets
and a horizon-obstruction model are outside this deep-sky catalog capability.

Effective focal length is a durable, explicitly configured rig fact. Sensor
pixel sizes, binning and current subframe are observed from the selected camera.
Camera geometry determines the expected field. A solved WCS determines the
actual footprint, including rotation and parity. The initial north-up orientation
is an assumption until a test exposure measures it; no camera rotation is commanded.

`framing.ts` depends only on its hardware and plate-solver contracts. The adapter
is connected visibly in the routes. Starting enables tracking when necessary,
slews once, takes one fresh exposure and solves it. Tracking remains on for
capture. Stop cancels the owned operation and waits for boundary cleanup; it
does not park the mount or turn tracking off. Failed cleanup remains a failure.
No physical write is automatically replayed.

Centering is a separate user command. It applies one measured sky rotation to
the current mount pointing, then repeats the exposure and check. It never syncs
the mount model and never loops automatically. A check older than 15 minutes,
changed optics/camera geometry, changed mount pointing or tracking, or offset
above 2° cannot authorize a correction. An offset within 0.5′ needs no correction.
Last solved coordinates retain their timestamp when they cease to be current.
Browser reconnection observes server-owned progress; server restart loses the
ephemeral operation and check, and does not resume either.

## Survey boundary

`survey.ts` accepts only DSS2 color HiPS metadata/HEALPix tile paths and canonical
400×300 TAN cutouts. Upstream URLs are fixed; this is not a general proxy. The
browser uses locally bundled Aladin Lite and requests tiles through Vela.
Cache entries retain source attribution under a versioned survey key. Persistent
demand caching deduplicates requests and evicts least recently used entries to
stay within 256 MiB. Cached images can be served without internet access; missing
tiles remain unavailable. Survey photographs are reference sky, never rig exposures.

The default cache is `~/.cache/vela/survey/dss2-color-2019-05-07-v1`.
`VELA_SURVEY_CACHE_PATH` overrides its location, including for restricted local
development environments. DSS imagery retains STScI/NASA rights and CDS credit;
HiPS metadata is ODbL-1.0. See `SURVEY_ATTRIBUTION` and the retained properties
for source and copyright links. No survey is bulk downloaded.

## Solver configuration

Set `VELA_ASTAP` to the installed ASTAP CLI and `VELA_STAR_CATALOG` to its local
star database directory. Framing uses these independently of the simulator-only
polar-alignment endpoint configuration. Read-only target browsing remains
available when solving or the camera is unavailable.

## Target discovery

`discovery.ts` calculates remaining astronomical-darkness opportunities above 30°
from a single site/time observation. Type, apparent extent and a modest set of
familiar showpieces provide a photographic-interest heuristic, balanced against
remaining useful time and altitude. This is not a measured image-quality score:
weather, local obstructions, Moon interference and camera fit are not modeled.
Explicit search includes objects without a useful window.

`discovery-routes.ts` keeps up to twelve disposable calculations, each identified
by an opaque snapshot ID. All categories, optical-filter choices and pages reuse
the same site and instant without rereading the mount. Refresh creates a fresh
calculation. A missing snapshot returns 410 instead of silently changing order.
The browser owns the last-page cache; server restart does not restore snapshots.

Filter advice distinguishes Hα/O III emission from broadband starlight. Chris's
Optolong L-Ultimate has dual 3nm passbands; recommendations never infer that it is
installed. Mixed or unspecified catalog types receive conservative broadband
guidance. No filter or device command is issued by browsing.
