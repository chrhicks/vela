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
