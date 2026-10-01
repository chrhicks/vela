# Equipment, Home, and rig onboarding

Status: plan only. No application implementation is authorized by this document
before the Tonight/Appearance slice completes its gate in
[Fieldroom adoption](fieldroom-adoption.md). This plan was prepared against the
accepted `c7c5712` foundations and the in-progress Phase 3 shell. It does not
claim implementation, browser equivalence, or independent verification.

## Scope and visual authority

Adopt the existing Equipment route, Home catalog, discovery/review/address
flows, and Forget confirmation. Preserve the working endpoints, device
inspection, remembered imaging camera, focal-length configuration, preparation,
and every currently represented device kind. Discovery and adding a rig do not
connect equipment. Viewing Equipment does not issue device commands.

The frozen sources are [03.5 Equipment](visual-reference/fieldroom/app/03-5.png),
[03.8 First night](visual-reference/fieldroom/app/03-8.png),
[03.12 discovery review](visual-reference/fieldroom/app/03-12.png), and
[03.15 phone address validation](visual-reference/fieldroom/app/03-15.png).
[03.13](visual-reference/fieldroom/app/03-13.png) supplies unreachable-address,
empty-discovery, and Forget treatments; [03.14](visual-reference/fieldroom/app/03-14.png)
supplies the disconnected-camera region; [03.18](visual-reference/fieldroom/app/03-18.png)
supplies focus, submission, and reduced-motion behavior. The empty/pending and
interruption treatments in 03.9/03.11 are semantic references, not new equipment
screens or permission to reuse capture-specific recovery copy.

Use approved shared controls, font assets, theme roles and paired colors from
the foundations. Do not rebuild a parallel dialog or theme system. Frozen
collages remain reference regions; do not implement them as routes. Design-study
footers and invented equipment readings belong only to visibly labeled review
fixtures. Keep the immutable exports unchanged.

## Existing routes and composition

| Surface | Address and intended behavior |
| --- | --- |
| Home | `/`; no-rig introduction or the saved rig catalog, with explicit Add a rig |
| Equipment | `/rigs/:rigId`; device list, imaging setup, preparation links, saved-rig management |
| Tonight | `/rigs/:rigId/observe/capture`; Equipment's Back to Tonight returns here |
| Preparation | `/rigs/:rigId/observe`; remains a usable direct link and retains connection command ownership |
| Polar alignment / autofocus | Existing `/rigs/:rigId/observe/alignment` and `/autofocus` addresses |
| Discovery and Forget | Existing modal interactions on their owning routes; no new setup URL required |

Keep Home's whole-rig entry pointed at Equipment so existing bookmarks and the
management workflow remain useful. Shell rig selection continues to open Tonight.
Manage saved rigs in Equipment links to `/`; Forget stays a secondary management
action, available only when the current projection permits it. Preserve endpoint,
added date and last-inventory details behind a disclosure.

The first-night screen is an intentional rest state. Replace Home's automatic
opening of discovery on an empty catalog with the visible Add a rig action from
03.8. Initial loading, failure, and empty success remain distinguishable. A failed
Home refresh preserves the previous catalog and marks it as previous state; it
must not turn an unknown response into the first-night screen.

No-rig navigation and the reference's working Explore entry require the concrete
cross-slice decision below. Never fabricate a rig ID or call a rig endpoint with
an empty ID. Appearance remains available; a rig-less home does not mount a rig
observation. Existing activity for another rig or another page remains visible
under the settled Phase 3 navigation contract.

## Geometry to reproduce

Measurements below transcribe visible bounds in the frozen 1x PNGs; shared text
and control recipes come from the accepted foundations. Confirm source/style
values and rendered bounds during implementation before declaring a match.
Paper's border rasterization is not a reason to subtract pixels from CSS padding.

