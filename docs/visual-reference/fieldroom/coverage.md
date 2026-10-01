# Fieldroom reference coverage

This is the planned production-route coverage for the frozen export in
[manifest.json](manifest.json), governed by [the adoption plan](../../fieldroom-adoption.md).
Scene names below reserve deterministic future fixtures; they do not claim those
fixtures or the redesigned routes are implemented. The manifest contains 40 boards:
24 application references on Paper `p-1-0` and 16 system references on `p-3-0`.
Paper's numbered screen names, rather than its internal page IDs, identify them here.

## Comparison rules

- Whole-route references compare the real application at the exact dimensions
  below. Preserve the original PNGs and their hashes. Do not normalize every
  desktop board to 900px high.
- State sheets and interaction sheets are collections of independent examples.
  Compare each example in its owning production route and test the associated
  behavior. Do not implement their collage, explanatory captions, or arrows as
  an application page. Record each compared region and its scene in evidence.
- Five phone exports are 390×844, including a mock OS strip. Their application
  rectangle is `(x: 0, y: 62, width: 390, height: 782)`. Compare against a 390×782
  app viewport; never render the mock status bar in Vela. Originals stay intact.
- Every scene runs in light and dark, using the same image bytes, state and
  geometry. Boards 04 and 03.19–03.22 provide explicit paired appearance evidence;
  the system boards define the other palette substitutions.
- Fixtures must fix the clock/timezone, rig/target/image identities, image bytes,
  API responses and response ordering, theme preference/resolved mode, viewport,
  and opening interactions. Wait for local fonts and image decoding. Reject
  unmapped requests. Failures and pending states are deliberate responses, not
  unreliable network timing. The eventual fixture registry must record exact
  values and asset hashes alongside these scene names.
- Fixture photographs and illustrative sky values are review data only. They
  must never enter live operational projections or be relabeled as rig exposures.

## Existing route and capability keys

These paths are the current routes in `apps/web/src/main.tsx`. The redesign may
compose Tonight from Observe and Capture, but this map does not invent a new URL
or remove a working route before that composition is implemented.

| Key | Existing route | Production owner |
| --- | --- | --- |
| Home | `/` | `routes/home.tsx`, `pages/HomeProvider.tsx`, rig discovery/management |
| Equipment | `/rigs/:rigId` | `routes/rig-detail.tsx`, rig detail and device telemetry |
| Observe | `/rigs/:rigId/observe` | `routes/observe.tsx`, observation and imaging-camera |
| Capture | `/rigs/:rigId/observe/capture` | `routes/capture.tsx`, capture controller and latest-image inspection |
| Explore | `/rigs/:rigId/observe/targets` | `routes/targets.tsx`, target discovery/catalog |
| Framing | `/rigs/:rigId/observe/targets/:targetId` | `routes/targets.tsx`, survey, sky and framing controller |
| Photos | `/rigs/:rigId/observe/saved-images` | `routes/saved-images.tsx`, saved-images store |
| Photo | `/rigs/:rigId/observe/saved-images/:imageId` | `routes/saved-images.tsx`, retained image inspection |
| Alignment | `/rigs/:rigId/observe/alignment` | `routes/alignment.tsx`, alignment controller and image inspection |
| Autofocus | `/rigs/:rigId/observe/autofocus` | `routes/autofocus.tsx`, autofocus capability |

## Whole-route and overlay references

Dimensions are the original board dimensions unless an app crop is stated.
All filenames are relative to this directory. An overlay is opened through the
real route's interaction, not mounted alone in a substitute page.

