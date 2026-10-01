# Explore, framing, and preparation

Status: accepted at `8906518` after independent OK and final browser comparison.
Tonight/Appearance passed its gate at `032c8b1` before this slice began.
The parent accepts the concrete decisions below within the already approved
required feature work; no new execution permission is needed.

## Inspected references and existing boundaries

Frozen app 03.1 (1440×900), 03.2 and 03.3 (1440×989), plus the already inspected
03.9/03.11/03.14 state regions, are the composition authority. DS foundations
supply paired colors, fonts, controls, surfaces, and focus behavior. The frozen
PNG measurements below are visual bounds, not a claim to have read live Paper
node styles. Keep 36px desktop outer insets and the settled 88px navigation;
compare both palettes with identical imagery and layout.

The existing paths remain:

- Explore: `/rigs/:rigId/observe/targets`.
- Framing: `/rigs/:rigId/observe/targets/:targetId`.
- Preparation: `/rigs/:rigId/observe`.
- Tonight: `/rigs/:rigId/observe/capture`.
- New, narrowly justified rig-less catalog: `/explore`.

`routes/targets.tsx` currently branches between `TargetBrowser` and a large
`TargetComposition`. `TargetBrowser` uses `useDiscovery`; the server
`targets/discovery-routes.ts` owns frozen site/time snapshots, with up to 12
snapshots, explicit 410 expiry and a current 12-result page. `discovery.ts`
already produces catalog-only candidate ordering with `site: null`: categories,
filter advice and intrinsic photographic-interest ranking remain, opportunities
and sky are absent. This path can serve the no-rig browse without a new ranking
engine or observatory location setup.

`targets/routes.ts` owns target presentation, site inspection, framing readiness,
settings endpoints, controller lookup and operation leases. Every existing
catalog/discovery endpoint first looks up a saved rig. Site reads require one
unambiguous mount; target browsing itself does not require a connected camera
or configured solver. `catalog/index.ts` is the pinned, local catalog boundary.
Constellation has now been retained; major/minor axes are both present internally,
but only major-axis `sizeArcminutes` is currently public. No distance exists.

`useFraming` owns one browser command/poll flow; command responses supersede
old reads, failure/uncertainty requires explicit state inspection, and reconnection
does not replay commands. `SurveyField` owns real Aladin reference rendering,
zoom/pan, desired-frame manipulation and actual WCS overlay. `SkyInspection`
retains detailed sampled sky inspection. Keep these boundaries and attribution.

`routes/observe.tsx` is currently a preparation/activity hub, with `useObservation`
for server-sequenced device connection, `ImagingCamera`, and `CaptureHub`.
`CaptureHub` itself mounts `useCapture` and the latest capture preview. `useCapture`
is already the sole command implementation for Start/Stop/cooling. Preparation
can compose that hook once and remove the displaced hub on its route; it must
not accidentally mount both a new capture form hook and the old CaptureHub poll.

## 03.1 Explore composition

At 1440px the title/header sits near y=120. The control row begins y=180 and is
46px high: search x=36, width≈718; object type x=768, width≈254; imaging preference
x=1036, width≈368. Replace current filter-chip bands with the approved Select
presentation while preserving query semantics and server filter advice.

The card group occupies approximately x=36..951, with three 293px cards and
18px gaps. Cards begin y=288 and end near y=763; their photograph regions are
227px high, followed by 24px-inset metadata/action bodies. The selected card has
the stronger outline. The sky/details region is x=978, y=250, width≈426,
height≈542, with 24px inset. It is not the 452px Tonight sidebar. Page controls
sit at the bottom near y=816. Let longer truthful copy grow the page rather than
clip it at 900px.

A card's View subject action selects the subject for the right-side summary.
Frame this subject is a distinct navigation action to the existing framing URL;
selecting or inspecting a card must never slew. Preserve selected subject ID in
page-local/URL presentation state and reset it deliberately when the displayed
page no longer contains it. Keep search/category/filter/offset in detail/back
links. Requested filters during a failed fetch must not relabel old cards as
results for the failed selection.

