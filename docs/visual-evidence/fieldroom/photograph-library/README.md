# Photographs by night and target

Chris approved the `photograph-library` workshop specimen on October 1, 2026.
These native collaborative-browser captures compare the resulting application
with that source-backed design at desktop and phone widths. They supersede the
older dated-list layout evidence for library navigation, not the retained-image
inspection and failure contracts.

| View | Capture |
| --- | --- |
| Night library, 1440 × 900 light | [Nights](nights-1440-light.png) |
| Target's image grid, 1440 × 900 light | [Grid](target-grid-1440-light.png) |
| Selected image, 1440 × 900 light | [Inspection](inspection-1440-light.png) |
| Selected image, 390 × 844 dark, scrolled to viewer | [Phone inspection](inspection-390-dark.png) |
| Target's image grid, 390 × 844 dark | [Phone grid](target-grid-390-dark.png) |

Reproduce through `pnpm --filter @vela/server exec tsx ../../scripts/review-fieldroom.mts`,
then choose `photographs-library` at `http://127.0.0.1:5176/__review`.
Choose Nights or Targets, open a group, then a photograph. Appearance uses the
actual application controls. These fixtures contain invented dates/subject intent
and repeat the pinned Crescent reference image even under other target names;
they establish browsing and rendering behavior, not astronomy or hardware results.
No private retained photographs are copied into this evidence directory.

Comparison: approved two-column visual group cards, search and equal tabs;
four-column desktop/two-column phone image grid; two-column desktop inspection
and stacked phone facts. Existing Fit/100%, enlargement, rendering fallback and
download controls are retained. Selected-image inspection has more operational
facts than the sketch. No horizontal overflow was observed at either width.

Validation also covers search/filter history and reload, unrecorded subjects,
independent list/detail failures, legacy preview refresh, matching downloads,
native pan and appearance, and browser/server timezone disagreement. The server
projects its IANA timezone; observing nights use calendar noon-to-noon arithmetic.
The current review verdict and tested commit are recorded on PR #86.
