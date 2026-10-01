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

Pending.