The source shows 3 results per page. Add a small bounded `pageSize` query to the
existing discovery endpoint (keep the existing default for direct callers), and
have Fieldroom request 3. The snapshot remains site/time-scoped, independent of
page size. Validate page size and include it in cache reuse compatibility; old
12-card cached pages must not paint as a claimed 3-card page. Ignoring incompatible
cached presentation is sufficient; no cache migration framework.

Keep Update sky as explicit refresh; no timer silently reranks the screen.
Display calculation age and current/upcoming/polar-night semantics. The “Home
observatory” sample is not a saved site name: use the actual rig/site context.
No site, no darkness, explicit search with no useful window, empty filters,
thumbnail failure, snapshot expiry, offline retained cards and first load retain
their distinct existing outcomes.

For the compact sidebar trace, reuse the settled AltitudeTrace geometry boundary
or a small presentation variant driven by the same sampled sky contract. Preserve
the detailed SkyInspection path. Do not draw Paper's illustrative obstruction
line or a fake smooth fitted curve as measured horizon data.

Two narrow factual projection additions are justified by the actual source rows:

- Retain minor-axis extent in `TargetView` (e.g. a nullable
  `minorSizeArcminutes` beside current major axis) to display real `18′ × 12′`
  values. When absent, use the measured major extent/unknown wording; do not
  copy sample dimensions.
- The sky projection now supplies current altitude and azimuth at `observedAt`
  (Tonight review correction). Add current Moon separation alongside these
  values for the source summary; Moon positions are otherwise sampled. Calculate
  from the same observer/time used by `skyPath`; do not label the nearest
  15-minute sample as exact “now.” If kept sampled instead, explicitly label
  that sample time in the UI and record the source-copy substitution. No new
  hardware read or ephemeris provider is required.

Directions and angular separation are observing context, not readiness policy
or a claim about weather/local obstructions. Keep filter advice explicit about
not detecting installed filters. Distance remains unavailable where a detail
row calls for it.

## Smallest working rig-less Explore

Add `/explore` and `GET /api/web/target-catalog?q=&category=&filter=&offset=`.
The endpoint uses only pinned catalog data, `discoverTargets({site:null})`, and
the existing thumbnail URL presentation. It never looks up a rig or calls an
adapter. Reuse a small validated query/page helper and catalog presentation
function with rig discovery instead of copying whole handlers or fabricating
`rigId: ''` and an unavailable-rig error.

Use a separate narrow `TargetCatalogView` contract: query/category/filter,
offset/pageSize/total, and catalog items with classification/filter advice and
reference thumbnail. No snapshot ID, rig identity, night/site or failed-site
reason is needed; this is deterministic catalog browsing, not a failed night
calculation. Reuse named item types where accurate, without weakening
`TargetDiscoveryView` with optional rig fields throughout the operational path.
URL state is sufficient; a second persistent browser cache is not necessary.

Reuse the Explore card/selection presentation with explicit catalog context.
Search, type/filter choices, pagination, subject selection, facts and reference
images all work. The right-hand region says sky timing requires a rig/site and
offers the existing Home Add/choose-rig path. It must not render current
altitude, tonight windows, Moon separation, calibrated camera frame or mount
controls. A rig-less selection alone cannot authorize physical operations.
A separate generic target-detail API/route is unnecessary for this first slice:
the list already carries the selected card's facts. Add one only if a concrete
supported deep-link requirement needs an item outside the current page.

Wire 03.8's Explore action to this route. Coordinate Home and navigation labels
with the Equipment plan; do not add unrelated rig-less Photographs or make the
existing global rig selector silently change its settled Tonight destination.
A card can offer an explicit choose-rig handoff later when a saved rig exists;
the minimal no-rig experience must already be genuinely browsable without it.
This is a justified required feature for the approved first-night control,
not a location picker, hosted public catalog, or backend discovery subsystem.