| Board / node | Frozen image / size | Production route and state | Future scene |
| --- | --- | --- | --- |
| 03.0 Tonight — capturing / `8A-0` | [03-0](app/03-0.png), 1440×900 | Capture + Observe composition; repeated capture, loaded saved exposure, selected subject, sky and equipment context | `tonight-capturing` |
| 03.1 Explore the sky / `E0-0` | [03-1](app/03-1.png), 1440×900 | Explore; frozen discovery calculation with cards, filters and available sky context | `explore-discovery` |
| 03.2 Frame a subject / `HF-0` | [03-2](app/03-2.png), 1440×989 | Framing; chosen subject, survey composition and checked exposure context | `framing-checked` |
| 03.3 Prepare a capture / `K0-0` | [03-3](app/03-3.png), 1440×989 | Observe + Capture preparation; camera choice, explicit cooling/settings and ready-to-start state | `capture-preparation` |
| 03.4 Photographs — inspect a saved frame / `O3-0` | [03-4](app/03-4.png), 1440×900 | Photos + Photo; collection context with selected retained exposure and real download actions | `photographs-selected-frame` |
| 03.5 Equipment and rig settings / `RK-0` | [03-5](app/03-5.png), 1440×921 | Equipment; selected rig, supported device details/settings | `equipment-connected` |
| 03.6 Phone — polar adjustment / `UZ-0` | [03-6](app/03-6.png), 390×844; app 390×782 | Alignment; active adjustment with a loaded measurement image | `alignment-phone-adjusting` |
| 03.7 Phone — measurements interrupted / `WX-0` | [03-7](app/03-7.png), 390×844; app 390×782 | Alignment; retained baseline/image, measurement read interruption, Stop available | `alignment-phone-read-interrupted` |
| 03.8 First night — no rig / `YZ-0` | [03-8](app/03-8.png), 1440×900 | Home; empty saved rig catalog, explicit Add a rig entry | `home-no-rigs` |
| 03.10 Tonight — connection interrupted / `139-0` | [03-10](app/03-10.png), 1440×965 | Capture + Observe composition; browser/server interruption with last-known image/context | `tonight-connection-interrupted` |
| 03.12 Add rig — review discovery / `18U-0` | [03-12](app/03-12.png), 1440×900 | Home; discovery result review before adding a rig | `rig-discovery-review` |
| 03.15 Phone — address validation / `1FN-0` | [03-15](app/03-15.png), 390×844; app 390×782 | Home address-entry dialog; entered values retained with validation failure | `rig-address-validation-phone` |
| 03.19 Appearance — system resolves light / `3HH-0` | [03-19](app/03-19.png), 1440×900 | Tonight shell with Appearance open; preference System, media preference light | `appearance-system-light` |
| 03.20 Appearance — system resolves dark / `3K7-0` | [03-20](app/03-20.png), 1440×900 | Same Tonight state with Appearance open; preference System, media preference dark | `appearance-system-dark` |
| 03.21 Appearance — phone light / `3N6-0` | [03-21](app/03-21.png), 390×844; app 390×782 | Alignment phone shell with Appearance open, resolved light | `appearance-phone-light` |
| 03.22 Appearance — phone dark / `3OS-0` | [03-22](app/03-22.png), 390×844; app 390×782 | Same Alignment phone state with Appearance open, resolved dark | `appearance-phone-dark` |
| 04 Fieldroom — beside the rig / `B2-0` | [04](app/04.png), 1440×900 | Tonight capturing, explicit dark counterpart of 03.0 | `tonight-capturing-dark` |

Photos currently uses separate collection/detail routes. The accepted selected-frame
composition must preserve direct image links and back navigation; this table does
not claim that the current route already supplies that combined layout.

## State and interaction sheets

Each named scene is a separate reachable state or controlled interaction sequence
on the listed production route. The source board dimensions describe its reference
canvas, not a requirement to render the whole sheet inside the application.

| Board / node / canvas | Frozen image | Region → production owner → future scene |
| --- | --- | --- |
| 03.9 Empty and loading states / `10N-0` / 1440×900 | [03-9](app/03-9.png) | Ready without exposure → Capture → `capture-no-image`; first exposure pending → Capture → `capture-first-exposure`; empty archive → Photos → `photographs-empty`; no search matches → Explore → `explore-no-results`; unavailable reference survey → Framing → `framing-survey-unavailable`; archive request pending → Photos → `photographs-loading` |
| 03.11 Operational errors and recovery / `162-0` / 1440×900 | [03-11](app/03-11.png) | Camera read interrupted → Capture → `capture-read-interrupted`; Start outcome uncertain → Capture → `capture-start-unconfirmed`; controller lost after restart → Capture → `capture-server-restarted`; automatic save failed → Capture → `capture-save-failed`; solve unavailable with composition retained → Framing → `framing-no-solution`; newest preview GET failed with previous image retained → Capture → `capture-preview-unavailable` |
| 03.13 Dialogs — validation and forgetting / `1BF-0` / 1440×900 | [03-13](app/03-13.png) | Address server unreachable, field focused and values retained → Home → `rig-address-unreachable`; Forget dialog → Equipment/Home management → `rig-forget-dialog`; completed discovery with no results → Home → `rig-discovery-empty` |
| 03.14 Image and equipment edge states / `1DN-0` / 1440×900 | [03-14](app/03-14.png) | Expired unsaved inspected exposure → Capture → `capture-held-frame-expired`; obsolete solved check → Framing → `framing-check-stale`; selected camera disconnected → Equipment/Observe → `equipment-camera-disconnected`; preview refresh unavailable with original retained → Photo → `photograph-original-preview` |
| 03.16 Interaction — capture and stop / `1GV-0` / 1440×1000 | [03-16](app/03-16.png) | Ready → pending Start → confirmed exposure → readout → published image → repeated exposure → Capture → `capture-start-publish-repeat`; Stop intent → stopping → confirmed stopped → Capture → `capture-stop-confirmed`; uncertain Stop → Capture → `capture-stop-unconfirmed` |
| 03.17 Interaction — inspecting an exposure / `1J6-0` / 1440×1000 | [03-17](app/03-17.png) | Fit follows latest → native inspection holds same frame → newer image arrives → Show latest returns to Fit → Capture → `capture-inspection-hold-latest`; enlarged same frame/scale/pan and focus return → Capture/Photo → `image-inspection-enlarge-return`; Keep outcome follows exact visible identity while another arrives → Capture → `capture-keep-visible-frame`; bounded touch/keyboard pan → Capture/Photo → `image-inspection-pan` |
| 03.18 Interaction — focus, dialogs and motion / `1LA-0` / 1440×1000 | [03-18](app/03-18.png) | Add a rig rest/hover/focus/pressed → Home → `rig-add-control-states`; Forget open/focus Cancel/trap/dismiss/return → Equipment/Home → `rig-forget-focus-return`; submission pending/failure/success → management dialog → `rig-dialog-submission`; disclosure and immediate persistent error → Capture → `capture-details-error`; reduced-motion equivalent → Home/Capture → `fieldroom-reduced-motion` |

