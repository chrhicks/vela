# Lossless FITS interchange validation — September 21, 2026

Implementation evidence for the scoped unsigned-16 encoder change, based on
`59fa6da`. The format contract lives in the
[imaging README](../../apps/server/src/imaging/README.md#lossless-fits-interchange).
This is executed local evidence, not the independent verifier's verdict or
Chris's browser acceptance. Those remain the integration parent's gates.

## Automated checks

From the `fits-compatibility` Rift:

```sh
pnpm exec vitest run apps/server/src/imaging/fits.test.ts apps/server/src/capture/controller.test.ts apps/server/src/capture/routes.test.ts apps/server/src/saved-images apps/server/src/plate-solving
pnpm --filter @vela/model build
pnpm --filter @vela/alpaca build
pnpm --filter @vela/server build
pnpm lint
```

- 60 tests passed in 5 files. Encoder coverage includes all 65,536 unsigned
  values, signed extremes, late negative/65536 fallback, nonfinite/fractional/
  out-of-range rejection, unchanged input arrays, padding, endianness, exposure
  provenance, all four Bayer patterns, and yielding during both validation and
  writing for both storage widths.
- Model, Alpaca and server builds passed. The dependency builds replaced copied
  output containing inherited recovery-only contracts; no dependency source was
  changed. Initial dependency relocation needed `CI=true pnpm install
  --frozen-lockfile` inside the Rift.
- Lint passed with zero warnings/errors.
- `standards_check` completed with zero diagnostics for all five changed TS
  files, then for the updated encoder/yielding tests. Final snapshots are in
  `.opencode/.local/standards/edf1bb20-f5a9-4135-acab-8d5823c5053e.json` and
  `8007a979-eda0-4647-aa22-828f407299d3.json`.

## Independent decoding and real-frame replay

Local, Git-ignored scripts and outputs are under
`data/fits-unsigned16-review/` in
`/home/chicks/dev/personal/.rifts/vela/fits-compatibility`. They read original
files under `/home/chicks/dev/personal/vela/data/` without modifying them.
No hardware commands were used.

The corpus is the three cooled frames listed by
`data/observing-20260914/cooled-first-3/manifest.json`, plus the previously solved
`data/observing-20260914/recovery/check.fits`. Each is 6248 × 4176, or 26,091,648
samples. `prepare.py` independently reads them with Astropy, records SHA-256
hashes and provides linear integer arrays to `replay.mts`, which invokes the
actual Vela encoder and, for the solved exposure, `createAstapSolver`.

`verify.py` with **Astropy 8.0.1 / NumPy 2.5.3** verified:

- Every sample equals the corresponding original, in the same array position,
  for all four frames. The in-memory source arrays also retain their hash after
  encoding. The original files retain their recorded SHA-256 hashes.
- DATE-OBS, EXPTIME, INSTRUME, ROWORDER, BAYERPAT, TIMESRC and COMMENT are
  preserved. Astropy's strict FITS verification passes.
- Each file falls from 104,371,200 to 52,188,480 bytes, including padding.
- Separately generated all-unsigned-values and signed-extremes fixtures decode
  with every value equal, as `uint16` and signed `int32` respectively.

The local ASTAP CLI and catalog under `apps/rig-simulator/.local/assets/`
solved the re-encoded retained exposure through Vela's production solver.
The returned center is RA 312.82258922430606°, Dec 30.47734038140892°.
Separation from the retained prior solution is **0.0 arcsec**; its CD matrix
also agrees (the check permits small numerical differences).

As an external orientation check, catalog 52 Cyg coordinates
(311.415638°, 30.719714°) project to zero-based array position
(2003.3305, 4106.6256). The observed star peak is within 3 pixels, at 27,619 ADU
against a 511 ADU local median. The vertically reflected position peaks at only
719 ADU. This star is not saturated in this exposure; saturation was not used
as the acceptance criterion. See `astap-result.json` and `verification.json`.

**Siril 1.4.4**, from the copied local AppImage installation, imported/debayered
the three cooled frames and registered **3/3, zero failures**, with no
`not suitable for sequence operations` warning. A separate explicit Siril
load/save of each raw image preserved every ADU value. All interior original
RGGB photosites match their corresponding debayered channels, excluding the
20-pixel interpolation border. See `process.ssf`, `raw-roundtrip.ssf`,
`siril.log`, `siril-raw-roundtrip.log`, `verify-siril.py`, and
`siril-verification.json`. Registered/interpolated pixels are not claimed to
remain equal to raw data.

## Prepared download/import acceptance

`seed-review.mts` created an isolated saved-image collection using the ordinary
file store: `u16-1`, `u16-2`, `u16-3`, and an unchanged copy `legacy-int32` of the
first original. Original preview files were copied exactly. The isolated Rig
is named **FITS interchange review — retained replay**, with no devices and a
loopback-only placeholder endpoint.

The review server/web were started on **5182/5183**. HTTP checks confirmed four
collection records and successful page/download responses through the web proxy:

- `http://127.0.0.1:5183/rigs/fits-review/observe/saved-images/u16-1`
- `http://127.0.0.1:5183/rigs/fits-review/observe/saved-images/legacy-int32`

The unsigned download is `application/fits`, attachment disposition, 52,188,480
bytes, SHA-256
`4dddefc37d7f60d77c74b72aa8fc676b8e548e64d662802210e788d996c36b6c`, equal to
the independently checked encoder output. The legacy download retains the
original SHA-256
`a65909f867dbca957628e8585b87949fa9fbac011261aa15ecd84dcf93063dad`.

After verifier OK, accept by downloading the three replayed unsigned images
from Saved images and importing them in Siril; confirm image orientation,
metadata, and absence of the per-frame scaling warning. Download `legacy-int32`
to confirm previously retained original bytes remain unchanged. No new
exposure is necessary. This handoff has HTTP and external-tool evidence;
rendered browser inspection and user acceptance have not been performed here.

If the review processes have ended, use `node apps/server/dist/server.js` from
the Rift root with `PORT=5182`, `HOST=127.0.0.1`, absolute
`VELA_RIG_CATALOG_PATH=data/fits-unsigned16-review/rigs.yaml` and
`VELA_SAVED_IMAGES_PATH=data/fits-unsigned16-review/saved-images`, and empty
`VELA_ALIGNMENT_MODE`, `VELA_ASTAP`, `VELA_STAR_CATALOG`, `VELA_TRACE_PATH`.
From `apps/web`, run `node_modules/.bin/vite --host 127.0.0.1 --port 5183
--strictPort` with `API_PROXY_TARGET=http://127.0.0.1:5182` and empty
`VELA_LAN_HOST`. Resolve both data paths to absolute Rift paths before launch.