Required proof: `/explore` succeeds with an empty rig catalog and deliberately
throwing device adapters; alias/type search, pagination/filter validation,
unknown values, reference-image failure and browser history work. It must issue
no rig reads or physical writes, and no sky value may be inferred from the
browser/server location.

## 03.2 Framing composition and preserved operations

At 1440×989: header/back row near y=120; main starts y=180 with 888px left,
28px gap, 452px right. Survey card bounds approximately x=36,y=180,w=888,h=721.
Its toolbar is 54px; the main reference field y=235..755 is 520px high; geometry
caption and remaining surface occupy the lower region. Reproduce the grid's
stretch/alignment without forcing every state to a fixed height. The right
solved-state region is approximately y=180..435, with 24px inset and a 46/56
Space Grotesk offset metric. A test-exposure heading near y=456 leads to a
124px-high fitted thumbnail at y=508. Test-duration, Check current frame,
Adjust composition and Continue controls occupy the remaining right column.
Footer observation context sits below the columns.

Preserve separate intent and command meanings:

- Pan/zoom/reset changes the reference view only; dragging/arrowing the desired
  footprint changes unsaved J2000 composition only.
- Slew & check remains an explicit initial command: enable tracking if needed,
  one slew, stable observed pointing, exposure and solve.
- Check current frame captures/solves without a slew or tracking change.
- Center composition stays bound to exact check ID and edited destination;
  existing 0.5′ tolerance, four-correction cap, two-worsening stop, operation
  lease and fresh-solve-per-correction semantics remain unchanged.
- A checked composition is locked until Adjust composition; active/pending
  commands pause edits. Preserve actual footprint/time through interruption
  and stale measurement states; stale data cannot authorize centering.
- Stop remains available under the existing reachable/confirmed active-state
  preconditions and awaits cleanup. Do not park, disable tracking, repeat a
  slew, or disguise failed cleanup.

All existing active phases, read-retrying state, no-solution, obsolete check,
server restart, non-convergence, correction limit and uncertain command feedback
must fit the right-hand state region. Keep detailed measurement history in
progressive disclosure, not deleted to resemble the quiet source. Survey GET
failure retains composition and Retry survey never repeats a hardware command.

Current exact-match decisions in TargetComposition already gate Continue using
matching target, desired position, checked phase, checkCurrent and no
interruption/uncertainty. Keep these conditions and current error explanations.
The reference's last-test thumbnail introduces the real capability below.

## Framing exposure preview: required concrete capability

Today `FramingHardware.capture()` returns a `FramingFrame` with real linear
samples, dimensions, exposure time source and color. `measure()` immediately
solves it; only WCS/check metadata survives. The server README explicitly says
framing FITS pixels are not retained. Do not substitute the survey photograph or
the previous capture image for this exposure.

Add a narrow `FramingPreview` projection under `model/web/targets.ts`, owned by
framing, with acquisition ID, target/rig association, native dimensions,
exposure seconds, camera name, acquired timestamp and source, preview
availability/URLs, and nullable solved check ID. Keep it distinct from
`FramingView.actual`: a newer unsolved exposure must coexist honestly with an
older solved footprint. The image's check ID is only assigned from the solve of
those exact samples; whether that check is current remains a separate observed
condition. URL identity never changes to mean a different frame.

At the measurement boundary allocate the acquisition identity and run existing
`imaging/preview.ts` rendering independently of solving. Reuse `capturePreviews`
for a fitted/native pair because 03.3's Fit/100% control needs real native pixels.
Catch rendering failure separately: it cannot convert a successful solve into
a failed check or replay exposure/slew. A no-solution still publishes its real
preview. Keep callbacks/publication generation-scoped so Stop, rig replacement
or a later check cannot receive stale preview completion. Release raw samples
when both consumers finish; never add a second exposure to obtain a thumbnail.

