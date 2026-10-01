# Fieldroom route review fixtures

`tonight.ts` owns named, deterministic responses shared by `tonight.e2e.ts` and
the standalone development review server. These are actual application routes
with a fixture HTTP boundary; no fixture code enters the production app.

From the repository root:

```sh
pnpm --filter @vela/server exec tsx ../../scripts/review-fieldroom.mts
```

Open `http://127.0.0.1:5176/__review`, then choose a scene. Selection creates a
fresh browser-cookie session. It seeds the scene's appearance once, so later
appearance changes and reloads can be inspected without resetting preference.
The script fixes the browser date to `2026-09-30T01:43:44.000Z` while normal timers
continue. The reference timezone is America/New_York (21:43:44); Playwright pins
it explicitly and the local collaborative browser uses that system timezone.

Every API request is handled locally, including explicit failures for unmapped
requests. No API fallback reaches the observatory. Selecting a scene again resets
its response counters and command state. The interruption scene returns two
initial capture snapshots (allowing development StrictMode's cancelled initial
read) and then 503. Camera-read interruption, preview failure, and save failure
are separate scenes. Start/Stop mutate only that review session.

The Crescent photograph is the same pinned, credited asset in the immutable
Paper reference manifest. Startup checks its SHA-256. Its actual 1280×1224 pixels
and dimensions are preserved. Camera metadata identifies it as a reference/mock
exposure. Sky samples and rig telemetry are illustrative test data; the UI uses
the same contracts and projections as live operation. Distance is unavailable,
and the altitude trace has no invented local-horizon silhouette.

The initial scene names map to the coverage plan as follows:

| Scene | Reference |
| --- | --- |
| `tonight-light` | 03.0 capturing |
| `tonight-dark` | 04 dark capturing |
| `tonight-interrupted` | 03.10 connection interrupted |
| `tonight-idle` | Ready/start state, using the shared form recipe |
| `tonight-camera-retry` | Camera observation interruption |
| `tonight-save-failed` | Capture stopped after save failure |
| `tonight-preview-failed` | Capture continues while display bytes are unavailable |

Appearance is opened through its actual navigation control. Image held/native,
expiry, pending Keep, and new-image arrival transitions are exercised through the
focused `image-inspection.e2e.ts` scenarios. Their test responses remain scoped
to those transitions instead of adding a general fixture scripting engine.

## Explore, framing and preparation

`scenes.ts` is the small registry used by the same review server. `explore.ts`
adds real-route catalog, framing and preparation scenes. Requests include their
query strings, so search, filter and page-size behavior reaches the fixture
boundary. `ReviewResponse.resource` selects only an exact entry in `resources.ts`;
there is no arbitrary filesystem lookup. Unknown API routes return failures and
never fall through to Vite's development proxy or an observatory adapter.

Explore uses the pinned Crescent, Andromeda and M13 photographs already owned by
`packages/ui/src/drafts/target-framing`. Rigless Explore sends no rig reads and
omits every sky/site/opportunity field. Named scenes include missing site,
no astronomical darkness, empty results, unavailable reference images, expired
snapshot and interrupted reads. Fixture coordinates and sky samples are illustrative
contract data; they do not estimate a site from the browser or host.

Framing uses production Aladin and its real projection/footprint interaction.
`survey-manifest.json` pins the exact DSS2 HiPS resources needed by the desktop
and compact Crescent scenes. Nine resources came from the existing Vela survey
cache; five missing compact-view order-3 tiles were downloaded individually from
the same fixed CDS survey on 2026-10-01. They retain exact JPEG bytes and source
URLs, with SHA-256 verified by both the development server and browser tests.
The retained `survey/properties` carries STScI/NASA image copyright and CDS credit.
Survey metadata is ODbL-1.0; see the retained source properties and the application's
survey attribution. No gray synthetic tile replaces the actual sky, and no network
fallback supplies missing review tiles. Aladin's optional `Moc.fits` probe returns
404, consistent with production's supported-path boundary; it is not an image tile.
Panning beyond the pinned region can leave high-resolution tiles unavailable.

The framing-preview resource serves the unchanged source Crescent photograph with
its real 1280×1224 dimensions and JPEG MIME type under a mocked acquisition URL.
It is explicitly labeled as a reference/mock exposure, never represented as newly
captured hardware data. Framing exposes separate solved, newer-unsolved, obsolete,
read-retrying, centering, interrupted and preview-unavailable scenes. The unsolved
scene retains the older footprint but supplies the newer acquisition's own image
and null solved-check ID.