| Region | Desktop reference |
| --- | --- |
| Common shell | 1440px viewport; 36px outside inset, 88px navigation, full content height |
| Equipment 03.5 | 1440×921; page title row near y=120; content begins y=182; 888px left column, 28px gap, 452px setup column |
| Readiness region | x=36, y=182, width=888, height=106; 24px left inset, heading/body grouping; 46px Connect devices action at right |
| Equipment list | Section label and Refresh state near y=322; divider y=370; four collapsed rows each 100px high in the source, ending y=770 |
| Device rows | Icon near x=40; name/role at x=100; summary near x=400; connection near right edge; disclosure target at far right |
| Imaging setup | x=952, y=182, width=452, bottom y=861; 24px inset; 404px-wide fields/actions; divider-separated camera, focal length, and explanatory groups |
| Preparation links | Below equipment divider, with alignment/autofocus controls on the right; status age below main columns |
| First-night 03.8 | 1440×900; title group starts near y=130; main regions y=256; 888×536 empty-image surface and 452px steps column separated by 28px |
| First-night illustration | Centered simple telescope line drawing; explanatory heading/body, then 46px Add a rig and Explore actions; three numbered steps on right with dividers |
| Review overlay 03.12 | 1440×900; visible outer bounds approximately x=408, y=128, width=624, height=616; 28px inset, 8px corners, restrained backdrop/shadow |
| Review content | Caption, rig title, name field, endpoint support line, device-count caption, four roughly 49px rows, consequence text, Back/Add rig footer |

The review overlay is narrower than the shared Dialog default of 640px. Use an
application class for this explicit source treatment, keeping shared focus and
modal behavior. Its height follows actual devices/errors; do not clip arbitrary
inventories to the four-row sample or lock it to 616px.

Typography: Space Grotesk page title 28/36 and section title 24/30; Barlow body
16/24, support 14/20, and short uppercase captions 12/16 with 1.2px tracking.
Controls retain 46px text and 44px icon/disclosure targets; fields use 14px inset.
Expanded rows reveal existing metrics with clear labels rather than showing
all readings in the collapsed overview. Do not discard metrics to achieve the
reference's quieter normal state.

At compact widths, stack Equipment's readiness, devices, setup, and preparation
links in that order, with 20px outside inset. Row name/activity/status may wrap;
keep disclosure and command targets reachable. An expanded row must not force
horizontal page scrolling. The exact compact Equipment and populated Home
compositions need source-backed workshop inspection because the frozen set does
not contain complete boards for them; this is a design check, not permission to
invent decoration.

03.15 is a dedicated full-screen compact discovery interaction. Crop only the
62px mock OS strip: compare production at **390×782**, with a 60px application
header containing Add a rig and Cancel. The body has 20px horizontal inset;
heading starts around application y=84; invalid host field is 350×46 near y=207;
port field is 350×46 near y=355; Find rig and Back to network scan are full-width,
46px actions near y=431 and y=489. Keep the inline two-line address error,
consequence text, and usable scrolling when the actual keyboard is open. Never
render Paper's fake clock, battery, or explanatory phone-study caption.

Implement this as the existing modal flow with a scoped compact layout. If its
header slot cannot be expressed cleanly through Dialog, design the smallest
shared extension in the workshop and verify existing dialog consumers before
adopting it. Do not replace focus containment with a visually full-screen div.

## Capability ownership and honest presentation

### Equipment observation and connection

The shell's keyed `RigObservationProvider` remains the single `useRigDetail`
owner. Equipment consumes `useRigObservation()` and its existing paced reads;
Refresh state invokes that read. Rig identity changes reset the appropriate
page drafts; appearance changes do not. A current response, an interrupted
read retaining prior values, an offline inventory, and unavailable individual
telemetry must keep different messages and timestamps.

Connect devices uses the existing observation capability and server sequencing.
A small page-level connection composition can consume `useObservation` for
eligibility and command outcome without mounting another `useRigDetail` loop.
The shared shell observation and command result are distinct: request a fresh
shell read after a completed command/check; never infer command success from
navigation reachability. Preserve one in-flight command, pending prevention,
partial results, explicit checks after uncertainty, hidden-page polling behavior,
and read recovery. Do not add individual device connect/disconnect buttons.

03.14's Connect camera becomes **Connect devices**, matching the supported
operation's actual scope. Show the selected camera's disconnection and that
saved photographs remain available. Paper's readiness headline is not evidence
that connection alone establishes exposure readiness: use the existing projected
readiness meaning, or say **Imaging camera connected** when that is all that is
known. Any unavailable preparation action needs its current reason nearby.

