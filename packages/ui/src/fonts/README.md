# Local UI fonts

## Fieldroom

Fieldroom uses Barlow for body/controls and Space Grotesk for headings/metrics.
The files below are unmodified full WOFF2 faces from their authors' repositories,
pinned to exact source revisions. Their SIL Open Font License 1.1 texts are
included as `Barlow-OFL.txt` and `SpaceGrotesk-OFL.txt`.

| Family / weight | File | Upstream source |
| --- | --- | --- |
| Barlow 400 | `Barlow-Regular.woff2` | [jpt/barlow](https://github.com/jpt/barlow/tree/dc2940e2e04ef4ec96c07e23e0f02aefbddd343b/fonts/woff2) |
| Barlow 500 | `Barlow-Medium.woff2` | Same pinned directory |
| Barlow 600 | `Barlow-SemiBold.woff2` | Same pinned directory |
| Space Grotesk 400 | `SpaceGrotesk-Regular.woff2` | [floriankarsten/space-grotesk](https://github.com/floriankarsten/space-grotesk/tree/03507d024a01282884232081fc6011c09ff4e849/fonts/woff2/static) |
| Space Grotesk 500 | `SpaceGrotesk-Medium.woff2` | Same pinned directory |

Declare each static weight separately with `font-style: normal` and
`font-display: swap`. Do not declare a weight range on these static files or
substitute a variable font with different metrics. Await `document.fonts.ready`
before visual comparisons. The shared stylesheet owns font-face declarations;
theme parameters select the body and heading families independently.

## Inter

These unmodified variable WOFF2 files come from the `web/` directory of the
[official Inter 4.1 release](https://github.com/rsms/inter/releases/tag/v4.1).
The accompanying `LICENSE.txt` is the release's SIL Open Font License 1.1.

The shared UI stylesheet serves normal and italic weights 100–900 locally under
the existing `Inter` family name. Both Vela and the workshop bundle these assets,
so typography does not depend on installed fonts or an external font service.
Do not add a `local()` source: it could select a different installed version.
