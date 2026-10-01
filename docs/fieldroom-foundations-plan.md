# Fieldroom foundations implementation plan

Status: accepted at `c7c5712`; independent OK and final browser comparison complete.
The Step 1 reference gate in [fieldroom-adoption.md](fieldroom-adoption.md) passed
before implementation. This document preserves the second slice’s before-work
plan; measured results and deviations are recorded in the adoption document.

Source inspection baseline: `15c2bbe19770ef55ed2d6aa830fb833a19216ae4`.
Visual authority: frozen [DS.01–DS.16](visual-reference/fieldroom/system/),
including the paired palette and states in DS.14/DS.15 and Appearance in DS.16.
The frozen images remain authoritative if a transcription below disagrees.

## Outcome and scope

Make Fieldroom expressible through the existing shared theme resolver and stable
primitives. Produce runnable, source-backed workshop specimens that reproduce the
approved typography, geometry, states, and paired colors. The following app slice
will compose those primitives into Tonight and connect browser appearance state.

Keep `resolveTheme()`, generated OKLCH ramps, `themeStyle()`, and named profiles.
Add exact per-mode overrides instead of a parallel application theme adapter.
Preserve `DEFAULT_PROFILE` and `VELA_CURRENT_PROFILE` as named token references.
The Step 1 archive preserves their previous rendered appearance: retaining old
profile values does not freeze shared component CSS. Do not carry a second
production stylesheet or build profile migration machinery.

No server/model/device contracts change in this slice. Component pending states
must remain presentational representations of their caller's confirmed state.
Optional toast artwork on DS.13 does not require a notification subsystem.

## Theme and font contract

The current semantic mapping has fourteen ramp-reference keys, one font family,
and scalar geometry that cannot encode Fieldroom faithfully. Extend the existing
contract in place:

- Add optional `colorOverrides` with independently optional `light` and `dark`
  maps of supported semantic keys to six-digit hex colors. Resolve existing ramp
  mappings first, derive defaults for newly introduced state roles, then apply
  overrides for the selected mode. Validate keys and color syntax; do not accept
  arbitrary CSS strings or turn the override layer into an untyped variable bag.
- Keep existing semantic names where meanings match. Add `accentHover`,
  `accentPressed`, `warningSurface`, and `dangerSurface`. Existing generated
  profiles receive sensible derived values without requiring new saved maps.
  Separate new resolved color roles from required legacy ramp mappings if that
  keeps existing profiles and scratch artifacts straightforward to parse.
- Export immutable `FIELDROOM_PROFILE`. Use the exact table below, including
  explicit state colors rather than `color-mix()` approximations for Fieldroom.
- Extend supported font choices with Barlow and Space Grotesk; add a heading
  family choice separate from the existing body `fontStack`. Existing profiles
  default headings to their existing family. Fieldroom uses Barlow for body and
  controls and Space Grotesk for headings and prominent measurements.
- Keep the existing profile/session serialization boundary coherent with the
  new optional fields. Round-trip supported fields and reject malformed input.
  Do not silently ignore a valid Fieldroom override. No version migration engine
  or compatibility layer for obsolete scratch artifacts is required.
- Introduce only the named geometry parameters that are actually consumed by
  these primitives. Preserve existing `controlHeight`, `radius`, and
  `panelPadding` where their meanings still fit. Add explicit icon-target,
  card/overlay-radius, field/button-inset, overlay-padding, and focus-offset
  values where required. Avoid radius multipliers that merely happen to match.
- Typography roles and short motion recipes can be shared CSS tokens rather
  than individually editable workshop controls. Do not add a general token
  registry or a large editor for every role.

Bundle licensed WOFF2 assets in `packages/ui/src/fonts`, with provenance and
license text. Use local `@font-face` declarations and the existing font-loading
pattern. Supply the actual Barlow 400/500/600 and Space Grotesk 400/500 weights
used by the design; do not depend on installed desktop fonts or synthesized
weights. Keep Inter assets for reference profiles. Update the font README.

### Exact paired semantic colors

