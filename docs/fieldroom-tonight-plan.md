# Tonight and application Appearance

Planned before application edits, after the accepted `c7c5712` foundation.
This expands Phase 3 and its Phase 4 dependencies in
[the adoption plan](fieldroom-adoption.md). Visual authority is 03.0, 04,
03.10, 03.19–20 and the corresponding state/interaction regions in 03.9,
03.11, 03.14, 03.16–18. Shared recipes come from the accepted foundation.

## Routes and scope

Keep existing addresses and direct links. `/rigs/:rigId/observe/capture` becomes
Tonight. `/rigs/:rigId/observe` remains preparation and is adopted with the
preparation slice; its existing controls remain reachable. Explore and Photographs
retain their existing addresses. Navigation labels become Tonight, Explore the
sky, and Photographs. A selected rig opens Tonight, whose unavailable state has
a clear preparation path. Target/prepare pages remain usable throughout adoption.

This slice changes the actual application composition and its operational
presentation. It does not add durable observing sessions, run history, resumable
sequences, automatic slews, cooling automation, or invented safety policy.

## Concrete layout

At 1440 wide, the shell has 36px outside insets and 88px navigation. Tonight
starts 28px below navigation; its 888px image and 452px context columns have a
28px gap. The image card is 686px high in the reference scene: 54px toolbar,
560px fitted image area, and 70px metadata region, with the reference border
rounding documented separately. Preserve the photograph's aspect and pixels.
Use available width responsively; do not force a 900px page height or crop the
application to hide longer feedback.

The context column contains the subject (44px action row, 32/40 heading, 14/20
catalog facts, 10px group gaps, bottom divider), capture state (20/22px inset,
16px groups, exact active surface/progress colors), and sky context. The sky
region keeps the approved 46/56 altitude measurement beside a small altitude
trace, followed by supporting facts. The equipment footer begins 24px below the
main region, with a divider, 20px top inset, observed camera/focuser context and
the Equipment & settings link. Keep camera readiness and command failures
distinct from image-loading or artifact-saving failures.

On compact widths, preserve 46px text controls and 44px icon targets, place image
and capture state in a usable reading order, and allow metadata/action rows to
wrap without overlap. The dedicated near-rig alignment header is a later slice;
do not claim the generic compact navigation is its final design.

## Actual state and ownership

- `useCapture` remains the command/polling owner. Tonight composes its confirmed
  projection; it does not create a second capture state machine. Preserve Start,
  single exposure, repeat, Save frames, Stop, uncertain-command inspection,
  camera-read retry and server-restart interruption behavior. Preparation and
  cooling remain reachable without overloading the active-run card.
- Add subject intent and true per-run saved/integration totals exactly as planned
  in [capability additions](fieldroom-capture-capabilities-plan.md). Resolve a
  requested target before hardware acquisition. No target means explicit absent
  intent. A newer target choice cannot relabel an existing run or image.
- Carry a chosen target through an explicit capture URL parameter/handoff.
  The active server snapshot takes precedence during a run; a pending next-run
  choice remains separate. Do not infer subject from telescope coordinates.
- Reuse the rig-detail read projection for actual equipment and connection
  context. Keep any shared rig observation at an explicit shell boundary, scoped
  by rig identity, so navigation and Tonight can consume one observation rather
  than separate polling loops. Existing connection preparation keeps its own
  command outcome. A disconnected/unavailable device is not silently presented
  as connected merely because the Vela server answered navigation.
- Subject sky data uses the existing target projection and timestamps. Draw the
  small altitude trace from those samples; preserve the existing detailed sky
  inspection through Open sky view. Show calculation age/unavailability honestly.
  The reference's jagged obstruction line is not real local-horizon data and
  must not be copied into operational geometry. Mount tracking comes only from
  an observed telescope status.
- Retain the pinned catalog's constellation fact. Show Distance unavailable
  where Paper illustrated a distance; no live enrichment or fabricated value.

## Image inspection

`LatestImage.tsx` and its existing loading/retention boundary own displayed
identity, Fit/native mode, holding, enlargement, panning and exact-image Keep.
Implement the invariants in the capability plan. Fit follows new images until
inspection holds a frame. Show latest returns to Fit and the latest identity.
Native loads keep fitted pixels visible and never pair them with another
image's metadata. Enlargement keeps the same frame, scale and pan, with focus
return. An expired unsaved frame keeps its already loaded pixels and reports
which operations are unavailable. GET retry is an explicit same-resource read;
an uncertain physical command is never replayed.

Move the existing image header/footer to the approved toolbar and two-row
metadata layout. Saved confirmation and Keep refer to the visible image. Keep
dimensions and additional acquisition facts available through progressive detail,
without restoring the displaced table-heavy normal layout. The same component
continues to support saved-image detail; its full collection composition is a
later slice.

## Application theme and Appearance