03.5 shows three of four devices connected but its shell says Connected. Keep
the truthful partial connection label established in Phase 3. Its “Guide camera”
role and “West side of pier” are also not current rig-detail facts: distinguish
selected imaging camera from **Other camera** unless an existing explicit role
is available; use only observed mount activity/tracking/parking/home values.
Do not add telemetry fields simply to reproduce those sample strings.

Preserve camera temperature/cooler/power; telescope tracking/park/home; focuser
position/temperature; filter wheel selection; observing conditions; generic
switch channel names/values; and unsupported device explanations in row details.
Unknown values stay unknown and disconnected devices have no live measurements.
Do not append units to generic switch values. Retained measurements during a
read interruption stay visibly last known, including in open row disclosures.

### Imaging setup

The current capability already saves camera identity through
`PUT /api/rigs/:rigId/imaging-camera` and focal length through
`PUT /api/rigs/:rigId/framing/settings`. The latter accepts 10–20000mm and returns
the existing framing projection; its paired GET exposes saved focal length even
when framing itself is unavailable. No new persistence model or atomic settings
endpoint is required for this adoption.

Compose the selected-camera and focal-length drafts into the 03.5 side panel.
Keep identity as both ID and reported name; a changed slot cannot silently become
a new camera choice. The panel must represent unselected, ready, missing,
changed, unavailable, busy, and interrupted reads using the existing projections.
Saving these settings never connects equipment or moves a mount.

The single **Save imaging setup** action is an explicit composition of existing
configuration writes, not an atomic promise. Validate both drafts first; save
only changed fields, in a visible sequential flow. Expose a narrow confirmed /
rejected / unconfirmed result from the existing camera-save boundary if required
so the second write does not depend on an effect counter or race. Do not continue
to another write after an unconfirmed result. Keep successful setting changes;
show field-specific outcomes if only one save succeeds. Never announce “setup
saved” until each requested setting is confirmed. Preserve both drafts on error,
reconcile lost responses through the corresponding GET, and never auto-replay
or compensate a configuration write. An explicit retry submits only the still
unconfirmed/rejected draft after its state has been checked.

Keep the original preparation and framing setting entry points usable. Share
small presentation/API helpers only where doing so avoids inconsistent identity
or save semantics; no general settings provider or transaction engine. This
slice may narrowly adjust browser hook return contracts and composition, but
should not change server device behavior.

## Discovery, review, and Forget state flow

Keep the current explicit `DiscoveryState` flow, with presentation changes at
its owning components:

1. Add a rig opens the entry state. Scan or Enter address is an explicit choice.
2. Pending scan/address inspection retains the request; Cancel aborts it and
   invalidates late completion. It does not claim that a configuration write was
   undone. Pending reads do not connect devices or move hardware.
3. Results distinguish eligible, already added, conflicting, and ineligible
   candidates. Only eligible candidates can proceed to review. Keep partial
   inspection failures visible alongside useful results. Completed empty scan,
   failed scan, unreachable address, invalid response, and server failure are
   different states.
4. Manual entry preserves host and port. Invalid host/port feedback is attached
   to the relevant field, uses shared error semantics, and keeps keyboard focus
   useful. A known unreachable address returns the editable address region with
   its values and a warning as in 03.13, with an explicit same-address Try again.
   Do not relabel protocol/malformed-response failures as “no response.”
5. Review displays the entered rig name, inspected endpoint, actual device list,
   and the consequence of Add rig. Back preserves request, selection, and useful
   edits. Empty names cannot submit. Avoid speculative default rig names.
6. Submission retains the dialog and pending action, suppresses duplicate Add,
   and prevents dismissal until its existing outcome resolves. Success is a
   confirmed add response followed by Home refresh; a failed refresh must not
   relabel a successful add as failed or automatically submit again. Keep the
   current Home catalog handoff; Equipment is then a real saved-rig destination.
   Add conflicts and changed discovery eligibility retain their existing reasons.
