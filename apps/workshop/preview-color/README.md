# Retained-preview color experiment

**September 21: Chris selected B and Match display.** Production adoption now
uses the same treatment at the imaging boundary and versioned saved previews;
see [saved-image ownership and review](../../server/src/saved-images/README.md).
The account below preserves the initial workshop experiment at `59fa6da`.
A is frozen in `legacy-preview.ts`; B delegates to the one production renderer.
This remains a display treatment, not scientific color calibration, denoising
or optical improvement. Original workshop image bytes are unchanged.

## Open and reproduce

From the repository root, with the retained local `data/` corpus present:

```sh
pnpm --filter @vela/server exec tsx ../workshop/preview-color/generate.ts
pnpm --filter @vela/workshop exec vite --host 127.0.0.1 --port 5185 --strictPort
```

[Desktop, cooled Veil](http://127.0.0.1:5185/?component=panel&specimen=panel-preview-color&profile=vela-current&mode=dark&context=isolated&viewport=1280&prop.fixture=cooled&prop.scale=fit)
· [Phone-width, native trails](http://127.0.0.1:5185/?component=panel&specimen=panel-preview-color&profile=vela-current&mode=dark&context=isolated&viewport=390&prop.fixture=trails&prop.scale=native)

Select **Vela Current**, dark, density 1, no unsaved overrides or baseline
comparison. The specimen URL records fixture and scale. Fit compares the whole
sensor field; **100%** pans both images together, with a center reset; Thumbnail
uses a 240px-wide fitted derivative. Phone-width uses vertically stacked views.
The input identity and SHA-256 are under **Source identity and treatment**.

Useful judgment sequence: cooled Veil fit/thumbnail, pre-focus then warm
post-focus at 100%, ordinary starfield fit/100%, dark fit, trails at 100%.
Ask whether B makes inspection easier without hiding faint structure, noise or
defects. A visually attractive color is not evidence of calibrated color.

## The hypothesis

- **A:** call the existing `capturePreviews` unchanged. Shared raw-sample 1%
  black point and 99.9% ceiling (minimum range 100 ADU); linked asinh strength 10.
- **B:** reuse the imaging boundary's bilinear Bayer reconstruction, linked
  stretch and PNG encoder. Sample roughly 16 × 16 points per spatial tile on an
  8 × 8 grid. Choose the dimmest 16 tiles by summed channel medians, then estimate
  each channel's background from those same tiles. Subtract excess above the
  lowest channel, capped at **10% of the existing linked display range**.
  Keep A's black point, ceiling and curve exactly the same.
- No channel gains, channel min/max stretches, gray-world balancing, gradient
  removal or calibrated-color claim. The offset cap is an exploratory conservative
  limit, not an experimentally universal constant. Field-filling emission can
  bias even the dim tiles. No automatic estimator can establish empty sky here.
- Mono and insufficient/invalid background estimates have explicit unchanged
  fallbacks. A blank equal-channel image needs no correction. FITS parsing admits
  only the known Vela single-block-header signed32, unscaled TOP-DOWN format, up
  to 30 million samples. Other FITS variants fail explicitly; this is not the
  future production FITS reader or the parallel unsigned16 work.
- Only one full 8-bit display buffer is reconstructed; no full-frame float RGB
  arrays. Rendering, reduction and existing PNG compression yield. Fit averages
  the very same displayed pixels; native inspection is not a separate stretch.

## Local corpus and provenance

All six are real ASI2600MC Pro exposures, 6248 × 4176 RGGB, retained in this
Rift's copied `data/`. `corpus.ts` fixes the source identities. No image binaries
are committed: these are private observing artifacts, not publicly licensed
illustrative assets. The generator reads only the selected originals and writes
derivatives plus a manifest under ignored `apps/workshop/.local/preview-color/`.
It hashes each original before/after and, for saved images, the retained native
PNG, fit PNG and metadata before/after. It does not write in `data/`.

The dev-only `/__preview-color/` endpoint admits GET of exactly that manifest
and the 24 selected derivative filenames. It does not accept a caller-supplied
source path, serve FITS/metadata files, write files or regenerate on request.
Responses use `no-store` because prototype derivatives can be regenerated.
Absent local data, the specimen reports the missing corpus; no synthetic image
is silently substituted. The production build contains the specimen but no
private fixture bytes, and this endpoint exists only on the Vite dev server.

| Fixture | Source / observing context | SHA-256 of original FITS |
|---|---|---|
| starfield | `alignment-diagnostics/production-wide-2026-09-10T02-30-42.975Z/position-1.fits`; 2s polar field, filter not recorded, strong spatial background band | `5c22dcd2e60768d3811d10cdc0376dd3f00b5b913d2dbba3f3120a30d73d5d4f` |
| prefocus | `7e323d80-4151-48d8-b12c-21502f4f23fb`; Sept 15 03:00 UTC, 180s before recorded filter autofocus | `a6492c00c8fb5c2572d120df731faeca0871127067e828064f2642a382a21a45` |
| warm | `d4442483-0b69-40c0-a14b-948251fadc37`; 03:13 UTC, first focused L-Ultimate 180s, cooler later found off | `04a98b45855a07051a95241a3a800b48433583f622d22d8ee6314bdf8b32dcb6` |
| cooled | `47d1a817-c7a6-4498-b064-ab29fb80e5ec`; 03:32 UTC, 180s, observing log reports 5.0–5.1°C | `b777fd880dfeb0113c571631864e6fc45def1871d30cc12293c2d40042988d96` |
| dark | `37afe1c9-db83-49ad-b26a-1d33d7b47f39`; Sept 15 15:07 UTC, 180s dark acquisition | `055093578f3bd15ea05c4454a0cab53d3dab90f1ac15398abd80b8144d5a5b91` |
| trails | `684efeca-fe53-47ac-a352-d9c59afb3567`; 06:09 UTC 180s, rejected from stacks after long trails | `be0d4ef414b35d6af941caedbe7f38ba1d09aa6e305742b762a0d1b1e07f0817` |

Context comes from local `data/observing-20260914/OPERATIONS.md`,
`rejected-frames.json`, the saved metadata and the dark-session records. Thermal
context is historical logging, not a temperature measured by this prototype or
stored in these FITS. No physical device commands are involved.

## Findings and recommendation

**Recommend B for Chris's visual choice**, retaining the conservative cap.
Cooled/warm Veil backgrounds lose the distracting green cast while red/cyan
filaments remain visible. Pre-focus discs and post-focus cores remain visibly
distinct; the treatment does not fix focus. The dark is essentially unchanged.
The short polar exposure remains noisy and its broad spatial band remains. B
hits the cap there, leaving some green rather than forcing a neutral mean. The
trailed field retains both its trails and a residual spatial color imbalance.
Do not solve either by escalating this into white balancing or gradient removal.

For the cooled frame B subtracts `[0, 8, 0.25]` ADU. Full-frame displayed medians
change from `[48, 66, 48]` to `[48, 48, 48]`; these are descriptive values, not
the algorithm's target or evidence of color accuracy. On the polar field,
`[128, 161, 111]` becomes `[115, 131, 111]`, showing the intentionally incomplete
correction. On the dark, `[62, 61, 64]` becomes `[61, 61, 62]`.

## Retained-preview decision — selected, now adopted at the saved-image boundary

Keep the original FITS **and original PNG bytes** as provenance. If Chris
chooses a treatment, generate an explicit renderer-versioned native/fit pair
beside them, publish that pair through an atomic descriptor, and use
version-specific URLs to respect today's immutable caches. Refresh in a bounded
maintenance operation; never regenerate the whole archive on a GET. Unsupported
originals should keep a clearly identified legacy preview.

Chris chose **Match display**: the default preview download matches the refreshed
displayed treatment, while the first PNG remains physically preserved. The
production owning boundary implements bounded per-image lazy publication rather
than whole-archive migration. Solver and statistics behavior remain unchanged.

## Production adoption evidence — September 21, 2026

The adoption was built on the dependency merge `2a6862c` (root recovery head
`23b6b07`), retaining workshop commit `1f08014`. The separate FITS-compatibility
workstream's owning README supplied the dual-encoding contract; its implementation
and tests were not copied. No hardware or original-checkout writes were involved.

- Full lint: zero findings. Full model type contracts and Vitest: **806 tests in
  82 files passed**. `pnpm check` then exposed the specimen's optional callback
  incompatibility under strict optional-property checking. After that type-only
  fix, `pnpm build` passed all workspaces. Existing Vite config-loader / chunk-size
  warnings remain.
- Prototype typecheck passed with
  `pnpm --filter @vela/server exec tsc -p ../workshop/preview-color/tsconfig.json`.
  The review script also passed strict checking with the server's `tsc
  --ignoreConfig --noEmit --target ES2023 --module NodeNext --moduleResolution
  NodeNext --strict --noUncheckedIndexedAccess --exactOptionalPropertyTypes
  --skipLibCheck scripts/preview-review.ts`.
- Production native and fit PNGs match the approved B files **byte for byte for
  all six real frames**, including the ordinary polar starfield. Five retained
  frames were opened through actual production saved-image routes and rendered at
  Fit and 100%. Browser-clicked downloads matched their current native PNG bytes.
- An accelerated device-free capture through production capture routes/controller
  replayed the cooled frame, saved it with the current version and rendered it in
  Capture. It matched approved B exactly; statistics also remained exactly
  539 stars / 4.505360069191548 HFR pixels. This is replay evidence, not a new
  physical exposure. Result ID: `30d39e02-bbaa-4921-afed-4415f4e18aee`.
- Original FITS, first native/fit PNG and metadata hashes stayed unchanged for all
  five retained sources and their review copies. Tests additionally cover
  independent signed32 / offset16 construction, cache URL pinning, descriptor
  restart reuse, concurrent refresh coalescing, hidden partial publication,
  simulated derivative disk failure and retry, unsupported-original fallback,
  and new captures reusing their already-correct first PNG.
- Playwright inspected the production collection thumbnails, unavailable-refresh
  state, fresh capture and a 390px saved-image detail. No page errors or mobile
  horizontal overflow. Representative desktop, phone-width, collection and fallback
  screenshots were visually inspected. Evidence is local under
  `apps/workshop/.local/preview-adoption/evidence/`, notably
  `production-results.json` and `preserved-originals.json`.
- Focused `standards_check` batches remain **incomplete**, not clean reviews:
  imaging `72549358…` timed out; storage `d2a7003a…` returned an unverified source
  citation; routes/web `2657297f…` returned a malformed report (missing
  `missingEvidence`). Evidence files are in `.opencode/.local/standards/`.
  No unchanged batch was retried to obtain a preferred verdict.

The parent owns sequential integration, independent repository verification and
Chris's production browser acceptance. Neither an independent **OK** verdict nor
production acceptance is claimed here. The phone evidence is Chromium at 390px,
not physical-phone validation. Runtime instructions and URLs are maintained in
the saved-image README linked above; the original comparison stays on port 5185.

## Focused evidence

```sh
pnpm exec vitest run apps/workshop/preview-color/treatment.test.ts
pnpm --filter @vela/workshop exec tsc -p preview-color/tsconfig.json
pnpm --filter @vela/workshop build
pnpm lint
node apps/workshop/preview-color/inspect.mjs
```

The numerical suite covers all four Bayer patterns/borders, gradients, retained
red/blue source color, bounded correction, mono/blank/invalid-background fallback,
input immutability, fitted averaging and the signed32 reader's format rejection.
The browser script checks all six sources × three scales × desktop/phone-width,
native scale, synchronized panning, no specimen overflow, missing-source/write
route rejection and browser errors. Screenshots/results remain ignored in
`.local/preview-color/evidence/`.

An independent Astropy/NumPy/Pillow check of this corpus confirmed every decoded
original sample, all original/retained-artifact hashes, and equality of A's
decoded native pixels with all five already-saved native PNGs. An independently
written RGGB bilinear/asinh calculation matched 1,116 RGB locations per frame
for both treatments. Its local report is `.local/preview-color/independent-reference.json`.
This is an independent numerical reference, not a calibrated-color comparison
against Siril. No Siril viewer or physical observing validation was performed.

Executed on September 21: eight numerical tests passed, the prototype typecheck
and workshop build passed, and full repository lint reported no findings. Vite
reported existing native-config-import and bundle-size warnings. All 36 browser
comparisons passed in headless Chromium and representative screenshots were
visually inspected. The phone evidence uses the workshop's 390px simulated
viewport, not a physical phone. Desktop-browser tools were disconnected in this
subagent session, so rendering and interaction proof used Playwright.

`standards_check` was invoked on the source batch, then on subsequently changed
generator/test/inspection files. Both returned **incomplete / TimeoutError**,
with no completed diagnostics. This is not a clean standards verdict. Local
evidence IDs: `4eed8dca-84e1-47e9-9cb8-b8ad4aae41ab` and
`e477ae58-5d07-4083-9649-ecb42a26809e` under `.opencode/.local/standards/`.

This is a workshop choice handoff, not implemented-product browser acceptance.
Production adoption still needs its boundary tests, independent verifier and
Chris's implemented-app acceptance under the repository workflow.
