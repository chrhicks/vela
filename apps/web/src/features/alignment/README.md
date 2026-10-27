# Alignment image inspection

The route owns polling, commands and the pairing of each loaded solved image with
its own correction overlay and exposure timestamp. A fresh correction's readings and
directions appear as soon as the server publishes them; its image follows. Until the
newer frame's fit and detail images load, the image keeps the newest loaded frame with
that frame's overlay and is labelled as an earlier solved frame. A newer correction
cancels an older image load, so a late response cannot replace it. `AlignmentImage` only changes its display
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

Normal views draw the fit image in native image coordinates, with native-resolution
detail around the reference and target for Fit both and Fine. The native-dimension
display PNG loads only for 100%, which is one image pixel per CSS pixel with its own
scroll region and a loading status; it is not original-FITS processing.
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

## Good enough

Chris reaches about two arcminutes of polar error in a few minutes, then spends much
longer chasing the last few arcseconds, where each correction shifts the other axis.
The adjustment readout tells him when to stop. While the latest solved correction is
live and its total error is **under 2 arcminutes (120″, a strict comparison, so exactly
120″ does not qualify)**, a calm "Good enough" note sits under the total and states the
drift that error causes in a 3 minute exposure. It is information only. Measuring
continues, the azimuth and altitude directions stay, and Finish is unchanged.

Polar error E (arcminutes) makes a star drift at most about π/12 × E ≈ 0.2618 × E
arcseconds per minute of exposure, the worst case, when the field sits where the
error does the most damage. At 2′ over 3 minutes that is about 1.6″, under one pixel
on the FRA 400 and ASI2600MC (1.92″ per pixel). The threshold is a constant, not
derived from the plate scale. The alignment view carries camera field height and image
size but not a pixel scale it vouches for, and this change adds no server field. It is a
first guess to tune against real nights. There is no hysteresis: measurements arrive
seconds apart and the note is only information, so a flicker at the edge costs nothing.

The note follows the same live-versus-last rule as the directions. It is absent during
setup and baseline, when there is no measurement, and whenever the readout is showing
the "Last:" correction (a stopped or finished run, an interrupted or retrying read, a
pending or unconfirmed command). It disappears if the error climbs back to 2′.