7. Forget uses the current DELETE capability and the 03.13 confirmation. Explain
   saved configuration removal and unchanged hardware. Focus Cancel first; keep
   the explicit Cancel/Forget footer without an extra close icon. Escape/Cancel
   dismiss before submission and restore focus. Pending blocks duplicate writes
   and dismissal; failure stays in the dialog. Confirmed success returns Home.

A transport-lost Add/Forget response is not permission for an automatic replay.
Preserve known facts and allow explicit inspection/refresh. Do not add durable
onboarding progress, automatic connection after Add, typed confirmation, or a
second confirmation dialog.

## Concrete implementation ownership

All application files below are future edits, after the preceding gate:

| Owner/files | Work |
| --- | --- |
| `routes/home.tsx`, scoped Home CSS; `pages/HomeProvider.tsx` only as needed | First-night/rest/loading/error/populated catalog; explicit discovery entry; preserve confirmed-add versus refresh outcome |
| `routes/rig-detail.tsx`, scoped Equipment CSS | Two-column Equipment, setup/command composition, secondary details/management, existing links |
| `features/rig-detail/RigDeviceCard.tsx`, `DeviceIcon.tsx` | Replace card-first overview with expandable equipment rows; retain detailed telemetry and kinds; rename component/file if row naming improves clarity |
| `features/rig-detail/RigContext.tsx`, `use-rig-detail.ts` | Preserve existing scope and polling; change only if a concrete consumption issue requires it |
| `features/imaging-camera/ImagingCamera.tsx`, `use-imaging-camera.ts`, new narrow setup composition | Camera/focal drafts and confirmed per-setting results; retain original consumers |
| `features/observation/use-observation.ts`, `observation-api.ts`, `presentation.ts` | Reuse existing command contract; extract a presentation part if necessary, without changing sequencing |
| `features/targets/use-framing.ts` and existing validation/API boundary | Reuse focal-length read/write, extracting a narrow settings interface only if needed; preserve framing controls and state |
| `features/rig-discovery/RigDiscoveryDialog.tsx`, `ManualDiscoveryForm.tsx`, `RigReview.tsx`, `DiscoveryResults.tsx`, `RigDiscoveryDialog.css` | Approved start/results/review/address layouts, errors, compact modal, pending/cancellation |
| `DiscoveryOrbit.*`, `DiscoveryScanner.*` | Remove displaced decoration when unused; use the approved simple line illustration and restrained pending state |
| `features/rig-management/forget-rig.ts` and route confirmation | Keep API semantics; adopt source confirmation and focus behavior |
| `features/navigation/AppNavigation.tsx` | Only agreed no-rig navigation entry changes; preserve settled active-run and appearance behavior |
| Existing feature READMEs and new owning rig-discovery/rig-detail guidance if needed | Record actual ownership, error meaning, settings composition and confirmed handoff without duplicating this plan |

Retire replaced rule groups in `routes/rig.css` only after checking their other
route consumers. Prefer scoped Home/Equipment CSS over global overrides. Do not
edit Tonight, image inspection, or preparation/framing composition belonging to
another active owner without an explicit coordinated boundary.

## Deterministic scenes and focused checks

Extend the development-only real-route scene registry and review server created
by Phase 3. Each scene records fixed clock/timezone, route, rig identities,
ordered API responses, viewport, palette and opening interactions. Equipment and
onboarding require no image-byte substitute. Block unknown fixture requests and
never contact the LAN through this review runtime. Fixtures use actual contract
shapes, not loose rendering-only props.

