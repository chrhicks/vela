# Saved images

This boundary retains a completed acquisition as original lossless integer FITS,
the native processed PNG, an optional smaller PNG, and image metadata. It stores
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
hardware. File routes serve the original FITS and exact native preview downloads;
the optional fitted preview is used for collection thumbnails. There is no target
grouping until capture has actual target metadata, and no run history is inferred
from the image collection.

Estimated exposure starts retain `capturedAtSource: server-estimate` in metadata.
Their FITS `DATE-OBS` uses that same start, with `TIMESRC = SERVER-ESTIMATE` and a
comment explaining the server UTC estimate before StartExposure. Legacy metadata
without a source remains camera-reported; reading it does not rewrite files.

## Current previews, immutable originals

Display rendering is separate from durable capture facts. Original FITS,
`preview.png`, `fit.png` and `metadata.json` are never rewritten by preview refresh.
The legacy `/preview`, `/fit`, `/download-preview` and `/fits` routes keep serving
those same bytes, respecting their immutable cache contract.

Opening a saved-image detail lazily prepares `background-v1` if absent. Collection
listing only describes published previews: older thumbnails are explicitly labeled
as original until that image is opened, then use its current fitted derivative.
This avoids an unbounded archive conversion on a collection GET. One file-store
instance owns a shared per-image promise and serial refresh queue, so simultaneous
detail requests share work and only one retained original is decoded at a time.
The application composes one file store; this is not a multi-process job system.

Refresh reads a bounded, validated Vela FITS, verifies dimensions and color against
the retained metadata, then uses the production renderer. It writes and syncs the
native PNG, optional fit PNG and source-FITS SHA-256 descriptor in an ignored staging
directory. One directory rename publishes the complete `previews/background-v1/`
pair; no partial version is advertised. Completed versions survive restart and are
reused. Interrupted staging directories remain invisible. A refresh failure returns
an explicit unavailable state with the original view/download, logs its cause and
does not overwrite or claim to have corrected the old preview.

New captures declare their renderer version when saving. Their first PNG already
has the selected treatment, so a descriptor references the original native/fit pair
without duplicating large PNGs. Those descriptors are inside the original save's
atomic staging publication. The memory store models new capture retention and
versioned URLs for isolated tests; retained-file regeneration belongs to the file
implementation.

Current image/fit/download URLs include `/previews/background-v1/`. Unknown versions
are rejected. Metadata responses use `no-store`; version-specific files stay
immutable. The default PNG download is exactly the current native displayed
treatment, not the old PNG. The first PNG remains physically preserved and reachable
through the legacy URL. This **Match display** behavior was explicitly selected
with treatment B in the workshop; it is not a change to original FITS samples or
capture metadata. `SavedImage.previewRendering` communicates current, legacy or
unavailable rendering independently of image capture facts.

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
Repeat until stopped). Download a refreshed PNG, inspect fit/100% and collection
thumbnails, and open `unsupported-review-fixture` to inspect the legacy fallback.
Screenshots and hash/byte-equality results live in the ignored review `evidence/`
directory. This runtime is restartable and isolated from the real Rig catalog.
