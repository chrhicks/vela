# Photographs acceptance evidence

Accepted by the parent under Chris’s intermediate-slice authorization after
independent **OK** at `99195ae` ([report](https://github.com/chrhicks/vela/pull/86#issuecomment-5923065413)).
The final whole-application review with Chris remains required.

The twelve PNGs show the actual saved-image route in light/dark at 1440×900,
900×900 and 390×782, current and original-preview fallback. The parent inspected
all twelve after review, comparing desktop with frozen Paper 03.4 and compact/
fallback with the accepted Photographs workshop specimen. Nineteen gallery
checks passed again after the verdict. Twelve supplemental rendering checks
passed after waiting for decoded images, available inspection controls, fonts
and finite animations. Six geometry records supplement those images; the two
900px records came from a temporary extension of the gallery geometry checks
against the same application head.

Desktop retains source columns 260/736/324 at x=36/320/1080, y=172; rows 85px,
viewer 644px, toolbar 54px and image area 532px. The image is uncropped. The
six-row list extends to 650px as in the source arithmetic. At 900px the list
remains alongside the viewer and details continue below it; phone order is
preview, details, dated list with explicit jump/selection focus.

Recorded source substitutions: the shared Appearance action; fixture camera
name labels the image as a reference; actual saved-exposure and preview-version
caption; omitted design-study footer. The fallback sheet’s notice fits the
actual detail column and grows with text, with exactly one original-FITS action
and the matching original-preview PNG. These follow the evaluated workshop.
The synthetic FITS is not the scientific original of the reference JPEG.

Native collaborative browser inspection at 900px confirmed loaded fonts,
decoded 1280×1224 selected pixels, one main landmark and no horizontal overflow.
Its snapshot tool failed; a later resize timed out and navigation explicitly
reported no automation host. Final raster evidence therefore comes from the
project’s browser harness, not a claimed native screenshot.

To reproduce the supplemental PNGs, copy `capture.e2e.ts.reference` to
`apps/web/tests/photographs-visual-check.e2e.ts`, run
`pnpm --filter @vela/web exec playwright test tests/photographs-visual-check.e2e.ts`,
then remove that temporary copy. It uses the existing project fixture registry
and makes no application changes. For interactive review run
`pnpm exec tsx scripts/review-fieldroom.mts` and open
`http://127.0.0.1:5176/__review/scene/photographs-light` (or `photographs-dark` /
`photographs-fallback`). Use Appearance for a dark fallback.