| Scene | Required state/sequence |
| --- | --- |
| `equipment-connected` | 03.5 four devices, selected main camera, three connected/one disconnected, known focal length; truthful partial navigation label |
| `equipment-camera-disconnected` | 03.14 selected camera disconnected, explicit Connect devices scope and preparation reason |
| `equipment-details-all-kinds` | Extended inventory with partial telemetry, unknown values, generic switch channels, unsupported device, disclosures open |
| `equipment-read-interrupted` | Successful view → pending refresh → failed read retaining labeled values → recovered view; no overlapping polls |
| `equipment-unavailable` | Initial failure/404, offline inventory, empty device inventory as separate ordered scenes |
| `equipment-connect-outcomes` | Pending → confirmed/partial/rejected result; separate lost response → explicit check, with no POST replay |
| `equipment-setup-save` | Camera+focal drafts, both confirmed; first success/second failure; write response lost; changed camera slot; operation lock |
| `home-no-rigs` | 03.8 successful empty catalog with no auto-open dialog |
| `home-rigs` | Saved reachable/offline/unknown rigs; failed refresh retains known list; every rig still reachable |
| `rig-discovery-review` | 03.12 explicit Add → scan/address → selected eligible candidate → editable review |
| `rig-discovery-empty` | 03.13 completed empty scan, Scan again and Enter address; failed scan is a separate fixture |
| `rig-address-unreachable` | 03.13 retained address+port, inline warning and retry, field focus |
| `rig-address-validation-phone` | 03.15 390×782, invalid `http://192.168.4.104`, port retained, immediate field error, keyboard dismissed for reference capture |
| `rig-dialog-submission` | Pending Add, duplicate prevention, confirmed add/Home refresh, add conflict, post-add refresh failure |
| `rig-forget-dialog`, `rig-forget-focus-return` | 03.13/03.18 Cancel first, focus containment, dismiss/restore, pending, error, confirmed Home transition |
| `rig-add-control-states`, `fieldroom-reduced-motion` | 03.18 rest/hover/focus/pressed, no layout jump, equivalent immediate error and reduced motion |

Extend the current `rig-onboarding.e2e.ts`, `rig-detail.e2e.ts`,
`imaging-camera.e2e.ts`, and affected `observation.e2e.ts` cases. Preserve their
assertions for exact payloads, blocked ineligible review, late-scan cancellation,
value retention, polling visibility/non-overlap, malformed projections, generic
switch units, and one DELETE. Replace old CSS/card-order assumptions only where
the approved row presentation changes them; retain meaningful ordering and
availability checks. Add focused combined-settings outcomes rather than a
combinatorial matrix. Assert that reads/navigation issue no physical commands.

Use focused browser checks, web build and lint. If extracting a config/API hook
changes its behavior, add the smallest boundary tests that prove validation and
uncertainty. Reuse server suites (`rig/management`, `rig/discovery`,
`rig/connection-route`, `rig/imaging-camera`, `web/rig-detail`, and targets
settings tests) only when affected contracts actually change; do not run a broad
hardware campaign for a presentation slice.

## Open decision and exit gate

**First-night Explore is a real functional gap, not a settled copy omission.**
All current target/discovery pages and endpoints require a saved rig; 03.8 offers
Explore before one exists. The smallest concrete option is a rig-less catalog
browse route using the pinned catalog with search and category filters, no site
or sky-opportunity claims, and no framing/capture controls until a rig is chosen.
Its server read can return catalog facts/thumbnail identities without requesting
rig hardware; it must not invent a site, a camera, or a rig. Reconcile this with
the Explore slice's route/contract plan before Equipment/Home implementation.
Do not silently hide the approved Explore action or add a broad location/setup
subsystem. Parent alignment must record which existing/new route provides the
working entry and the corresponding fixture/tests.

Other explicit comparison substitutions are scoped and factual: Connect devices
for the existing multi-device operation; truthful partial navigation status;
observed camera roles and mount readings; no fabricated pier side; and separate
configuration-save outcomes. Record these beside screenshots so they are not
misclassified as accidental visual drift.

Before accepting this slice: settle focused checks, commit the target, obtain
fresh-context independent **OK**, then compare the real production routes in both
palettes at 1440×921 (Equipment), 1440×900 (Home/review), 390×782 (phone address),
and a useful compact Equipment/Home width. Inspect loaded fonts, source bounds,
row/disclosure wrapping, overlay focus, motion and pending/error states. Measure
actual DOM geometry and preserve comparison evidence separately from the frozen
sources. Resolve discrepancies and reverify changes; record actual scope and the
first-night Explore decision before starting the next application slice.

## Actual results

Planning only. The referenced screens and current browser/server capability
owners were inspected; no application code or device state changed for this task.