Use a small per-rig bounded memory cache (three preview pairs is sufficient and
consistent with current image inspection), no durable FITS store/run history.
Expose exact acquisition-ID GETs for fitted/native PNGs under framing; a
missing/expired ID returns an explicit missing-resource response. On browser
retry, request the same resource. Retain already loaded pixels when the cached
resource expires, and disable unavailable native reload with a truthful message.
Controller/view ownership of last preview allows preparation to read it after
route navigation; restart honestly loses this ephemeral resource.

The browser's capture `LatestImage` currently assumes `CaptureImage`, capture
Keep endpoints and saved state. Do not manufacture `saved:false`, statistics
or capture identity simply to satisfy that interface. Extract the minimal
loaded-image/viewport/enlargement presentation primitive if necessary, with
explicit caller-supplied actions. Existing capture retention stays owned by
Capture; framing supplies no Keep/download-original action without a separately
agreed artifact capability. Preserve exact bytes, pan, held identity, focus and
palette-switch behavior in any shared extraction.

03.3's sample HFR/stars and Saved badge are not currently framing capabilities.
The adopted capability plan explicitly excludes a new framing FITS-retention
workflow. Report temporary framing-check state instead of Saved. Star metrics
may reuse the existing linear-sample analysis only if included deliberately in
this slice; otherwise show unavailable and record that substitution. Do not copy
842 stars/2.1 HFR or report saved because bytes remain in the memory cache.

## 03.3 Preparation and the Tonight handoff

Use `/rigs/:rigId/observe?target=<id>` for the approved preparation scene.
Framing's Continue to capture navigates here with explicit target intent;
existing direct Tonight URLs stay valid. Starting a capture is still the
existing explicit command, not a side effect of Continue/navigation.

At 1440×989: main starts y=116, 28px below navigation; 888px image column,
28px gap, 452px context column. The image card matches Tonight's 686px anatomy:
54px toolbar, 560px fitted image area, 70px metadata. Right subject row/title
and divider precede settings near y=278, approximately 355px high; settings
use 22px inset, 46px fields/actions, camera selection, exposure duration,
repeat and Save every exposure. Camera cooling begins near y=660 and uses a
46/56 temperature metric, separate observed switch and setpoint/Apply action.
The equipment divider/footer begins near y=909. No fixed 989px crop may hide
connection/cooling/save errors.

The left scene is **Last test exposure**, from the real framing-preview boundary,
with its own target/time/solve identity. If there is no matching framing image,
show the approved no-exposure/readiness state. Never relabel a previous target's
image using the new target heading; either identify its actual source or keep
the empty state. Preview load failures and physical acquisition readiness are
independent. Inspect image uses the same fitted/native held-image semantics.

Compose one `useCapture` for readiness/Start/Stop/cooling. Preserve exposure
limits, repeat false single exposure, Save frames semantics, active-run ownership
and reconnection. Only navigate to Tonight after an accepted Start response or
explicitly verified current run; do not infer success from a fulfilled Promise
because `useCapture.start` currently returns void on failure too. A narrow
confirmed-result return from the hook can support this handoff without a new
state machine. Failed/uncertain Start remains here with Check capture state;
no automatic repeat. Existing active capture opens Tonight rather than enabling
a second preparation start.

Camera choice must use the existing ID+name selection/save boundary. Changing a
select cannot silently become a capture command. Choose either an explicit
camera-save acknowledgement before Start or an explicit sequential save-then-
start flow whose confirmed results are visible; a failed/unconfirmed selection
must never start against an old camera. Coordinate with Equipment's shared
imaging setup work so this slice does not create a second selection protocol.

Cooler toggle and requested setpoint remain distinct user commands. Render
confirmed On/Off separately from temperature proximity. The source supports
starting while cooling; do not add a temperature gate. Preserve unsupported
setpoint, unavailable telemetry, busy, rejected and unconfirmed writes, explicit
inspection, no blind replay and truthful power/temperature readings. A small
semantic switch primitive, if needed to match 03.3, must be built/verified in
the workshop; do not restyle a checkbox into an inaccessible toggle ad hoc.

Keep preparation's connection actions/outcomes and links to autofocus/alignment/
Equipment available where needed. Avoid a second full activity dashboard inside
the approved normal layout; unavailable state can expose the relevant preparation
section. Continue using shared rig observation for equipment footer state.

