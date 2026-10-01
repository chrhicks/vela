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
The compact view shows the last solved frame and its age when retained. Exposure
start provenance, approximate angular scale and native inspection live in the
enlarged dialog. Device-read
retry and browser disconnect remain distinct; enlargement never changes Stop or
the server-owned run. Physical behavior remains in the server's
[alignment contract](../../../../server/src/alignment/README.md).

After an uncertain Stop or Finish response, command entry remains blocked while
reads still report active work. A validated stopped, finished or failed projection
resolves that uncertainty and allows the next deliberate action. A fresh active
read alone does not establish whether cleanup completed, and never permits an
unresolved end command to be repeated.

Fieldroom uses the shared compact preparation navigation on phones and a two-column
image/operation layout on desktop. The optical center is a crosshair; the correction
target is a ring, with constant CSS-pixel glyph sizes and fixed colors over the image
in both appearances. Phone controls preserve Fit both, Fine and Full frame; the
44px Enlarge overlay opens the same exposure. The baseline Stop is above its preview.
Interrupted reads preserve the loaded solve and past-tense corrections; Stop stays
available during device-read retry but is disabled while the browser cannot reach
Vela or while an end command is stopping/unconfirmed. Finish is an operator action,
not an assertion of measured alignment accuracy.
