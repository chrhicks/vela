# Equipment, Home and onboarding acceptance evidence

Accepted by the parent under Chris’s intermediate-slice authorization after
independent **OK** at `a50c6bb` ([report](https://github.com/chrhicks/vela/pull/86#issuecomment-5923065413)).
Final whole-application acceptance by Chris remains required.

The PNGs show actual application routes and dialogs against deterministic API
fixtures, not hardware observations. Main surfaces cover 1440, 900 and 390px in
both palettes. Onboarding includes Review and address validation at those widths,
focused address variants, and phone empty-scan/unreachable states. Supplemental
captures show retained expanded telemetry during interrupted reads and the Forget
confirmation at desktop and phone widths. Main surfaces use full-page captures;
Forget uses viewport captures after scrolling to its opener. No mock phone OS
strip is implemented; onboarding phone viewports are 390×782.

The parent inspected the paired raster evidence after the independent verdict,
comparing frozen Paper 03.5, 03.8, 03.12, 03.13 and 03.15 with the approved compact
workshop compositions. Post-review checks: 26 main/onboarding rendering cases
and four supplemental interruption/Forget cases passed. The independent reviewer
also passed 911 project tests/builds, 108 app browser checks, 46 workshop checks
and four Python checks. Production did not change after the verdict.

At desktop Equipment retains x36/y182 readiness 888×106, four 100px device rows,
and x952/y182 imaging setup 452×679. Preparation starts y770, and the collapsed
Rig details footer preserves the 921px default page. First-night illustration
panel is 888×536 at x36/y256; the right column is 452px. Review is 624×616 for the
four-device fixture. Geometry JSON records accompany the main captures. Their
body font field reads the document body default; actual Home/Equipment content
uses the scoped Barlow treatment. Font loading was separately confirmed.

Source substitutions are intentional facts: camera Connected rather than an
unsupported Ready assertion; Other camera rather than an invented guide role;
reported tracking rather than unavailable pier side; actual disconnected count;
shared Appearance trigger; Rig details rather than a study caption. Home says
latest exposure appears in Tonight, and saved-rig cards use actual connection
counts and last-seen observations rather than unavailable endpoint/camera fields.
Fixtures include an unknown saved rig and an unreachable rig. The address-error
focused variants retain the focus ring; the unfocused variant matches the source
with its keyboard dismissed. Declared color tokens govern comparison: the frozen
Paper PNG color profile differs from the browser raster, so raw pixel subtraction
is not a reliable color criterion.

Native collaborative-browser DOM inspection at 1280×800 confirmed loaded Barlow
and Space Grotesk, one main landmark, no horizontal overflow, and expanded camera
telemetry. Its resize repeatedly timed out and snapshot failed; earlier navigation
explicitly reported no automation host. Final raster evidence therefore comes
from the project Chromium harness at DPR 1, not native screenshots. The native
browser used DPR 1.5, so fractional border rounding is expected there.

Reproduce main images with `tests/fieldroom-equipment.e2e.ts` (reference layout)
and `tests/rig-onboarding.e2e.ts` (review/address and empty/unreachable layout).
For supplemental images, copy `capture.e2e.ts.reference` to
`apps/web/tests/equipment-visual-check.e2e.ts`, run
`pnpm --filter @vela/web exec playwright test tests/equipment-visual-check.e2e.ts`,
then remove the temporary copy. The fixture registry rejects unmapped requests.
No physical device writes are needed. Interactive scenes run through
`pnpm exec tsx scripts/review-fieldroom.mts`, for example
`http://127.0.0.1:5176/__review/scene/equipment-connected` and `home-no-rigs`.
