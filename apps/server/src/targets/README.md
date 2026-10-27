# Targets and framing

This capability serves an offline target catalog, reference survey images and
explicit framing checks and bounded automatic centering. `app.ts` composes its routes with
the shared rig operation lease. A capture run, connection change, or another
framing request cannot take that lease until device work and cleanup finish.

`catalog/` owns the pinned OpenNGC adaptation and its CC BY-SA provenance.
Search accepts familiar aliases, catalog numbers and object types. Discovery
ranks the full catalog for photographic interest and remaining observing time. Sky paths use the
mount's observed site and current UTC time; the only obstruction model is the
optional approximate backyard horizon below, and no implicit environmental safety
policy exists. Darkness means Sun below −18°. The paths
and displayed windows are sampled at 15-minute intervals and are approximate.
Morning after astronomical dawn selects the coming night; before dawn retains
the active night. Polar day/night and unavailable site data remain explicit.
The current altitude, azimuth and topocentric Moon separation are calculated at `observedAt`, separately from
the sampled night span, which can begin hours in the future. Current direction
must not be inferred from the nearest night sample.
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
Atmospheric refraction, proper motion of foreground stars and solar-system targets
are outside this deep-sky catalog capability. Local obstructions are the optional,
approximate backyard horizon described next.

Effective focal length is a durable, explicitly configured rig fact. Sensor
pixel sizes, binning and current subframe are observed from the selected camera.
Camera geometry determines the expected field. A solved WCS determines the
actual footprint, including rotation and parity. The initial north-up orientation
is an assumption until a test exposure measures it; no camera rotation is commanded.

`framing.ts` depends only on its hardware and plate-solver contracts. The adapter
is connected visibly in the routes. Starting enables tracking when necessary,
slews once, waits for three consistent position observations one second apart,
then takes a fresh exposure and solves it. A driver's `Slewing=false` alone does
not establish stable coordinate observations. If the position changes during a
check, retain the solved footprint, wait for stable observations, and take another
exposure without repeating the slew. Stop cancels that wait. Tracking remains on for
capture. Stop cancels the owned operation and waits for boundary cleanup; it
does not park the mount or turn tracking off. Failed cleanup remains a failure.
No physical write is automatically replayed.
Framing stop takes no input. Send it as a POST with an empty body. Any non-empty body, `{}`
included, is refused with 400 under every content type and the request does nothing; a
`Content-Type` header on an empty body is ignored. Start, check and center still require their
exact JSON fields.

Centering is a separate user command, bound to the exact solved-check ID and the
current edited composition coordinates. One request refines automatically until
the solved center is within **0.5′**, with at most **four corrective movements**.
Two consecutive corrections that increase the measured distance stop the loop.
An unchanged offset consumes an attempt without counting as improvement or worsening.
The starting offset and every result are calculated against that request's fixed
desired center, including when the user edited the composition since the last check.

Each correction applies the last measured sky rotation to the current mount
pointing, then settles, exposes and solves again before calculating another move.
It never syncs the mount model or replays a failed or uncertain command. A check older
than 15 minutes, changed optics/camera geometry, changed pointing side, mount pointing or
tracking cannot authorize a correction. Editing the destination does not invalidate
an otherwise current measurement. There is no fixed 2° correction cutoff: the
vector rotation supports large displacements, with the antipodal ambiguity rejected
explicitly. One observed pointing offset does not guarantee correction accuracy
elsewhere in the sky; each correction is checked with a fresh exposure.
An initial offset within 0.5′ skips movement and rechecks before reporting success.

Framing requests the adapter's narrow optional pointing-side observation, not its
alignment rate observations. Unsupported/indeterminate side remains `unknown`;
it is never inferred from the target or image rotation. A changed side during a
movement is reported with that movement's fresh solved measurement. A change
during an exposure discards that measurement's authority to command and rechecks
without another slew. There is no predicted destination side or forced flip.

The ephemeral view retains bounded measurement summaries: check ID, time, offset,
rotation, observed side, comparison and correction number. `phase: checked` means
a valid current solve, while `centering.outcome` distinguishes centered, limit
reached and non-convergence. The last two outcomes require an explicit new check
before another centering request. Downloading is published from acquisition's
actual readout callback. Browser loss does not stop the server-owned loop; Stop
holds the rig lease until cleanup confirms completion.

`captureReadState` independently marks interrupted transport reads of an
acknowledged exposure. The adapter retries those reads in place; recovery does
not complete the frame, repeat a slew or authorize another correction. The last
solved footprint, timestamp and centering history remain intact until a new solve
is published. Stop clears that indicator and waits for cleanup, preserving failed
cleanup as failure. Callbacks from cancelled or settled captures are ignored.

