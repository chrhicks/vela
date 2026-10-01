# Application appearance

`main.tsx` validates `VITE_THEME` once through `readAppConfig`: `fieldroom` is the
omitted-value default, and `vela-current` retains the legacy token reference.
Unknown identities fail explicitly. The legacy profile does not preserve the
historical application layout; the frozen archive remains that reference.

The browser appearance controller owns `vela.appearance` in localStorage. Only
`system`, `light`, or `dark` is persisted. Invalid values resolve to System;
blocked reads or writes leave the application usable. A preference is reported
as saved only after a valid stored value was read or a write succeeded. Failed
writes keep the choice for the current visit and the shared Appearance control
reports “For this visit only.”

Before React renders, the controller applies the configured profile's resolved
variables to the document root, together with `color-scheme` and `theme-color`.
System tracks the browser media preference. Explicit Light/Dark leaves that
choice intact while still tracking the system value for an immediate return to
System. The external store subscribes to media changes while it has consumers
and removes its listener when they unmount. Theme changes update the existing
React tree without route keys, navigation, or feature-state persistence.

The UI package supplies controlled Appearance presentation and exported theme
profiles. Storage, browser subscriptions, and application configuration remain
at this web boundary.
