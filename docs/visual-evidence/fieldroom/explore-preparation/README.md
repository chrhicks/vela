# Explore, framing and preparation acceptance

Reviewed implementation: `8906518`. Fresh independent review returned **OK**, with
no findings, on [PR 86](https://github.com/chrhicks/vela/pull/86#issuecomment-5923065413).
The parent then ran the final paired browser comparison against frozen app
03.1, 03.2 and 03.3. This accepts this intermediate slice under Chris's explicit
self-acceptance instruction. Later slices and final application acceptance remain open.

## Reproduction and evidence limits

Run `pnpm --filter @vela/web test:browser fieldroom-explore.e2e.ts preparation.e2e.ts`.
The post-review run passed all 22 checks. Its thirteen unmodified Chromium PNGs
and eight geometry measurements are retained here; the manifest records hashes
and dimensions. Desktop viewports are 1440×900 for Explore and 1440×989 for
framing/preparation. Compact viewport is 390×782; full-page captures include
scrolling content, not a claim that the whole workflow fits in one phone screen.
Fonts and images were loaded before the paired captures, and framing used the
actual Aladin renderer with pinned, attributed DSS2 HiPS resources.

The development-only runtime remains reachable at `http://127.0.0.1:5176/__review`.
Native preview DOM inspection at 1440×989 and 390×782 confirmed loaded fonts,
decoded 1280px preparation/framing previews, actual survey canvases, one main
landmark and no horizontal overflow. Native snapshot export still fails with
the preview client's generic error. Native Explore also did not request its
lazy thumbnails in the earlier desktop check; project browser captures decode
all three. These limitations are not evidence of native screenshot equivalence.
Retained PNGs come from project browser tests; no alternate browser automation
system replaced the collaborative preview. No physical commands were issued.

## Compared result

At 1440px Explore controls are x36/y180, 1368×46. Cards start y288, and the
selected photograph has a real 2px border and 226px image area. The summary is
x978/y250, 426×542. Framing starts x36/y180: its survey card is 888×721,
toolbar 54px, survey 886×520, and right column x952/452px. The compact preview
is x952/y508, 452×124. Preparation retains the source 888px image column at
x36/y116, 560px fitted viewport, 452px settings column, 46px controls and exact
Barlow 20/20 enlarge glyph. Both palettes preserve pixels and composition.

The parent inspected all desktop and compact PNGs for type, wrapping, crop,
spacing, borders, controls, selected state and page overflow. No new discrepancy
remained after the reviewed corrections. The below-horizon image is a synthetic
copy regression, not a physically self-consistent sky fixture: it deliberately
changes current altitude and the useful window while retaining the original
night samples. It proves wording and layout, not astronomy calculations.

## Intentional source substitutions

- Real catalog names and dimensions remain authoritative. “Great Hercules
  Cluster” wraps at the source 24/30 size and makes the shared card row 30px
  taller than Paper's shortened label. The fixture has three catalog entries;
  count and pagination reflect that bounded fixture honestly.
- The selected summary uses the frozen calculation time, measured current
  direction/Moon separation and linear sampled altitude. No invented horizon
  obstruction is drawn. Negative altitude and future observing windows use
  below-horizon and explicit start/end wording.
- The survey shows real DSS2 projection and actual camera/solved footprints,
  not the source's enlarged reference photograph or illustrative handles.
  Composition editing remains explicitly paused until Adjust composition.
  Aladin/DSS2 attribution and operational disclosures stay reachable.
- Temporary framing previews say Temporary, not Saved. The framing fixture's
  2-second exposure and 0.20′ offset are actual fixture values; preparation has
  its separate 10-second test image. Preview and solved-check identities remain
  distinct. Missing previews never substitute a survey or capture image.
- Appearance and existing preparation/operational links remain accessible.
  Design-study copy is omitted from live metadata. Compact stacking is an
  evaluated adaptation; these routes have no frozen complete phone board.
- Frozen Paper exports carry Display P3 ICC; browser output does not. CSS font
  metrics and declared source colors govern, not raw channel subtraction.
  Remote asset bytes were unavailable; local dimensions/crop and Paper asset
  metadata match, but remote/local byte identity is not claimed.

Independent validation passed 876 project tests, contract checks, lint/builds,
131 web browser checks, nine workshop checks and four Python checks. Catalog
comparison preserved all 13,372 existing records. This is fixture, source and
render evidence, not physical-device validation.