Preparation scenes start with no active capture. The remembered imaging camera
has a second available choice; changing the selection alone sends no command.
Camera save, capture Start and cooling mutate only that session. Failed save,
uncertain Start and uncertain cooling have distinct scenes; state-inspection GETs
do not replay writes. The normal preparation scene's 10-second exposure,
21:06:18 timestamp, 842 stars / 2.1px HFR and −8.6°C / −10°C / 62% cooling are
explicit illustrative source fixtures. The old check is marked non-current,
while the preview keeps its exact acquisition association and Temporary status.
No saved framing artifact is claimed. `preparation-unframed` exercises absent
preview state rather than copying the latest capture into that region.

`fieldroom-explore.e2e.ts` and `preparation.e2e.ts` exercise real route behavior at
1440px and 390px in both palettes. Captures await font loading, decoded images and
finite control animations; Aladin captures additionally wait for exact tile
requests, the real solved footprint and completed rendering frames. They emit
`/tmp/vela-{explore,framing,preparation}-{light,dark}-{1440,390}.png`; framing also
records the requested resource list beside each PNG. Preparation tests cover
unsaved-camera Start blocking, failed save, exact subject handoff on accepted
Start, no navigation/replay after an uncertain Start, independent cooling,
Appearance draft/pixel preservation and Fit/native pan/enlargement return focus.

## Photographs

`photographs.ts` adds the existing saved collection/detail routes to the same
registry. `photographs-light` / `photographs-dark` begin at the collection URL
with 12 newest-first entries. The latest six source times are 21:39:08, 21:36:02,
21:32:56, 21:29:50, 21:26:44 and 21:23:38; the other six continue that illustrative
186-second cadence. The clock is `2026-10-01T01:43:44Z`, so America/New_York shows
30 September, as in 03.4. All exposures use the unchanged pinned 1280×1224
Crescent JPEG, 180 seconds, Color, and illustrative 842 stars / 2.1px HFR. Camera
metadata says `Reference image · Mock saved exposure` rather than claiming a
physical camera acquired this fixture.

Other names use the `photographs-` prefix:

- `legacy`: collection metadata starts on original URLs. Only a selected detail
  read publishes that image's current `background-v1` URLs; collection reads
  never refresh the other entries.
- `fallback`: display refresh is unavailable; original preview, PNG and FITS
  resources remain independently available.
- `empty`, `selected-missing`, `collection-failed`, `detail-failed`: distinct
  collection/detail states. Collection failure also makes shell rig telemetry
  unavailable while its explicit selected detail still succeeds.
- `preparing`: the selected detail response takes eight seconds, independently
  of collection reads and shell telemetry.
- `fit-failed`, `native-failed`, `native-missing`: exact preview reads fail with
  503 or 404 without removing saved metadata or original FITS.
- `rig-switch`: a second rig has an empty collection, so navigation can prove
  it does not carry a foreign image ID or native inspection into another rig.
- `many-dates`, `older-link`: 24 entries across four local dates. The older deep
  link names the twentieth newest item (`review-saved-5`), beyond the first six.

`openPhotographsScene` in `browser.ts` returns `{ scene, requests }`. A scene
provides `images()` snapshots, `selectedId`, `detailReads`, `fileReads` and
`unknownRequests`. Focused race/retry tests can use `setDetailDelay(id, ms)`,
`setDetailFailure(id, statusOrNull)`, `setPreviewFailure(id, 'fit' | 'native',
statusOrNull)`, `setCollectionFailure(boolean)` and `setRendering(id, status)`.
Response payloads are captured before their optional delay, allowing an older
response to arrive after a new selection. Both the browser helper and standalone
HTTP runtime honor the same bounded `delayMs` contract (0–60000ms). There is no
scheduled capture, per-thumbnail detail call or background archive conversion.
Unknown methods, artifact IDs, versions and resources return explicit failures.

`photographs-synthetic.fits` is a deterministic **synthetic download fixture**,
not the reference photograph's original scientific data. It has a valid primary
FITS header (`BITPIX=16`, `NAXIS1=1280`, `NAXIS2=1224`, `BAYERPAT='RGGB'`), zero
sample data and 2880-byte padding. Its OBJECT/COMMENT cards identify synthetic
review data. `resources.ts` pins its SHA-256 and serves only the explicit
`photographs-fits` discriminator as `application/fits`. Original FITS URLs remain
unchanged when an image's preview renderer changes; JPEG preview bytes stay the
same pinned reference photograph in both renderer versions. These scenes prove
resource identity and download behavior, not physical acquisition or image
processing correctness.

## Equipment, Home and onboarding

