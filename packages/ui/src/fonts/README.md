# Local UI fonts

## Fieldroom

Fieldroom uses Barlow for body/controls and Space Grotesk for headings/metrics.
The files below are full faces pinned to exact source revisions. Barlow uses
the Google Fonts 1.408 release, compressed from its TTF files with `woff2_compress`;
Space Grotesk uses its author's unmodified WOFF2 files. Their SIL Open Font License 1.1 texts are
included as `Barlow-OFL.txt` and `SpaceGrotesk-OFL.txt`.

| Family / weight | File | Upstream source |
| --- | --- | --- |
| Barlow 400 | `Barlow-Regular.woff2` | [google/fonts](https://github.com/google/fonts/tree/6cdf01867df0813c2390f90dff7dc66c87f14cf7/ofl/barlow) |
| Barlow 500 | `Barlow-Medium.woff2` | Same pinned directory |
| Barlow 600 | `Barlow-SemiBold.woff2` | Same pinned directory |
| Space Grotesk 400 | `SpaceGrotesk-Regular.woff2` | [floriankarsten/space-grotesk](https://github.com/floriankarsten/space-grotesk/tree/03507d024a01282884232081fc6011c09ff4e849/fonts/woff2/static) |
| Space Grotesk 500 | `SpaceGrotesk-Medium.woff2` | Same pinned directory |

Declare each static weight separately with `font-style: normal` and
`font-display: swap`. Do not declare a weight range on these static files or
substitute a variable font with different metrics. Await `document.fonts.ready`
before visual comparisons. The shared stylesheet owns font-face declarations;
theme parameters select the body and heading families independently.

Barlow's version is intentional: Paper's approved button metrics match the Google
Fonts release, not upstream Barlow 1.422. At 15px/500, “Start capture” has a
shaped advance of 87.48px with this face and 85.005px with 1.422. Do not upgrade
the font independently of visual reference review. WOFF2 conversion changes the
container, not glyph outlines, advances, or OpenType shaping tables.

To reproduce the Barlow assets, download `Barlow-Regular.ttf`,
`Barlow-Medium.ttf`, and `Barlow-SemiBold.ttf` from the pinned directory, then
run `woff2_compress Barlow-Regular.ttf` (and the equivalent command for each
other weight). Keep the accompanying `OFL.txt` as `Barlow-OFL.txt`. The encoder
is Google's `woff2` 1.0.2; do not subset the faces or change their metrics.

## Inter

These unmodified variable WOFF2 files come from the `web/` directory of the
[official Inter 4.1 release](https://github.com/rsms/inter/releases/tag/v4.1).
The accompanying `LICENSE.txt` is the release's SIL Open Font License 1.1.

The shared UI stylesheet serves normal and italic weights 100–900 locally under
the existing `Inter` family name. Both Vela and the workshop bundle these assets,
so typography does not depend on installed fonts or an external font service.
Do not add a `local()` source: it could select a different installed version.