## Owners, fixtures, and focused verification

| Boundary | Likely files |
| --- | --- |
| Catalog/sky projections | `packages/model/src/web/targets.ts`, exports, validation/type tests; web `features/targets/validation.ts` |
| Rig-less catalog | Server `targets/catalog-routes.ts` (new small route), `discovery-routes.ts` shared query/presentation helpers, `targets/routes.ts` visible composition; web `routes/explore.tsx` or deliberate `Targets` branch, `main.tsx`, navigation/Home entry coordination |
| Discovery presentation | `TargetBrowser.tsx`, `use-discovery.ts`, `target-discovery.css`; small selected-subject/sky panel and card components |
| Framing preview/server | `targets/framing.ts`, `targets/routes.ts`, new narrow preview-cache helper if it clarifies ownership; shared imaging renderer reused, no adapter behavior change |
| Framing composition | `routes/targets.tsx`, `targets.css`, `SurveyField.tsx`, `CenteringFeedback.tsx`, preview viewer, existing geometry helpers |
| Preparation | `routes/observe.tsx`, scoped preparation CSS, `CaptureCooling`, camera-selection boundary, narrow `use-capture` confirmed-result return, target intent handoff |
| Shared image primitive if required | `features/capture/LatestImage.tsx`/loading-native helpers, with image owner coordination and preservation of capture/Photographs behavior |
| Docs | Existing targets/server targets/imaging/observation READMEs and owning adoption plan; do not leave trace docs claiming no preview once previews exist |

Extend the Phase 3 real-route review fixture registry, never a production mock
mode. Fixed rig IDs, time/timezone, palettes, exact API order and hashed local
reference images; unknown requests fail instead of escaping to the LAN.
03.1 cards use the known Crescent/Andromeda/M13 licensed reference files; fixture
labels identify illustrative sky and exposure data. Framing's real Aladin
renderer needs deterministic HiPS metadata/allsky/tiles; gray test tiles prove
interaction, not visual equivalence to Paper's sky photograph. Prepare a faithful
frozen survey scene for visual comparison and record any reprojection differences
separately from layout drift. Do not replace production SurveyField with a static
image to pass screenshot review.

Required named scenes: `explore-discovery`, `explore-no-results`,
`explore-site-unavailable`, `explore-no-darkness`, `explore-offline-retained`,
`explore-snapshot-expired`, `explore-catalog-no-rig`, `framing-checked`,
`framing-survey-unavailable`, `framing-no-solution`, `framing-check-stale`,
`framing-preview-unavailable`, `framing-preview-expired`,
`framing-read-interrupted`, `framing-command-unconfirmed`,
`framing-centering-limit`, `capture-preparation`, `preparation-camera-changed`,
`preparation-cooling-unconfirmed`, and `preparation-start-handoff`.

Focused checks:

1. Catalog query validation, alias/type/filter pagination and no rig/adapter access;
   source minor-axis/constellation mapping and truthful absent values. Sky summary
   uses the same instant/site, with independent angular/coordinate checks if added.
2. Framing controller: same acquired samples feed solve/preview; unsolved image
   identity distinct from older actual; successful solve survives preview failure;
   bounded expiry; no publication after cancelled/new generation; unchanged
   tracking/slew/check/Stop/lease behavior and physical command counts.
3. Route tests: exact-image PNG IDs, proper not-found, no raw pixels/FITS in JSON,
   no extra acquisition on preview GET/retry; idle/failed framing still exposes
   valid preview identity appropriately.
4. Existing `targets.e2e.ts`, `target-discovery.e2e.ts`, `target-sky.e2e.ts`,
   `centering.e2e.ts`, `exposure-recovery.e2e.ts`: preserve search/filter/history,
   real survey pan/zoom/keyboard frame edits, check identity, centering outcomes,
   pending/uncertain/Stop/read-retry assertions while adapting source layout.