`equipment.ts` supplies 36 deterministic real-route Equipment/Home scenes using
production rig, observation, imaging-camera, framing and discovery contracts.
`equipment-connected` and `equipment-dark` reproduce the source's four-device
inventory: selected ZWO ASI2600MC Pro, ASI Mount, ZWO Focuser and disconnected
ZWO ASI220MM Mini. Three of four are connected; the second camera has no invented
guide role and the mount has no fabricated pier-side reading. The illustrative
camera temperature/power and focuser position are fixture data, not live telemetry.

The `equipment-` names separate camera disconnection, all-kind detail inventory,
interrupted reads, initial failure, missing rig, offline inventory, empty inventory,
connection complete/partial/rejected/unconfirmed outcomes and setup save outcomes.
All-kind details include unknown focuser activity, partial conditions, generic
switch channels with unitless values and every unsupported device kind. The read
interruption starts after two detail reads, allowing development StrictMode's
cancelled first read; `setDetailFailure(null)` explicitly restores successful reads.

`home-no-rigs` / `home-no-rigs-dark` start at the intentional first-night rest
state; `home-rigs` / `home-rigs-dark` include reachable, offline and unknown rigs.
The `rig-` scenes start at Home (Forget scenes at Equipment). Open Add a rig and
choose the real scan/address flow before review; these fixtures do not synthesize
modal state or automatically click controls. `rig-address-validation-phone` is
captured at 390×782 after entering `http://192.168.4.104`; client validation should
block inspection. `rig-address-unreachable` retains the normal host and port.
`rig-dialog-submission` holds Add for 2.5 seconds, and
`equipment-connect-outcomes` holds Connect for two seconds.

Scenes expose `snapshot()`, `unknownRequests`, `writes`, `detailReads`, `homeReads`
and narrow controls: `setDetailFailure(statusOrNull)`, `setHomeFailure(statusOrNull)`,
`setRig(view)`, `setCamera(view)`, `setDiscovery(result)`,
`setConnectionOutcome('complete' | 'partial' | 'rejected' | 'unconfirmed')`,
`setWriteOutcome('camera' | 'focal' | 'add' | 'forget', outcome)` and
`setDelay(operation, milliseconds)`. Write outcomes are `confirmed`, `rejected`
and `unconfirmed`. Delays are bounded to 60 seconds. The `writes` ledger includes
POST discovery inspections as requests; discovery has no device side effect.

Unconfirmed write scenes apply the state change but lose its response. An explicit
GET can observe camera/focal/connection/Forget state without replay. After Add,
manual discovery reports the candidate as `already-added` with the saved rig ID;
a rejected Add leaves it `new`. `rig-add-refresh-failed` confirms Add before failing
Home reads, preserving the distinction between a successful write and failed
catalog refresh. Each session owns its mutable state. Unknown requests fail with
501 and never fall through to an observatory endpoint.

`equipment-fixtures.e2e.ts` validates every initial snapshot through production
projection guards and checks connection result contracts, separate settings
outcomes, ambiguous Add/Forget inspection, and blocked unknown routes. These are
fixture-boundary checks; rendered behavior and visual comparisons remain the
responsibility of the real-route browser scenarios.

## Polar alignment and autofocus

`alignment.ts` and `autofocus.ts` provide scene constructors for the existing
`/rigs/fra400/observe/alignment` and `/rigs/fra400/observe/autofocus` routes.
Their exported scene-name arrays are the registry integration points. Both expose
`respond(method, pathname, body)`, `snapshot()`, `setView(fullProjection)`,
`setReadFailure(statusOrNull)`, `setCommandOutcome(command, outcome)`,
`setDelay(milliseconds)`, `reads`, `writes`, and `unknownRequests`.
Snapshots and response payloads are cloned, so test mutations and delayed older
responses cannot change the session's newer state. Delay is bounded to 60 seconds.
There are no automatic timers advancing samples or moving devices: transition
checks explicitly publish the next complete projection through `setView`.

Every request is handled locally. Each constructor allows only its exact feature
GET/command paths, navigation, and the selected rig/observation shell reads.
Unknown methods, foreign rig IDs and undeclared resource URLs return 501 and are
recorded. Shell facts reuse the Equipment contract fixture; navigation advertises
no concurrent capture. Offline scenes provide two initial feature responses, then
503, allowing StrictMode's initial cancelled read while establishing retained
state. `setReadFailure(null)` ends that interruption. The shell remains reachable:
these scenes prove interrupted feature polling, not loss of every server endpoint.

