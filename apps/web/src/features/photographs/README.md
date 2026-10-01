# Photographs

The per-rig `/observe/saved-images/:imageId?` route owns one dated collection
and selected photograph. A collection entry replaces its URL with the newest
returned image's existing deep link. Explicit links remain authoritative:
missing detail never silently selects a different image. Server order is
preserved, including its saved-time tie-breaker.

`useSavedImages` reads collection metadata independently from `useSavedImage`.
Their timeouts remain 10 seconds and 120 seconds respectively; opening detail
may prepare a retained display derivative. Both cancel obsolete requests and
validate rig/image identity at the HTTP boundary. A failed list or disconnected
camera does not block a valid direct detail. Retries are explicit reads, with no
capture/device request or background archive conversion.

The collection owner is keyed only by rig. URL selection, Back/Forward, palette
changes and earlier-row disclosure preserve it. Six rows are shown initially,
with six more per explicit reveal; an older direct link reveals its own row.
This bounds disclosure, not server metadata size: the endpoint still returns
the complete collection. Dates/times use the browser's local timezone. The
ordinal describes position in that collection, not an exposure-run counter.
Switching rigs from Photographs opens the other rig's collection without
carrying its predecessor's selected ID.

`SelectedPhotograph` uses the shared image-inspection controller, viewport and
enlargement. Its key includes acquisition ID and fitted/native URLs, so a new
selection or renderer version clears the old viewer before publication. Facts,
rendering copy and downloads come from the displayed typed snapshot. Valid
metadata and original FITS remain accessible when preview pixels fail. Native
404/410 is a missing saved preview, never evidence of camera-cache expiry or
loss of the retained original.

Fieldroom's desktop composition is the dated list, fitted photograph and
exposure details. Compact presentation puts preview first, details next and
the list below. Explicit list/row actions move focus between those regions;
initial rendering and appearance changes do not. Enlargement keeps the inline
extent and shared native pan/focus behavior. No Keep or live-follow controls
belong here. Downloads use native links to validated exact resources.

The accepted composition specimen is
`packages/ui/src/drafts/Panel.photographs.specimen.tsx`; it is not imported by
the application. The adoption plan and retained-image server README own the
visual evidence and artifact/version contracts respectively.