Start, readout, save and Stop sequences must use distinct scripted responses.
A screenshot of a success card does not prove correct pending, uncertain or
cleanup behavior. Appearance switching must preserve both the operational state
and any held image/viewport. Camera-read interruption and loss of browser/server
connectivity are separate scenes even when both retain old imagery.

## Capability dependencies and recorded substitutions

- **Subject and totals:** Tonight needs server-owned capture subject intent,
  per-run saved count and collected exposure duration. Existing archive
  `savedImageCount` cannot be relabeled as the run count. Subject intent does not
  certify current framing. Old saved images without subject metadata remain valid.
- **Image inspection:** 03.17 needs held identity, Show latest, native loading,
  panning/enlargement and exact-image Keep feedback. Current native capture view
  advances with new frames. A held unsaved image can expire from the bounded
  server cache; 03.14 covers that outcome.
- **Framing preview:** 03.2 and the no-solution state require a bounded preview of
  the actual test exposure. Current framing retains solved WCS, not pixels.
  Reference survey photographs must not substitute for that test exposure.
- **Catalog facts:** constellation exists as `Const` in the pinned OpenNGC inputs
  but is currently discarded. The pinned sources do not supply a distance field.
  Replace the illustrated distance (for example, “4,700 light-years away”) with
  **“Distance unavailable”** wherever that row remains in the adopted layout.
  Record this deliberate content substitution in comparison evidence; do not
  fake distance, derive it from redshift/parallax, or add runtime enrichment.
- **Sky illustration:** production must retain existing approximate sampled sky
  context, timestamps and unavailable-site handling. The illustrative obstruction
  line is not evidence that Vela knows the local horizon; do not introduce a
  claimed obstruction profile from the reference drawing.
- **Camera connection action:** 03.14's “Connect camera” must match an actual
  supported command. Existing observation preparation connects devices through
  server-owned sequencing; do not wire the label to a different scope silently.
  Resolve wording or a deliberately scoped capability in that slice's plan.
- **Autofocus supplement:** four additional references now cover the existing
  capability, with a separate [manifest](autofocus-manifest.json) and
  [design values](autofocus-reference-fixtures.json). These are not recorded
  hardware observations. See the [design record](autofocus-design.md).

| Supplement | Reference / dimensions | Future scene |
| --- | --- | --- |
| 03.23 setup / `48X-0` | [Setup](app/03-23.png), 1440×900 | `autofocus-ready` |
| 03.24 walking / `48Y-0` | [Walking](app/03-24.png), 1440×900 | `autofocus-running` |
| 03.25 phone walking / `48Z-0` | [Phone](app/03-25.png), 390×844; app 390×782 | `autofocus-phone-running` |
| 03.26 outcomes / `490-0` | [State sheet](app/03-26.png), 1440×1100 | `autofocus-interrupted`, `autofocus-result`, `autofocus-restored`, `autofocus-invalid-window`, `autofocus-restore-unconfirmed`, `autofocus-offline` |

## System-board coverage

DS.01–DS.16 are foundations/component references, not application routes. All are
1440×1400 except DS.12 (1440×1200) and DS.16 (1440×1100). Their node IDs, hashes
and files remain in the manifest. The foundations slice must map their color,
type, controls, surfaces, geometry, dialogs, responsive behavior, inspection,
overlays, feedback and appearance states to workshop/browser evidence. Application
coverage above does not substitute for that primitive-level verification.