Implement [the application appearance plan](fieldroom-appearance-plan.md):
validated `VITE_THEME`, Fieldroom default, named legacy token reference, browser
System/Light/Dark resolution before first render, persistence failure, media
updates, root color-scheme and theme-color. Configuration and browser storage
remain under `apps/web`. Shell consumes these values and the shared controlled
Appearance component. A palette change must not remount routes or reset image
inspection, forms, search, or operational subscriptions.

## Ownership for parallel work

All owners share the tree and preserve one another's edits. Agree contract names
before consumers land; do not edit another owner's CSS or test fixtures silently.

| Owner | Files and responsibility |
| --- | --- |
| Capture contracts | Model capture/target projections; server capture/controller/routes/composition; saved metadata; pinned catalog constellation; capture/target browser validation and capture-start hook signature; owning tests/READMEs |
| Application presentation state | Web configuration/appearance modules and tests, `main.tsx`, Shell, AppNavigation, root styles/index.html/env example; narrow shared rig-observation composition if needed |
| Image inspection | `LatestImage.tsx`, `latest-image.css`, narrowly extracted image helpers and focused image behavior tests; preserve other consumers |
| Parent | Tonight route/composition and its CSS, subject/sky/footer composition, deterministic review scenes/runtime, integration tests, evidence, independent verification and acceptance |

## Deterministic review runtime

Use production routes/components with a development-only fixture HTTP boundary,
not a production mock mode. Keep a named scene registry under web test fixtures;
use it from automated route tests and a small standalone review server under
`scripts/`. It may compose Vite middleware and serve scripted API responses,
known local reference-image bytes, and a fixed browser clock through its own
development HTML transform. Production builds and live API behavior do not
import the review server or fixture clock.

The registry names scene, route, fixed time/timezone, image hash, theme preference,
and ordered responses. Unknown fixture API requests fail explicitly. Its separate
review index chooses a scene and opens the real route. This gives the native
collaborative browser a reachable deterministic app without relying on test-only
request interception. Sample imagery remains visibly identified as review data
through supplied fixture metadata. Live operational state uses the same component
composition with real projections.

## Verification and acceptance

1. Focused contract/controller tests establish subject validation before physical
   commands, run/image identity, publication totals, idempotent Keep, old-run
   Keep, Stop/save races and legacy metadata validity. Preserve existing ambiguous
   command and cleanup tests.
2. Appearance tests cover configuration, initial resolution, blocked/malformed
   storage, media changes, explicit override, listener cleanup and honest
   visit-only feedback. Route checks cover no image/form/route reset.
3. Real-route browser tests exercise start/pending/publish/repeat, Stop and
   uncertain Stop, browser interruption versus camera-read interruption, failed
   save versus failed preview, held/native/enlarged image transitions and expiry.
   Use existing scenarios and extend them where new transitions need proof.
4. Run scoped model/server/web tests and builds, affected browser suites and lint.
   Fix old tests only where their presentation assumptions have intentionally
   changed; preserve their operational assertions.
5. Settle and commit the target; obtain independent **OK** on the clean head.
6. Compare the real review runtime to light/dark Tonight and Appearance at
   1440×900, interruption at1440×965, and useful compact widths. Inspect exact
   fonts, geometry, wrapping, image framing, state regions, focus and motion.
   Record truthful content substitutions and sampled-sky geometry separately
   from pixel/layout discrepancies. Fix and reverify before acceptance.
7. Record actual files, tests, screenshots/measurements, verdict and deviations
   in the adoption log. No later application slice begins before this gate.

## Actual outcome

Implemented; the clean-commit independent review and final comparison gate remain
pending. The current capture route is Tonight, with the chosen subject, actual
per-run published integration/saved totals, sampled sky projection, and shared
observed equipment. `targets.tsx` carries the selected target through its existing
Continue link. The capture controller snapshots intent before acquisition; an
old image's Keep completion cannot increment a newer run's totals.

Application configuration selects Fieldroom by default. Browser appearance is
resolved before the first route DOM, follows System changes unless overridden,
and reports persistence failure without resetting the route. Rig observation is
composed once per rig under Shell; RigDetail and Tonight consume it. Navigation
retains capture activity on other pages/rigs; Tonight omits its duplicate activity
chip because the full state is already in the page.

`LatestImage` supplies held/native/enlarged inspection, exact-image retry/Keep,
expiry feedback, and focus/pan preservation. Its existing other consumers remain
available until their scheduled adoption. The reference-fit photograph retains
all its actual pixels and aspect ratio. A 44px details button in the toolbar
exposes image dimensions, start provenance, subject intent, and display facts;
this is the small additional affordance needed for existing acquisition details.
The normal two-row metadata composition stays 70px high.

Cooling remains an explicit operation. Its footer text action expands the existing
controls below the footer, using the reference's right-side supporting area.
This avoids adding a permanently visible row that caused a native desktop
scrollbar and reduced the specified image/column widths. Normal desktop content
fits 1440×900; expanded forms and feedback may extend the page naturally.