5. Preparation/cooling/imaging-camera browser cases: preserved drafts and image
   viewport across Appearance, exact target/camera handoff, save failure blocks
   start, explicit cooling remains independent, accepted start reaches Tonight,
   uncertain response does not navigate or replay.
6. Focused model/server/web tests and builds, lint; fresh independent OK before
   comparing actual light/dark routes at 1440×900/989 and compact widths. Preserve
   screenshot hashes/DOM bounds and flag source-content substitutions separately.

## Settled implementation decisions

The rig-less `/explore` route and narrow catalog endpoint provide the first-night
Explore entry. No-rig navigation exposes Explore; Home's explicit Explore action
uses the same route. Rig selection retains its settled Tonight destination.
Framing Continue opens `/observe?target=…`; an accepted Start opens Tonight.
Camera selection is a draft until an explicit selection save is confirmed;
Start remains unavailable while the choice differs from the saved camera. Use
the existing camera-selection control's explicit action where needed, and expose
that state without implying a drop-down change has configured hardware.

Framing images remain temporary, with no Saved badge or FITS-retention claim.
The preview projection may reuse existing linear-sample star statistics as a
separate fallible analysis, so the approved quality row can contain real values.
Analysis failure is unavailable, independent of successful solve or rendering.
No new exposure is taken for preview or statistics. No capability may relabel
an earlier capture as the framing test.

Implementation can use bounded parallel owners for server catalog/preview,
Explore/framing presentation, and shared inspection/preparation, with explicit
contract coordination. Finish this complete slice's tests and clean checkpoint,
obtain independent OK, then compare source layouts before starting Photos or
Equipment implementation. Their written plans can be prepared in advance.

## Actual outcomes

The implementation follows the planned route and capability boundaries:

- `TargetBrowser` shares card/filter presentation between rig discovery and the
  narrow catalog hook. Discovery requests three items and keeps snapshot/cache
  compatibility; `/explore` uses the catalog-only API without device reads.
  The catalog endpoint and small helpers live in `discovery-routes.ts`, avoiding
  a new route module for one closely related read.
- `FramingView.preview` retains a separate acquisition ID and nullable check ID.
  Solve, PNG rendering and star analysis consume the same acquired samples;
  independent failures remain independent. Three exact fit/native pairs are
  cached per controller. Cancellation is checked before publication, and raw
  samples are released after consumers settle. No FITS retention was added.
- `FramingExposure` supplies framing-specific identity and actions over the new
  shared `image-inspection` primitive. Capture retains its own Keep semantics.
  Exact resource tuples include renderer URLs, and enlargement preserves the
  inline owner's height, native pan and return focus.
- Preparation replaces `CaptureHub` and composes a single capture command hook.
  Camera selection requires explicit confirmed save. Only a confirmed Start
  response navigates to Tonight. Uncertain results remain available for explicit
  inspection; cooling commands remain separate. Connection details were retained
  in `RigReadiness`, and equipment presentation is shared with Tonight.
- A controlled accessible Switch was added and inspected in the workshop, with
  observed checked state, pending focus retention and a 44px target.

The production-route review registry supplies paired palettes and deterministic
scenes with local hashed photographs and DSS HiPS resources. Aladin renders the
actual survey tiles; no static image replaces the survey renderer. Unknown API
requests fail within the fixture. These are browser-fixture observations; no
physical-device validation was performed in this slice.

Deliberate source substitutions: temporary framing images say **Temporary**,
not Saved; unavailable catalog distances remain unavailable; current Moon
separation and azimuth come from the same observed instant. Altitude traces use
linear measured axes and calculated samples, with no invented obstruction line.
The Paper sky/frame illustration cannot prescribe real survey reprojection or
WCS geometry. The real catalog name “Great Hercules Cluster” wraps at the source’s 24/30
heading size, adding 30px to the shared card row compared with Paper’s shorter
“Hercules Cluster.” The source-sized card anatomy is otherwise retained.
Compact layouts stack the desktop regions because these routes
have no frozen full phone composition. Additional operational details remain
available through disclosure instead of being removed to match a quiet sample.

