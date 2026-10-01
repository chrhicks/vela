# Alignment and Autofocus acceptance evidence

Accepted as an intermediate slice after independent **OK**, no findings, at
`00b1564` ([report](https://github.com/chrhicks/vela/pull/86#issuecomment-5923065413)).
The parent then reran all 83 Fieldroom preparation cases and completed the final
source comparison. Chris's final whole-application acceptance remains required.

The manifest retains 74 actual-route PNGs and 60 geometry records: Alignment
adjusting/read-interrupted and eight Autofocus reference states at 1440/768/390px
in both palettes, twelve additional phone operational states, and compact
Appearance in both palettes. Phone viewports are 390×782; the mock OS strip in
Paper is omitted. Captures are full-page so below-fold provenance, setup guidance
and outcome content remain visible. The matrix uses a fixed clock and explicit
America/New_York timezone; image bytes are pinned review resources.

The reviewer passed `pnpm check` (921 tests, lint, types and workspace builds),
208 app browser cases, 25 workshop cases and four catalog Python checks. The
post-verdict parent run passed all 83 preparation cases. The first comparison
caught a 100px setup ready card where Paper specified 96px: the workshop and
route now use the correct 8px gap. That correction received the fresh verdict
above before this acceptance. No preparation implementation changed afterward.

## Measured comparison

- Alignment phone: heading at x20/y60; status x20/y108, 350×72; error summary
  y192, 350×56; image x20/y260, 350×196. Image/legend/mode composition ends at
  y578, and the Stop/Finish action group ends at y764. The interrupted state keeps
  this geometry and uses past-tense corrections, age and a single Stop action.
- Compact Appearance: x20/y48, width350 after placement settles. Its System
  preference and resolved palette remain distinct; switching mode retains the
  selected image viewport and operational state.
- Autofocus desktop: chart panel x36/y184, 888×540; right column x952, width452.
  Walking card is 262px high; setup ready card is 96px high. The plotted SVG is
  838×280. The source setup diagram, divider and fact-row composition are retained.
- Autofocus phone: heading y60; walking status y108, 350×104; chart panel y224,
  350×232 with a 320×146 SVG; Stop ends at y675. Setup uses the separately reviewed
  320×120 diagram with readable 14px labels, instead of shrinking desktop labels.
- At 768px the shared shell reflows, setup becomes one column and the running
  chart/summary use the available columns. Font and geometry records accompany
  every main capture. No horizontal overflow was observed.

The parent inspected frozen 03.6/03.7, 03.21/03.22 and 03.23–03.26 alongside the
actual route and approved workshop treatments, including baseline, no-solution,
read interruption, completed fit, confirmed restoration, failed restoration,
travel-limit, offline and pending operational states. Desktop Alignment and
baseline compositions are explicit workshop extensions because Paper supplies
only the adjustment phone views.

## Source substitutions and evidence limits

Alignment uses an actual pinned simulator exposure and its declared projected
geometry, not Paper's decorative star image or drawn marker positions. Fit-both
retains the 4-arcminute minimum; crosshair marks optical center and ring marks the
correction target. Glyph sizes stay constant in CSS pixels across widths. The
caption says Last solved frame; source/physical-trial context remains below the
workflow. An Enlarge overlay preserves native-pixel inspection and provenance.

Autofocus plots real fixture sample positions and server fit parameters. Its
horizontal padding follows the same data transform at every width; its y-axis
expands when samples or fit endpoints exceed the source's nominal 6px HFR range.
Lowest measured sample and fitted position remain separate. Outcome cards grow
with real text, preserve outlined source actions and do not imply restoration
until confirmed. The source design-study footer becomes relevant operating
context or the existing focuser-limit disclosure. The shell reports observed
connection counts rather than copying Paper's unqualified Connected text.

These are deterministic UI/contract checks. They do not establish physical polar
alignment accuracy, camera exposure quality or EAF restoration. No physical device
writes were issued for this presentation slice. A native browser inspection at
1280×800 and DPR1.5 confirmed loaded Barlow/Space Grotesk, one main landmark, no
horizontal overflow and the corrected ready-card height. Its snapshot/resize
capabilities remained unreliable. Retained rasters are explicitly from project
Chromium at DPR1, not native screenshots. Paper's export color profile also differs
from the browser raster; declared tokens govern color comparison.

## Reproduction

Run the existing project browser suites from the repository root:

```sh
pnpm --filter @vela/web exec playwright test tests/fieldroom-alignment.e2e.ts tests/fieldroom-autofocus.e2e.ts
```

They write `/tmp/vela-<scene>-<width>-<mode>.png` and matching geometry JSON.
The retained names drop the `vela-` prefix. Additional operational and Appearance
captures are emitted by the same tests. Fixture definitions and pinned asset
hashes live in `apps/web/tests/fixtures/fieldroom/`.

For interactive review run `pnpm exec tsx scripts/review-fieldroom.mts` and choose
`alignment-phone-adjusting`, `alignment-phone-read-interrupted`, `autofocus-ready`,
`autofocus-running` or the other named scenes from `http://127.0.0.1:5176/__review`.
The review server uses the real routes and isolated contract data.
