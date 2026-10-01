# Fieldroom foundations acceptance

Reviewed implementation: `c7c5712`. Independent verification returned **OK** on
[PR 86](https://github.com/chrhicks/vela/pull/86#issuecomment-5923065413), then the
parent completed this browser comparison on that revision. Accepted as an
intermediate foundation only; application adoption and Chris’s final acceptance
remain separate gates.

## Reproduction and evidence limits

Run `pnpm dev:workshop`. Select Fieldroom, density 1, no scratch overrides.
These source-backed specimens were inspected in both palettes:

- `/?component=panel&specimen=fieldroom-foundations&profile=fieldroom&mode=light&context=isolated&viewport=900`
- `/?component=appearance&specimen=appearance-primitive&profile=fieldroom&mode=light&context=isolated&viewport=900&prop.open=true&prop.preference=system&prop.systemMode=light&prop.persistence=saved`
- `/?component=navigation-bar&specimen=navigation-bar-anatomy&profile=fieldroom&mode=light&context=isolated&viewport=1440&prop.rig=askar&prop.page=tonight&prop.connection=connected&prop.activity=none`

Repeat with `mode=dark`. Appearance also used simulated width 390, System/light,
explicit Dark, and visit-only copy. Navigation used simulated width 390. Dialog
was additionally inspected in an actual **390 × 782** browser viewport.

The native collaborative preview reported DPR 1.5. Most captures used a
1600 × 1100 browser around the workshop. Captures include editor chrome and
scroll position; they are not whole-application or 1x Paper raster baselines.
The workshop’s simulated 390 surface measures 388.667 after its border; its
Appearance panel therefore measures 348.667. Actual application width comparison
belongs to the next slice. Fonts and overlay animations were allowed to settle
before the retained captures. The manifest hashes these evidence images.

## Measured result

| Reference recipe | Browser result |
| --- | --- |
| DS.02 typography | Loaded Barlow 400/500/600 and Space Grotesk 400/500; metric 46/56, −2 tracking; subject 32/40 at 500, −1 tracking; page 28/36; section 24/30; body 16/24; control 15/20 at 500; supporting 14/20; caption 12/16, +1.2 tracking |
| DS.05/09 controls | Button/input/select 46 high; icon/tab/checkbox-label targets 44; checkbox mark 20; control radius 4; invalid edge 2 without changing field height |
| DS.06 source card | Width 452, actual four-group height 214, padding 20 block/22 inline, 16 gaps, radius 6, active fill, no border/shadow; track 4 high |
| DS.07/09/15 confirmation | Max width 640, padding 28, group gap 18, action gap 12, radius 8; 350 wide with exactly 20 clearance on each side of the actual 390 viewport; no horizontal overflow |
| DS.14/15 paired state colors | Exact resolved action/text/raised/active/warning/error and progress colors in both palettes; dark pending active fill, unavailable inset fill, opacity 1 |
| DS.16 Appearance | Desktop 360 × 339.333 at DPR 1.5; 20 padding; 46 option rows; compact System row 64; compact panel 20 from each theme-surface edge; dark shadow black at 40% |
| 03.0 navigation recipe | Lowercase wordmark 34/42 at 500, −2 tracking; header 88; brand gap 56; links 44 high with 24 gaps; utility before raised 46-high rig selector; compact content scrollWidth equals clientWidth |

DS.06’s diagram labels its older card 212 high, while the actual 03.0 source
recipe totals 214 (40 padding, 20/56/4/46 groups, three 16 gaps). The specimen
follows the actual source structure. Paper rounds natural text boxes and
quantizes borders; see the precise reconciliation in
[the foundations plan](../../../fieldroom-foundations-plan.md). No padding or
tracking compensation hides these rendering differences.

The first visual pass caught and corrected the Barlow version, navigation,
source-card, and confirmation anatomy issues recorded in
[the adoption log](../../../fieldroom-adoption.md). No unexplained geometry or
font discrepancy remains in this foundation scope.

## States and interactions

The paired controls and lower state cards were inspected against DS.05–09 and
DS.14–16. Keyboard Tab displayed the two-pixel focus outline with the declared
three-pixel offset (2.667 computed at this device scale). Cancel receives initial
confirmation focus, Tab remains inside, and Escape returns to the opener.
Pending retains focus and a second Enter leaves the local request count at one.
The real hover transition and settled pending colors were observed; pressed
color is established by the matching state rule and exact theme tests.

Appearance arrow selection leaves the menu open. Escape restores its trigger.
Clicking Outside action closes the menu, executes that action once, and leaves
focus on it. No backdrop or modal focus trap appears. Compact contents do not
clip. The independent Chromium suites additionally cover reduced motion and
placement above a low anchor.

This slice proves shared presentation and local component behavior. It does not
prove browser preference persistence, initial application paint, preserved image
inspection during theme changes, physical commands, or the later image-inspection
and application feedback workflows from DS.10–13. Those remain assigned to their
consuming application slices.