Settled project checks pass: 876 tests in 89 files plus model contract checks,
repository lint and all production builds. The Switch workshop checks pass
keyboard activation, source geometry and pending focus/observed-state retention.
Focused browser coverage includes catalog/preview contracts, existing framing
commands and retry guards, image identity and enlargement, camera save failures,
uncertain Start, independent cooling and paired layout states. The full 157-case browser regression run passed 152 checks and exposed four
displaced recovery-test selectors plus one real native-pan restoration defect.
All nine recovery checks pass after adapting selectors to the preparation
handoff and opening the actual framing disclosure before inspecting its history.
The shared viewer now remembers the desired image center separately from the
browser’s clamped layout position, updates only intentionally moved axes, and
restores that center on resize. The exact preparation regression passes after
waiting for dialog/scroll settlement; it previously could pass by closing before
the delayed scroll event. The final combined rerun passes all 28 affected checks: nine recovery, eight
image-inspection and eleven preparation tests. Final repository lint, web build
and whitespace checks pass. This establishes all 157 original browser cases
across the full run and affected rerun, plus the new axis-preservation regression;
it is not a claim that the original full run was failure-free.
Independent verdict and retained final browser comparison follow before this
slice can be accepted.

Independent review of `ec14cb4` returned **OK**, with 876 project tests, 52
focused web checks, nine workshop checks and four catalog Python checks passing.
The parent’s post-review comparison found and corrected the selected Explore
card’s source 2px border/226px image crop, framing’s in-field seconds suffix,
remaining 24-hour timestamps, and preparation’s Barlow 20/20 enlarge glyph
(Paper `LY-0`). The correction run passes 46 affected route checks; renewed
independent review and final paired comparison are required on the corrected head.

Paper’s Crescent asset metadata reports 1280×1224 and the same asset ID for
Explore and Preparation, matching local dimensions and centered cover/contain
recipes. Frozen Paper exports carry Display P3 ICC; browser PNGs do not.
Authenticated source bytes could not be retrieved, so exact remote/local byte
identity is not claimed. No higher-resolution source, CSS filter or opacity
change was found, and image pixels are not altered to compensate for raster or
profile differences.

Renewed review at `c4b67e1` returned **OK WITH NOTES**: all 158 browser checks
passed, but a manual edge-state reproduction found negative current altitude
being described as “above the horizon.” The summary now gives the absolute
angular distance with above/below wording; refreshing from +68° to −12° is
covered by a real-route regression without physical commands. All eleven
Explore/framing checks pass with the correction. The note remains pending fresh
independent disposition before visual acceptance.

The next review at `f8b3d81` confirmed the horizon correction and found a related
future-window issue: “Above 30° until” omitted the start of an upcoming window.
Future windows now say “Above 30° from … to …”, based on the frozen calculation
time; a window already in progress retains the source wording. The same
below-horizon refresh regression verifies both future boundaries. Renewed
independent disposition remains required before the final visual pass.

Review at `5710cf9` confirmed both sky-copy corrections, with 876 project tests
and 131 web browser checks passing. Its remaining P2 was a nested main landmark
on the new rigless Explore route. Both target-route wrappers now leave the main
landmark to Shell; rigged and rigless real-route checks assert a single landmark.

Final review of `8906518` returned **OK**, no findings. The parent then reran
all 22 Explore/framing/preparation route checks and inspected all thirteen
captured images against 03.1–03.3 and the paired Fieldroom palette. Eight DOM
geometry files and the unmodified PNGs are retained with hashes in
[acceptance evidence](visual-evidence/fieldroom/explore-preparation/README.md).
Native preview confirmed reachable routes, loaded fonts and preparation/framing
pixels at desktop and phone dimensions; its snapshot-export limitation remains
explicit. No further discrepancy required code changes. The planned slice is
accepted, with the factual source substitutions recorded beside its evidence.
Photographs may begin; whole-application acceptance remains Chris's final gate.