| Existing/new role | Light | Dark | Use |
| --- | --- | --- | --- |
| `canvas` | `#F1EEE5` | `#141715` | Page |
| `surface` | `#E5E3D7` | `#1C241E` | Inset and image surround |
| `surfaceRaised` | `#F6F3EA` | `#202922` | Fields and overlays |
| `text` | `#293C36` | `#DDE1D7` | Primary text |
| `textMuted` | `#50614F` | `#A8B4A7` | Secondary text |
| `accent` | `#304638` | `#B8CDA8` | Primary action |
| `accentText` | `#F1EEE5` | `#141715` | Text on primary action |
| `accentSurface` | `#DCE3CF` | `#263127` | Selected/active context |
| `accentHover` | `#405B48` | `#C7D9BA` | Primary action hover |
| `accentPressed` | `#25362B` | `#A8C096` | Primary action press |
| `focus` | `#304638` | `#B8CDA8` | Focus outline |
| `lineStrong` | `#75816F` | `#7F917A` | Control edge |
| `line` | `#C4CBBE` | `#3C483E` | Quiet divider |
| `warningSurface` | `#ECE1CD` | `#382F20` | Warning background |
| `warning` | `#72532E` | `#E0C28F` | Warning text |
| `dangerSurface` | `#EBDCD4` | `#3B2925` | Error background |
| `danger` | `#8B4838` | `#E2B09B` | Error text and invalid edge |

Confirmed/healthy status uses the existing forest/action family with an explicit
label or mark; do not invent a vivid green semantic palette. Resolve `positive`
consistently from that family. Pending and unavailable controls use the muted
recipes inspected in DS.05/DS.15: light uses surface `#E5E3D7`, divider
`#C4CBBE`, and secondary text `#50614F` for both. Dark unavailable uses surface
`#1C241E`; dark pending uses active surface `#263127`; both use divider
`#3C483E` and secondary text `#A8B4A7`. Add a concrete optional `pendingSurface`
override if needed to preserve this paired recipe without mode-specific feature
CSS. Do not lower whole-control opacity; preserve readable labels and nearby
explanations.

DS.14 changes interface colors, never astronomical image pixels. Keep paired
mode geometry, font roles, spacing, and image framing identical.

### Typography recipes

All measurements are CSS pixels; tracking is explicit letter spacing. Use normal
font kerning. Ordinary labels remain sentence case.

| Role | Family | Weight | Size / line | Tracking |
| --- | --- | --- | --- | --- |
| Metric | Space Grotesk | 400 | 46 / 56 | −2 |
| Subject | Space Grotesk | 500 | 32 / 40 | −1 |
| Page title | Space Grotesk | 400 | 28 / 36 | 0 |
| Section | Space Grotesk | 400 | 24 / 30 | 0 |
| Body | Barlow | 400 | 16 / 24 | 0 |
| Control | Barlow | 500 | 15 / 20 | 0 |
| Supporting | Barlow | 400 | 14 / 20 | 0 |
| Caption | Barlow | 400 | 12 / 16 | +1.2 |

The wordmark is Space Grotesk 500 at 34/42 with −2 tracking. Caption tracking is
for short uppercase captions only. Labels can use Barlow 500, selected choices
600. Use tabular lining numerals for changing measurements and aligned values;
keep prose proportional. A page heading must not inherit subject tracking.

## Geometry and stable component recipes