Command outcomes are `confirmed`, `rejected`, `pending`, `unconfirmed`, and
`unconfirmed-active`. Pending Stop stays active/stopping until explicitly advanced.
`unconfirmed` applies the completed change but loses its response; a GET can resolve
it. `unconfirmed-active` loses the response while Stop remains unresolved and
active. The named Stop-unconfirmed scenes use this latter outcome. Repeated GETs
must not be mistaken for restored/stopped confirmation or cause another POST.
Publish a terminal state explicitly to test eventual resolution. Neither Stop
variant fabricates a new exposure or autofocus sample.

Alignment names cover the four frozen phone/Appearance references, setup,
unavailable/loading, baseline homing/moving/exposing/solving, unsolved baseline,
offline retained solve, image failure, Stop pending/unknown, stopped/finished,
and enlarged baseline. `alignment-enlarged-baseline` starts with an unsolved
preview; after opening enlargement, publish `alignmentAdjusting` with `setView`
to exercise retained inspection across baseline completion. New preview and
measurement URLs declared by `setView` are registered to the same static bytes;
previous declared URLs remain available to a pinned viewer. This finite test
script registry is not a production image-retention policy.

The exported `alignmentResource` descriptor is the exact resource to register
with the shared HTTP/browser resource handler:

- Discriminator: `alignment-star-field`; MIME: `image/png`.
- Source: `packages/ui/src/components/fixtures/capture-star-field.png`.
- Native size: 1600×1200; SHA-256:
  `32fc1935092d3d98768c18e21c94829f6134262524cd302133bbf1f269099f4c`.
- Provenance: the existing [workshop image README](../../../../../packages/ui/src/components/fixtures/README.md)
  records a two-second local simulator exposure on 2026-09-05, generated from
  the locally provisioned D05 catalog and stretched by Vela. No physical rig was
  used. This is not a survey tile, a newly acquired image, or a measured solution
  for the review timestamp.

Alignment API metadata identifies the image as review/simulator data. The
01:02:14Z exposure timestamp is a declared **server-estimated review timestamp**,
not the PNG's historical acquisition time. North-up projected target coordinates
are illustrative contract values: native optical center (800,600), target
(807.6667,590), one-degree field height, azimuth −23″ and altitude −30″. The
production contract exposes projected coordinates, not a full WCS; fixtures do
not claim a measured WCS for these pixels. Existing viewport mathematics must
consume those values without replacing them with Paper's decorative coordinates.
The image dimensions, measurement timestamp and coordinates travel together.
The standard clock is `2026-10-01T01:02:16Z` (two-second age); the read-interrupted
clock is `2026-10-01T01:02:59Z` (45-second age). Both use America/New_York.
`setImageFailure(url, statusOrNull)` affects only that exact image GET, allowing a
new-image failure while the earlier loaded image stays valid, then explicit retry
without an acquisition command.

`appearance-phone-light` and `appearance-phone-dark` seed `appearance: system`
and declare `colorScheme: light | dark` independently. The browser helper must
emulate that media preference before navigation and open the real Appearance
control through an interaction. It must not replace System with an explicit mode.
Normal alignment/autofocus scenes begin in light and can exercise the real
appearance control to inspect dark without resetting fixture state.

Autofocus names use the adoption-plan names: ready, running, phone-running,
interrupted, result, restored, invalid-window, restore-unconfirmed and offline;
additional scenes cover moving/measuring/fitting/confirming, no stars, Stop
pending/restoring/unknown. They provide complete valid `AutofocusView` values,
not design JSON masquerading as an API response. Start is 32,842; the first five
source sample pairs are retained exactly; current position 32,792 is separate
from the last measured point 32,842. Last sample time is 21:03:10 local. The
walking clock is `2026-10-01T01:03:12Z`; result/fitting/confirmation clocks are
01:03:34Z, after the ninth sample. These timestamps, star counts, later samples
and fit parameters are explicit synthetic fixture facts. The fit's command
position 32,788 differs from the lowest measured position 32,792. No image
resource is needed for autofocus, and no hypothetical fit is supplied while
walking. The invalid window at current position 150 rejects Start. Confirmed
restoration alone sets `restoredStart`; the failed-restore scene keeps it false
and preserves the last known position and samples.

The two adjacent `.test.ts` files check resource hash/native dimensions,
measurement ages and image associations, frozen autofocus values, production
autofocus validation, valid-window Start, no read-driven advancement, restoration
and lost-response semantics, isolation/delays, and strict unknown request tracking.
These checks establish fixture integrity. They do not establish rendered parity,
physical alignment accuracy, or actual EAF restoration.
