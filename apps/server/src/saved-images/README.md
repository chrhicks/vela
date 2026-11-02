# Saved images

This boundary retains a completed acquisition as original lossless integer FITS,
a fitted PNG and image metadata. Full-size display JPEGs are rendered on demand. It stores
artifacts, not capture runs. A repeated save of the same rig/frame returns the
existing artifact, including when manual and automatic saving overlap.

The file store hashes rig and frame identifiers into path segments. Each save
writes and syncs files in a private staging directory, syncs that directory, then
atomically renames it into the completed collection and syncs the parent.
Readers only consider completed directories. Interrupted staging directories
remain invisible after restart; they are not resumable saves. File errors reject
the save so orchestration can report the failure instead of claiming retention.

FITS export preserves row-major acquisition samples exactly, including negative
signed values. It records the UTC exposure start, duration, camera, `ROWORDER`
as `TOP-DOWN`, and the acquisition adapter's already origin-adjusted Bayer pattern
when present. It does not stretch, debayer, calibrate, or guess sensor metadata.
Preview downloads are separately processed display images. Large FITS encoding
yields between batches so the server can continue serving device/status work.
The shared [imaging encoder](../imaging/README.md#lossless-fits-interchange) uses
unsigned 16-bit FITS when all samples fit, otherwise signed 32-bit. Existing
retained originals and their download bytes are never converted in place.

The memory implementation has the same API for isolated application tests. The
production composition must open the file implementation at its persistent data
directory; no retention database or deletion workflow is introduced here.
The server defaults to `saved-images/` beside its Rig catalog (normally
`data/saved-images/`). `VELA_SAVED_IMAGES_PATH` overrides this directory. Isolated
review catalogs therefore keep review artifacts separate from the main catalog.

The per-rig web routes list and inspect retained metadata without inspecting
hardware. File routes serve the original FITS, fitted PNGs and on-demand native JPEGs.
Collection thumbnails only request fitted PNGs. New images retain
an optional `subject` snapshot of the selected target ID, name and catalog identity.
It records observing intent, not a measured pointing or solved frame. Explicit null
means no chosen subject; absent legacy metadata remains valid and is not rewritten.
New images also keep `provenance`, the rig service's request, operation and image IDs for the
exposure. Null means the camera adapter carries none (Alpaca). Absent legacy metadata means
unknown, and is not rewritten. The same IDs appear in the capture frame record
(`docs/local-tracing.md`).
Every image records its `frameType`: `light`, `dark`, `flat`, `dark-flat` or `bias`.
Metadata saved before frame types existed has none and reads as `light`; reading it
does not rewrite the file. The FITS `IMAGETYP` card carries the same type (`LIGHT`,
`DARK`, `FLAT`, `DARKFLAT`, `BIAS`). Originals saved before this have no card; they are
lights. A calibration image has a null `subject`. The library groups calibration
frames by type, never under a target (see [photographs](../../../web/src/features/photographs/README.md)).
Collection and detail projections include the Vela server's system `timeZone`.
The browser uses this explicit zone for capture dates, times and noon-to-noon
observing-night groups, consistently across clients. It is labeled server time,
not an inferred observatory location. Night/target groups are presentation derived
from these timestamps and optional subject identities, not persisted sessions or
run history. Changing the server time zone changes those presentation groups,
without modifying artifact metadata.

Estimated exposure starts retain `capturedAtSource: server-estimate` in metadata.
Their FITS `DATE-OBS` uses that same start, with `TIMESRC = SERVER-ESTIMATE` and a
comment explaining the server UTC estimate before StartExposure. Legacy metadata
without a source remains camera-reported; reading it does not rewrite files.

## Current previews, immutable originals

New saves store `original.fits`, `fit.png`, `metadata.json` and a source-FITS
SHA-256 descriptor in `previews/background-v2/manifest.json`. Small images use
their native PNG as the fit. No save or refresh writes `preview.png`.
The production files live on `/mnt/storage/vela/saved-images`, mounted in the
server container at `/data/saved-images`.

Full-size preview and download routes, both versioned and unversioned, read the
original FITS and apply the existing stretch and debayer. They encode JPEG at
quality 90 with 4:4:4 chroma through sharp. Downloads have a `.jpg` extension.
No JPEG is written to disk. One store-wide queue serializes retained FITS decode,
stretch and encode with fitted-preview refreshes. Concurrent full-size requests
for one image share a promise, removed at completion. Decoded frames and JPEGs
are not cached after the response.

The renderer version is `background-v2` because the stored layout now contains
only a fitted preview. Existing `background-v1` descriptors still locate their
root or versioned `fit.png`. Old v1 URLs remain accepted. Neither layout reads or
requires an old `preview.png`; those files can be removed separately after deploy.
There is no cleanup script or cache in this change.

Opening an image with no descriptor prepares only its fit and descriptor in an
atomic staging directory. Library listing describes files without rendering.
Thumbnails never fall back to full-size routes. Capture and observe viewers request
fitted images by default. The inspection viewer holds the selected exposure when
100% is requested, so new captures do not start full-size saved-image renders.
The fit stays visible with the existing full-resolution loading message while a
JPEG renders. Missing or unreadable originals return the existing unavailable
response, and the viewer keeps its fit and shows its load failure message.

## Device-free adoption review

From the repository root (with copied local retained data and workshop fixtures):

```sh
pnpm --filter @vela/server exec tsx scripts/preview-review.ts
API_PROXY_TARGET=http://127.0.0.1:5192 pnpm --filter @vela/web exec vite --host 127.0.0.1 --port 5193 --strictPort
node apps/workshop/preview-color/inspect-production.mjs
```

The review runtime copies five retained sources into ignored
`apps/workshop/.local/preview-adoption/saved-images/`, preserves their original
bytes, and registers production capture/saved-image/navigation routes. The only
camera is an injected read-only replay of cooled frame `47d1a817…`; the rig is
visibly named **Preview review · retained-frame replay** and has no real device
adapter. Replay is accelerated, not a new sky exposure. A deliberately unsupported
review file exercises honest fallback without damaging any retained source.

Open `http://127.0.0.1:5193/rigs/348c775f-d075-4cfe-90a3-b8e74d84b244/observe/saved-images`.
The same prefix with `/capture` supports new one-shot replay captures (uncheck
Repeat until stopped). Download a full-size JPEG, inspect fit/100% and collection
thumbnails, and open `unsupported-review-fixture` to inspect the legacy fallback.
Screenshots and hash/byte-equality results live in the ignored review `evidence/`
directory. This runtime is restartable and isolated from the real Rig catalog.