| Boundary | Approved recipe |
| --- | --- |
| Text button | 46 high; content width; 18 inline inset; 8 icon gap; Barlow 500 15/20; 4 radius; 1 border |
| Icon button | 44 × 44 target; 20 icon; 12 surrounding space; 4 radius; accessible name and readable tooltip |
| Input | 46 high; 14 inline inset; raised fill; 1 control edge; 4 radius; value 16/24; label/hint 14/20; 8 label/hint gaps |
| Select | Input recipe; reserve space for chevron; persistent label; value 16/24 |
| Checkbox | 20 mark; 3 mark radius; 10 mark-to-label gap; full label target at least 44 high; label Barlow 400 15/20 |
| Tabs | Transparent; content-width targets at least 44 high; 24 target gap; 2 active underline; 15/20; active weight 600 |
| Standalone action link | At least 44-high target; control text; visible underline; avoid placing an invisible target over adjacent content |
| Generic Panel | 24 inset; 6 radius; appropriate surface; no shadow |
| Source capture card | Preserve 20 block / 22 inline inset and 16 between groups; 6 radius; no shadow; do not normalize to generic Panel padding |
| Dialog | Raised; 8 radius; 1 control edge; 28 inset; 18 content-group gaps; 12 action gap; max width 640 with at least 20 viewport clearance on each side |
| Dialog typography | Page-title 28/36; explanation 16/24; actions 15/20 |
| Focus | 2 outline with 3 clear offset; remains visible with invalid or pending state; no layout shift |
| Invalid input | 2 error edge and specific message; keep outside dimensions fixed |
| Overlay elevation | x0 / y16 / blur64 / spread0; light ink at 20%; dark dialog black at 20% (DS.15), dark Appearance black at 40% (03.20) |
| Modal backdrop | Light ink at 18%; dark uses black at 40% as an implementation choice because no paired backdrop specimen exists; no backdrop blur |

Use the small spacing vocabulary 4, 8, 12, 16, 20, 24, 28, 32, 36, 48.
Keep intentional measured exceptions such as 10px checkbox gaps and 22px source
card insets. Do not apply a global density multiplier that makes approved target
sizes smaller.

The desktop shell source has 36 outside inset, 88 navigation height, 28 primary
column gap, and 1368 content width at a 1440 viewport. These are composition
measurements, not a fixed 900px page height. Navigation, content, and footer
share outside edges. The later app owner implements the feature layout; the
NavigationBar specimen must make its approved structure possible, including
right-side rig context, without hardcoding feature routes into `@vela/ui`.

Use shared semantic components before feature overrides. Remove displaced rules
rather than stacking a Fieldroom override layer over old sizing. Keep feature
specimen CSS focused on composition; do not repair shared button/field recipes
inside every specimen.

### Behavior and motion

Control feedback is 120ms; confirmed state emphasis 160ms; overlay reveal 180ms
ease-out with opacity and at most 6px translation. No hover movement of buttons.
Reduced motion removes translation and looping. Device feedback never waits for
an animation. Appearance changes have no full-page color animation or image fade.

Pending action prevents duplicate invocation and uses truthful pending text.
Unavailable actions retain an explanation. Do not disable Stop merely because
other work is active. Show field errors below fields, command errors by their
actions, and missing-image messages in the viewer. Interruptions and uncertain
outcomes remain visible until resolved; no automatic dismissal as a success.

Preserve modal Dialog behavior: focus enters intentionally (Cancel first for a
forget confirmation), Tab stays within the modal, Escape/Cancel dismiss before
submission, and focus returns to the opener or next useful control. Keep content
scrollable within the viewport and title/actions reachable. Pending/error state
must not falsely close the dialog as though the operation succeeded.

## Appearance specimen and application boundary

Build the DS.16 surface as a small controlled non-modal popover with one radio
group. Use a direct component API for open state, selected preference, selection,
and dismissal; avoid a general menu/settings framework. Shared code must not
read localStorage, browser color preference, rig settings, or app configuration.

- Desktop width 360; phone width viewport minus 40; viewport inset 20.
- Raised surface, 8 radius, 1 control border, 20 padding, 12 group gaps, 8 option
  gaps. Heading 24/30; options 15/20. Trigger and close targets 44.
- Option rows at least 46 high. The phone System row is 64 high for its second
  line. Selection combines tint, radio mark, and weight; never color alone.
- Anchor to Appearance and keep outside controls usable; no backdrop or modal
  focus trap. Enter on the selected radio; arrows change selection; Tab visits
  controls. Close, Escape, and outside click dismiss. Keyboard dismissal returns
  focus to Appearance; outside clicking a useful control must not steal focus.
