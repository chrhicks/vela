# Tonight and Appearance acceptance

Reviewed implementation: `032c8b1`. Fresh independent review returned **OK** on
[PR 86](https://github.com/chrhicks/vela/pull/86#issuecomment-5923065413), then the
parent completed the final visual comparison. This accepts the intermediate
Tonight/Appearance slice; later routes and Chris's final acceptance remain open.

## Reproduction and evidence limits

The nine manifest images are unmodified Chromium output from
`apps/web/tests/tonight.e2e.ts`, using the real application routes, frozen clock,
America/New_York timezone, local reference photograph and intercepted HTTP data.
Run `pnpm --filter @vela/web exec playwright test tests/tonight.e2e.ts`.
Desktop captures are 1440×900, interrupted desktop 1440×965, and phone uses a
390×782 viewport with full-page capture. Phone image height includes scrolling;
it is not a claim that all Tonight controls fit on one phone screen.

The reachable native preview at `http://127.0.0.1:5176/__review` used the same
fixture registry. At 1280×800 and DPR 1.5, DOM inspection confirmed loaded fonts
and decoded image, 214px capture-card height, 10px status dot, and no horizontal
overflow. Native snapshot export repeatedly failed with the preview client's
generic snapshot error, even without image output. Retained PNGs therefore come
from the project's browser tests, not native snapshot export. No replacement
browser-automation system was used. These are fixture observations, not hardware
evidence; no physical commands were issued.

## Compared result

Compared frozen app 03.0, 04, 03.10, 03.19 and 03.20, plus the shared Appearance
recipe for compact behavior. The phone Appearance references 03.21/22 sit over
polar alignment; their whole-screen comparison belongs to that later slice.

At 1440px the image card is x36/y116, 888×686, with a 54px toolbar, 560px fitted
image viewport and 70px acquisition region. The interruption recipe retains the
outer card while using 536px pixels and 94px metadata/caption. The right column
starts x952, width452; capture is 214px high with 20/22px insets. Navigation is
88px. Subject uses Space Grotesk 32/40/500; metrics 46/56; body and controls use
the pinned Barlow faces. Appearance is 360px desktop and 350px at phone width,
with 20px phone edge clearance and the source 10px/2px anchor gaps.

Both palettes preserve the same photograph, fitted framing, layout and controls.
The final pass checked wrapping, borders, type, metadata spacing, selected states,
popover position, interruption hierarchy and responsive overflow. Earlier passes
corrected metadata color/spacing, Appearance anchoring and platform-dependent
status glyph sizing; the final reviewed render includes those corrections.

## Intentional source substitutions

- The altitude trace uses supplied night samples and current coordinates. Paper's
  illustrative obstruction line is omitted; no measured local horizon exists.
- Catalog distance is unavailable, and calculation time replaces design-study
  copy. Current direction comes from the coordinate at the observation instant.
- Image details remains a 44px progressive-disclosure action for existing facts.
  Camera cooling remains reachable in the equipment footer. These additions
  preserve operational capabilities absent from the quiet source sketch.
- Reference image/mock-exposure text identifies review imagery. Production
  headings and facts use actual acquisition metadata.
- Interruption age is measured locally. The fixture interrupts capture reads
  while independent navigation/rig reads can still succeed, so confirmed mount,
  focuser and navigation state can differ from Paper's whole-connection example.
  Camera temperature is marked last known when capture observation is interrupted.
- Dark Appearance demonstrates an explicit Dark override; source 03.20 shows
  System resolving dark. Both behaviors are separately exercised by app tests.
- Small raster differences arise from Paper's Display-P3 ICC profile, text
  rasterization and device-scale border rounding. Declared source colors and font
  metrics are the authority; tokens were not altered to match raw PNG channels.

Independent verification passed 865 project tests, lint/type checks/builds,
48 application browser checks, seven workshop checks and four Python tests.
Behavioral checks include server-owned capture, uncertain commands, selected
camera identity, pending target intent, image hold/native decode/pan/expiry/Keep,
palette changes without image/input reset, System preference and persistence.
