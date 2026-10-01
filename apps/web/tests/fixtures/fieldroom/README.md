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