- Apply selection immediately and keep the panel open. No Save button.
- Workshop exercises System resolving each way, explicit Light/Dark, saved and
  “For this visit only” copy, desktop/phone, keyboard, and reduced motion.

The parent app owner implements [the application appearance plan](fieldroom-appearance-plan.md)
in Phase 3. It resolves `VITE_THEME` into a theme identity at app composition,
with Fieldroom default and a named legacy token reference. The shell
receives configuration rather than directly choosing `VELA_CURRENT_PROFILE`.
This identity is separate from browser-local `system | light | dark` preference,
which resolves to the existing `ThemeMode` union. System follows media-query
changes and falls back to light if unavailable. Explicit overrides persist only
in this browser; storage failure applies the choice for this visit and reports
that accurately. Apply resolved presentation before the first visible frame;
update root color-scheme and browser theme-color. Do not remount routes, capture,
image inspector, or overlays on a palette change. Workshop's explicitly scoped
light/dark previews must remain independent of the app's System setting.

## Concrete ownership and integration order

Assign these as bounded responsibilities after the Step 1 gate. All owners work
in the shared tree and must preserve other owners' changes. Agree interfaces
before parallel edits. Only the primitive owner edits shared `styles.css`.

| Owner | Files / responsibility | Handoff |
| --- | --- | --- |
| A: themes and fonts | `packages/ui/src/themes/{types,defaults,runtime,index}.ts`, `runtime.test.ts`; new local files and README/license in `packages/ui/src/fonts/` | Export Fieldroom, resolver/schema changes, named variables and font asset paths; give B the exact font-face declarations instead of editing shared CSS |
| B: stable primitives and CSS | `packages/ui/src/styles.css`; affected `Button`, `IconButton`, `Input`, `Select`, `Checkbox`, `Tabs`, `Panel`, `Dialog`, `NavigationBar` source/specimens; small tooltip support if existing capability cannot meet DS.05 | Own all shared CSS including C's Appearance classes and font declarations from A; remove conflicting rules; publish component contracts |
| C: workshop and Appearance | New `Appearance` component/specimen and its focused behavior test; `apps/workshop/src/{useWorkshop,diagnostics,registry}.ts`, `apps/workshop/src/{ThemeEditor,PreviewCanvas,Gallery}.tsx`; workshop README and relevant operations guidance | Add Fieldroom built-in/default, paired specimens, hex-aware diagnostics; provide shared CSS needs to B; coordinate a single edit to `components/index.ts` |
| Parent: integration and web config | `apps/web/src/components/app/Shell.tsx`, app composition/config module, browser preference module, `main.tsx`, `styles.css`, `index.html`, focused `apps/web/tests/theme.e2e.ts`; adoption/evidence documents | Preserve Phase 3 timing for production preference behavior and shell composition; integrate contracts, runtime, independent review, and acceptance |

The ownership table names responsibility, not a requirement to edit every file.
The parent assigns `components/index.ts` to one owner (normally C) before work.
New geometry fields and emitted variable names must be agreed by A/B before B
changes consumers. A may finish first;
B/C can then proceed independently with coordinated Appearance CSS. Do not
parallelize uncoordinated edits to the single shared stylesheet.

Workshop color editing must make explicit overrides understandable rather than
showing a ramp control as though it changes an overridden semantic color. Extend
contrast diagnostics to handle hex as well as generated OKLCH, including primary
and secondary text on their actual surfaces, action text, warning/error pairs,
and focus/control boundaries. Preserve existing generated-profile resolution
and light/dark comparison. Retire “Vela Current / dark” as the default comparison
instruction when Fieldroom becomes authoritative.

## Focused checks and browser acceptance

Automated checks should protect real regressions, not repeat this document.

1. Theme tests: exact representative Fieldroom overrides in both modes; override
   precedence over generated mapping; legacy profile resolution; valid profile
   serialization; malformed/unsupported override rejection. Include distinct
   hover/pressed and warning/error surfaces so a partial palette cannot pass.
