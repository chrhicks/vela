# Imaging camera

Observe composes the approved camera-selection design from stable Panel, Select,
and Button primitives. The server projects camera identities, the remembered
selection, identity problems, and whether editing is available. Selecting a
camera saves rig configuration; it does not connect the camera or establish
capture readiness.

The browser retains the last confirmed selection when reads fail, and preserves
a draft identity as both ID and name so a changed slot cannot silently become a
new choice. A save supersedes older reads. Polls pause while hidden and during
writes; leaving the page invalidates pending results. A lost write response is
never replayed. A subsequent GET can confirm that the requested identity is now
persisted, which is sufficient for this configuration operation.