When `VELA_TRACE_PATH` is enabled, [framing tracing](../../../../docs/local-tracing.md#centering-and-framing-evidence)
persists exact desired/solved positions, WCS, pre/post mount readings, commands and
per-correction outcomes under one trace. Completed child records are available
before the operation finishes. This is numerical evidence; original framing FITS pixels
are not retained. Save the rotating journal after a trial that needs investigation.

**Check current frame** takes an exposure and solves the current field without a
slew or tracking change. Use it to establish a fresh measurement after a rejected
check or to recover centering without resending a raw target slew. A no-solution
or known unavailable check becomes `needs-check`, retaining the composition and
last solved footprint with a concrete next action. Unconfirmed physical work still
reports failure and requires state inspection before another command.
Last solved coordinates retain their timestamp when they cease to be current.
Browser reconnection observes server-owned progress; server restart loses the
ephemeral operation and check, and does not resume either.

## Backyard horizon (approximate, warn only)

On 2026-10-26 a tree blocked both scopes and Vela had no idea trees exist. A rig can now have a **horizon profile**: the
altitude of the skyline (trees, roofs) at each azimuth bin, from Chris's photo
survey. It only warns. It never blocks, filters or re-ranks a target, a slew or a
run, and it changes no alert. The profile is approximate: the survey's north is
not demonstrated true north and the offsets come from one Sun sighting.

**The file.** `horizon-<rigId>.json` sits in Vela's data directory next to
`rigs.yaml` (`dirname(VELA_RIG_CATALOG_PATH)`), mode 600, never in the repo.
`<rigId>` must match `[A-Za-z0-9][A-Za-z0-9_-]*`, otherwise the rig has no profile.
It is read on each request, so a re-import takes effect without a restart.

```json
{
  "version": 1,
  "approximate": true,
  "note": "Approximate ...",
  "importedAt": "2026-10-28T00:00:00.000Z",
  "offsets": { "azimuthDegrees": 10, "altitudeDegrees": 1 },
  "stepDegrees": 1,
  "altitudesDegrees": [12.5, null, 3.2]
}
```

`altitudesDegrees[i]` covers azimuth `[i·step, (i+1)·step)`, 0° north, increasing
eastward, with `360 / step` entries (`step` divides 360). A number is a **traced**
bin: the skyline altitude, 0 to 90. `null` is an **unknown** bin: the survey had
no trace there. Unknown is not open sky and not blocked. A malformed or
unreadable file is ignored with one warning in the server log (no values), and
the rig behaves as if it had no profile.

**Import.** `tools/horizon-import` converts the survey's `horizon-data.json`
(`stepDeg`, `samples[]` with `az`, `smooth`, `supported`) into that file. Each
survey azimuth gets the azimuth offset, then falls in an output bin. A bin takes
the highest `smooth` of its samples plus the altitude offset, floored at 0. A
bin is unknown when it has no sample, or any of its samples is unsupported. The
offsets are required arguments, not defaults. The command writes to a directory
you name and never guesses Vela's data directory. See its README.

**Classification.** `horizonStatus(profile, azimuth, altitude)` returns `behind`
when the altitude is at or below a traced bin's skyline, `clear` when above it,
and `unknown` for an unknown bin. No profile means no status (`null`), never
`clear`.

**What the page gets.** Each sky sample carries `horizon`: `clear`, `behind`,
`unknown`, or `null` without a profile. Each discovery item carries
`horizonInWindow`, the minutes of its above-30° window (counted in the 15-minute
samples inside it) that are behind and unknown, or `null` without a profile or
without a sample in the window. The skyline itself, its azimuths and the offsets
never leave the server: not in responses, logs, traces or test fixtures. Tests
use a synthetic profile.

**Where it shows.** The altitude trace marks the stretches behind the profile
and the stretches with an unknown horizon, and its text says so. The target list
says "May be behind trees" for the planned window, with the minutes, and says
the horizon is untraced for part of the window when bins are unknown. A window
that is both shows both.

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

## Temporary framing exposure inspection

Every framing acquisition runs solving, display rendering and linear-sample star
analysis on the same samples. Rendering and analysis are independently fallible;
neither failure changes a successful solve or requests another exposure. The
operation awaits all consumers before releasing samples. Stop aborts publication
and waits for these consumers, so a late completion cannot replace a later check.

`FramingView.preview` describes the most recent completed acquisition separately
from `actual`, the most recent solved footprint. A new no-solution image has its
own acquisition ID and null check ID while the older footprint remains visible.
The camera name is the selected camera confirmed by readiness, exposure duration
is the requested value, and timestamp/source come from acquisition (legacy omitted
source means camera-reported). A check ID is assigned only by solving those exact
samples. Nullable resource URLs mean rendering failed; nullable statistics mean
analysis failed. Zero detected stars remains a valid measurement.

Each controller retains at most three fitted/native PNG pairs in memory. Exact
acquisition-ID GETs never touch hardware and return 404 for missing or expired
resources. The immutable URL always means the same image; when the renderer does
not need to downsample, Fit and Native serve the same native PNG. Restart loses
these resources. No FITS retention, capture identity or Saved status is implied.

## Catalog-only browsing

`GET /api/web/target-catalog` shares validated query, category, filter and page
projection with rig discovery. It ranks pinned catalog facts using `site: null`
and performs no rig lookup or adapter access. Its separate `TargetCatalogView`
contains no site, sky, opportunity, snapshot or rig identity. Both endpoints accept
`pageSize` from 1 through 12 (default 12); page size never changes a rig discovery
snapshot's site/time. Major and minor catalog dimensions retain their own nullable
facts rather than inventing an extent for unknown values.
