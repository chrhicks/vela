# Fieldroom application appearance

Planned before implementation; part of the Tonight slice in
[Fieldroom adoption](fieldroom-adoption.md). Shared tokens and the non-modal
Appearance control belong to the foundations slice. This plan covers the web
application's configuration and browser state, independently of astronomy state.

## Configuration and ownership

- Add a small validated application configuration module under `apps/web/src`.
  Read `VITE_THEME` once at composition; default to `fieldroom`. A finite map
  resolves named exported profiles. Unknown configured identities fail with an
  explicit configuration error rather than silently selecting another theme.
- Retain `vela-current` as a clearly described token-reference identity, not a
  promise to preserve the previous application layout. The frozen archive is
  the historical appearance reference.
- A web-owned appearance module resolves `system | light | dark` against the
  browser media preference. It owns its browser storage key and browser event
  subscription. Do not put localStorage or matchMedia into `@vela/ui`, feature
  hooks, or the server.
- Shell consumes the configured theme and resolved mode. It must not choose
  `FIELDROOM_PROFILE` itself. Theme identity and appearance preference remain
  separate; preference changes do not navigate or remount route content.

## Rendering and persistence

- Read the validated preference and resolve the system mode before the first
  application render. Apply the configured theme variables, `color-scheme`,
  and browser chrome color to the root before presenting route content.
  Remove the obsolete dark-only root declaration and fixed dark chrome color.
- Ignore malformed stored preference values and use System. Guard storage
  access; blocked storage must not prevent startup or appearance changes.
- System responds to browser preference changes. Explicit Light/Dark keeps its
  chosen mode while the browser setting changes. Returning to System resolves
  immediately. Clean up browser listeners when appropriate.
- Persist only the preference, not a second copy of the resolved mode. A failed
  write keeps the requested appearance for this visit and reports that it could
  not be saved. Never report persistence as successful when it failed.
- Keep current image identity, scale, pan, enlargement, target search, form
  inputs, and operational subscriptions intact when appearance changes.

## Integration and evidence

`main.tsx` initializes configuration and appearance. Shell and AppNavigation
compose the shared Appearance primitive. Application-only wiring stays under
`apps/web`; the workshop supplies controlled example state to the primitive.
Update `apps/web/.env.example` and the appearance module's owning README with
the supported configuration.

Focused tests cover invalid configuration, malformed/blocked storage, system
changes, explicit overrides, persistence failure, and listener cleanup.
Production-route browser checks use Paper 03.19–03.22: the same scene in light
and dark at desktop and phone widths. Verify menu dismissal and focus return,
initial root values, no content reset, and unchanged image bytes. Complete the
independent review and final visual pass defined by the slice gate before
accepting this work.

## Actual results

Pending.