The standalone development server is `scripts/review-fieldroom.mts` (`.mts` is
required because the repository root is not an ESM package). It and the route
browser tests share `tests/fixtures/fieldroom/tonight.ts`. The registry verifies
reference-image hashes, scopes command state per review session, rejects unknown
API requests, and fixes the date while letting timers execute. Its README records
scene response order and timezone. This is deterministic fixture evidence, not
physical-device evidence.

Preliminary browser measurements: DPR1 card 888×686; toolbar54, fitted image560,
metadata70; active card452×214. Native DPR1.5 uses the same declared geometry but
quantizes 1px borders to 2/3px (image outer height685.75 from responsive image
sizing). Native viewport width is1440 with no page scrollbar in the normal state.
Final measurements/screenshots after independent review will replace this
preliminary status in the adoption log.

Focused checks include 93 capture/model/catalog/target tests; six config/appearance
unit tests; image transitions; theme geometry; appearance/navigation; and Tonight
subject, totals, compact reflow, and failure separation. Full browser coverage is
being settled after deliberate presentation expectation changes. Build/lint and
final exact counts are recorded at the review checkpoint.

### Interrupted-view correction before review

The preliminary implementation retained the previous top-of-page warning banner.
Direct comparison with 03.10 showed that this moved the image and subject away
from their approved positions. Replace the active capture card in-place with the
24px-inset warning card: caption16, section title30, body24, detail20, 16px groups,
and a46px reconnect/details action row. Keep read-only last-confirmed facts and
paced automatic reconnection; no disabled command substitutes for confirmed state.
The image changes to Last received exposure plus its real receipt age. Source
03.10 keeps the686px outer card while using536px pixels,24px caption,70px facts.
Implement this explicit state recipe and test that loss does not shift the image
origin or issue a command. Connection age is a local browser observation, never
fabricated from the sample's illustrative48s caption.

### Settled verification checkpoint

The full web run exercised127 scenarios. Its ten stale presentation expectations
were corrected; affected suites then passed, including the two navigation
expectations changed by removing Tonight's duplicate activity chip. Subsequent
interruption and overlay corrections were rechecked with the affected capture,
recovery, sky, cooling, Tonight, and six image-inspection scenarios. All existing
127 cases and three added image cases have passed across these runs; this is not
a claim that every case was rerun after every local typography change.

Final focused unit/controller selection:61 passed (capture/controller/routes,
saved metadata/catalog/capture validation, config/appearance). Earlier scoped
model/target checks contributed34 target tests and4 model runtime checks, plus
model typechecking. Model/server/web builds and repository lint passed; the
existing Aladin bundle-size advisory remains. No hardware was operated.

The review runtime also forces its own `/api` and Fieldroom config, so an existing
local VITE_API_URL cannot bypass its fixture HTTP boundary. Captures remain
mock/illustrative and visibly identified. Runtime starting instructions are in
`apps/web/tests/fixtures/fieldroom/README.md`.

### Independent review and final-comparison corrections

Independent review at `a4905c0` returned BLOCK for two state bugs. The corrected
`2d4395d` checkpoint received OK: the footer consumes selected-camera capture
cooling, and current direction uses server-calculated azimuth at `observedAt`,
not a potentially future night sample. The reviewer ran the full project check
(865 tests and workspace builds), 57 browser tests and four Python tests. These
are fixture checks; no hardware was operated.

The subsequent whole-route comparison found presentation corrections: image
facts use the source's muted color and three-space Star size separator. The
connection dot has an explicit 10px circle, avoiding OS fallback-glyph sizing.
Appearance follows its source anchor gap (desktop 10px, compact 2px), while
retaining viewport-fit behavior. Tonight's four theme/width checks now capture
the open panel and assert decoded-image identity, source URL, unchanged image
bounds and focus return across a palette change. Wait for the actual entrance
animation before interacting: an immediate Playwright `.check()` during that
animation caused a pre-pointer scroll; waiting preserves the exact scroll/bounds
assertions without changing production focus behavior.

The affected application suites passed 20 checks; the shared Appearance suite
passed five. UI/web builds and lint passed. These corrections require a renewed
independent review and then a final comparison of the settled revision before
this slice is accepted. The written Explore/framing and Photographs plans do
not begin their implementations.

Renewed review at `80d9dd7` returned **OK**, with 865 project tests, lint,
workspace builds, 20 application browser checks, seven workshop checks and four
Python tests passing. The parent then inspected both palettes at desktop/phone,
the paired Appearance panels, and interrupted Tonight against the frozen source.
The remaining capture-status bullet used a platform fallback glyph smaller than
Paper's rendered 10px circle. It now uses a decorative 10px circle with the source
text gap, preserving the accessible Capturing status. Ten affected Tonight browser
checks and lint passed after this correction. A final independent check and
comparison remain required before acceptance.

Final review of `032c8b1` returned **OK** with no findings. Full project checks
(865 tests, lint and builds), 48 app browser checks, seven workshop checks and
four Python tests passed. The parent then completed the final paired comparison
and native DOM inspection. [Acceptance evidence](visual-evidence/fieldroom/tonight/README.md)
retains the nine screenshots and source-aware deviations. This slice is accepted.