2. Diagnostics test: a known hex contrast pair and existing OKLCH support; verify
   that a poor action/text pair is reported rather than silently skipped.
3. Component behavior: Appearance keyboard selection/dismissal and non-modal
   outside interaction; existing Dialog focus containment/return after changed
   structure; pending prevents duplicate action. Reuse existing tests where
   meaningful rather than introducing exhaustive snapshots of every class.
4. Run focused changed test files, `pnpm --filter @vela/ui build`,
   `pnpm --filter @vela/workshop build`, and `pnpm lint`. Run the web build when
   changed exports affect its consumers. Broaden checks only for an affected
   boundary or a concrete failure.
5. Render actual workshop specimens with local fonts loaded and images decoded.
   Capture light/dark at reference dimensions and compact widths. Compare DS.02,
   DS.05–DS.09, DS.12–DS.16 and relevant navigation/responsive examples. State
   boards are component reference collages, not full-page production layouts.
6. Measure computed font family/weight/size/line/letter spacing and target boxes;
   verify 46px text controls, 44px icons/checkbox labels/tabs, 4/6/8 corners,
   focus offset, card exceptions, overlay bounds, and no text clipping. Inspect
   hover, pressed, keyboard focus, invalid, pending, unavailable, checked,
   selected, interrupted, and open-overlay states in both palettes.
7. Confirm font requests succeed and actual loaded faces are used. Confirm that
   theme changes preserve image bytes and framing, and reduced motion has no
   translation/looping. Inspect UI text wrapping separately from rasterization.
8. Commit the review target, obtain fresh independent `vela-verifier` **OK**, and
   run the final browser comparison on that reviewed result. Correct findings
   and reverify affected changes. The parent self-accepts this intermediate
   slice; Chris's final application acceptance remains the merge gate.

Application preference persistence, initial paint, media-query following,
storage-failure copy, and no route/image-state reset are Phase 3 acceptance
checks. A workshop-only mock does not establish those behaviors.

## Evidence to record when completed

Record the actual commit, focused commands/results, specimen URLs and viewport
sizes, screenshots and measured discrepancies, independent verdict, final
browser pass, and deviations from this plan in the adoption document. Preserve
frozen Paper images unchanged. Do not claim the slice complete from token values
or successful compilation alone. Unresolved palette, font, crop, or geometry
differences remain work; anti-aliasing differences are recorded separately.

## Appearance geometry reconciliation

The first visual estimate of a 338px Paper popover omitted its border extent.
Precise source inspection of DS.16 node `45R-0` resolves the discrepancy:

- Source CSS declares width 360, padding 20, border 1, and group gaps 12.
  Content heights are header 44, label 20, option stack 154, and footer 44.
  At normal browser CSS sizing the total is **340px**: 40 padding + 2 border
  + 44 + 20 + 154 + 44 + 36 gaps.
- Paper reports logical bounds **360 × 339.328125**, content width
  **318.65625**, and an approximately **20.667px** world-coordinate inset.
  Its declared 1px border is quantized to approximately two-thirds of a
  logical pixel in that measured canvas. DS.05 corroborates this: button
  `25N-0` has width 125.328125 for an 88px text box, two 18px paddings, and
  the same declared border. These measurements describe Paper's rendering,
  not a different padding requirement.
- The matching 03.19 panel `3YF-0` exports at **360 × 339** at 1x. Raster
  extent is distinct from logical layout. The browser keeps the declared
  **20px padding and actual 1px border**, measuring **360 × 340**; the
  **0.671875px** difference from Paper's measured logical height is recorded
  as border quantization. No fractional CSS or compensating padding is used.
- Source option rows (`3YL-0` and siblings) specify **10px radio-to-text gap**.
  The implementation was corrected from 12 to 10. This is separate from the
  unchanged **8px gap between option rows**.

Both browser palettes retain 44px header/close targets and 46px desktop option
rows, Barlow body text, and Space Grotesk heading text. The compact System row
remains 64px. The Appearance browser suite checks keyboard/outside dismissal,
focus return, compact bounds, reduced motion, and placement above a low anchor.
