# Fieldroom Autofocus reference

## Plan — before drawing

Fill the missing Fieldroom reference for the existing one-shot autofocus
capability. This work creates new Paper boards only; existing approved boards
and production code remain unchanged.

Authority: [Fieldroom adoption](../../fieldroom-adoption.md), the finalized
Paper system, and the current [browser presentation contract](../../../../apps/web/src/features/autofocus/README.md)
and [server contract](../../../../apps/server/src/autofocus/README.md).
The current route and hook were inspected before planning this reference.

### Proposed boards

- **03.23 / Autofocus — setup:** 1440 × 900, light. Existing application
  navigation, a clear current-position/window illustration, device facts,
  editable Step size, and Start autofocus. Exposure is an observed 2-second
  setting, not a newly invented exposure control. Current position 32,842,
  step 50, four offsets, window 32,642–33,042, MaxStep 60,000.
- **03.24 / Autofocus — walking:** 1440 × 900, light. An 888px curve panel
  beside a 452px status/readout panel. Five measured samples, current position
  32,792, and an exposure in progress. No hyperbola or fitted minimum appears
  before the server supplies a fit. Stop and restore start stays prominent.
- **03.25 / Autofocus — phone walking:** 390 × 844, dark, with the existing
  62px mock status bar. A compact chart, current activity, retained latest
  sample, and Stop fit in the phone viewport. This is useful beside the rig
  when monitoring a run; it does not add a separate phone workflow.
- **03.26 / Autofocus — outcomes:** a desktop component-state sheet covering
  camera-read retry, confirmed completion, confirmed restoration, travel-limit
  rejection, and unconfirmed restoration. These are existing projections, not
  new application routes or controls.

New boards occupy the unused y=7700 row. Use the existing 36/888/28/452/36
desktop grid; Barlow body/control/support roles and Space Grotesk headings and
metrics; 46px text controls, 44px links/icons, 4/6/8px corner roles, and the
finalized light/dark semantic palette. Reuse the navigation anatomy and
Appearance glyph. Phone uses 20px content insets. No photograph is needed:
the current capability publishes a curve and measurements, not a focus image.

### Supported behavior to preserve

- The server owns the walk, positions, samples, fit, and restoration outcome.
  Start uses the existing step-size input and supplied exposure duration.
- Start is unavailable if the symmetric window cannot fit strictly between
  0 and MaxStep, the capability is unavailable, a command is pending, or the
  browser is disconnected. Show the concrete reason. No backlash setting,
  home command, automatic capture continuation, or focus schedule is added.
- Read retry retains the curve, sample identity, and last sample timestamp.
  Remove the current-position live annotation and activity spinner while
  measurements are interrupted; Stop remains available if the server can be
  reached. Offline and uncertain-command feedback take precedence.
- Stop requests camera cleanup and restoration. A pending request or move is
  not a successful restore. Never show a fitted minimum until supplied, and
  distinguish fitted focus from the lowest measured sample.
- Confirmed completion offers Focus again. Confirmed stop offers Back to
  setup. Failed restoration retains samples and clearly states that the start
  was not confirmed; Back to setup remains subject to the existing enabled
  projection. No command is blindly repeated.
- Existing loading, moving, measuring, fitting, confirming, unavailable,
  offline, and pending states reuse these regions with honest supplied copy.
  The reference adds no new timing estimate or invented progress percentage.

### Checks and handoff

Inspect every new board at native size; verify geometry, typography, chart
labels, exact button targets, and visible Stop on phone. Reconcile all sample
numbers and labels with a deterministic supported AutofocusView. Export PNGs
at 1x with source IDs, dimensions, timestamps, and SHA-256 hashes. Keep these
new artifacts separate from the existing immutable export manifest until the
parent integrates them. Independent fresh-context verification remains a later
slice gate; these drawings do not establish production implementation evidence.

## Actual result

Four new boards were created on the unused y=7700 row and exported at 1x.
The original approved boards and original export manifest were not edited.

| Board | Paper node | Export | Dimensions |
| --- | --- | --- | --- |
| Setup | `48X-0` | [03-23.png](app/03-23.png) | 1440 × 900 |
| Walking | `48Y-0` | [03-24.png](app/03-24.png) | 1440 × 900 |
| Phone walking | `48Z-0` | [03-25.png](app/03-25.png) | 390 × 844 |
| Outcomes | `490-0` | [03-26.png](app/03-26.png) | 1440 × 1100 |

The outcome sheet includes the five planned states plus browser connection
loss, applying the existing offline precedence described above. It is a
component-state reference, not a full application screen. The phone export
contains a 62px mock OS status bar; its app comparison crop is 390 × 782.

[The supplement manifest](autofocus-manifest.json) records source IDs,
dimensions, crop, export time and hashes. [The design values](autofocus-reference-fixtures.json)
record the exact sample data and outcome numbers; these are designed examples,
not observations of the rig and not a runnable API fixture. Application parity
fixtures must project these values through the actual contracts.

All four exported PNGs were inspected visually at native size. Text fits,
measured points match the values, the walking view has no premature fit, and
the 46px Stop control remains fully visible on phone. The retry, offline and
restoration cards distinguish retained observations from confirmed outcomes.
This establishes design/export QA only; independent verification and production
browser comparison remain subsequent adoption gates.

Parent visual review clarified the walking chart annotation: the dashed line
is labeled **Start 32,842**, matching the legend and its x coordinate. The
current position remains **32,792** in the activity panel. The corrected
03.24 export was inspected again and its supplement hash refreshed.
