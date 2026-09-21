# Alignment image inspection

The route owns polling, commands and the pairing of each loaded solved image with
its measurements and exposure timestamp. `AlignmentImage` only changes its display
viewport. The route keeps enlargement mounted across baseline completion, pinning
the exposure and inspection viewport while polling may publish a newer image
behind it. Dismissal focuses the current enlargement button even if the layout
replaced its element; closing and reopening selects the current displayed exposure. Image-load
retries fetch the same URL and never request acquisition or solving.

The approved polar-alignment workshop defines Fit both with padding and a 4′ context
floor, deliberate 1′ Fine, Full frame, and native pixel inspection. This feature
composes stable Button/Dialog primitives with that specimen's layout and reticles.

The reference is the optical frame center, not a detected star. Target pixels come
from the server's WCS projection. The current model exposes camera field height,
not the full WCS: viewport sizing and the **approximate** angular bar use this
field-to-pixel ratio. No fixture scale or correction-angle-to-pixel inference enters
production. Baseline previews expose no angular field, so unsolved images have no
angular scale or correction markers. Outside-image areas remain blank.

The alignment PNG is a native-dimension display derivative, so 100% is one image
pixel per CSS pixel with its own scroll region; it is not original-FITS processing.
Both inline and enlarged views retain capture age and time provenance. Device-read
retry and browser disconnect remain distinct; enlargement never changes Stop or
the server-owned run. Physical behavior remains in the server's
[alignment contract](../../../../server/src/alignment/README.md).
