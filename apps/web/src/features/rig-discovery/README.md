# Rig discovery

Home opens this modal only through Add a rig. Discovery reads Alpaca server and
configured-device information; it does not connect equipment. The explicit view
state owns entry, manual address, pending inspection, results and editable review.
Cancel aborts an inspection and invalidates its late response. Manual drafts stay
local, and edited review names belong to the inspected endpoint, so choosing
another server cannot inherit its name.

Only eligible candidates reach review. Manual host/port feedback matches the
server's accepted hostname/IPv4 shape. A wholly unreachable manual inspection
returns to editable fields; protocol, malformed-response and scan failures retain
their distinct meaning. Partial failures remain visible with useful candidates.

Review has one submission status: ready, adding, unconfirmed or checking. Add
blocks duplicate writes and dismissal while pending. Known 400/404/409 rejections
remain separate from transport loss, malformed success responses and server
errors whose outcome is unknown. Unknown outcomes disable Add and offer an
explicit read-only discovery inspection of the exact reviewed endpoint:

- Already added refreshes the Home catalog and closes the dialog.
- A newly eligible endpoint retains its edited name and permits a later explicit Add.
- Conflicting or ineligible endpoints return their actual discovery result.
- Failed inspection retains uncertainty and permits another explicit check.

No check replays Add. A confirmed Add hands off to Home, which closes the dialog
before refreshing. Refresh failure preserves the previous catalog and does not
turn the confirmed write into a failed Add.

The scoped Dialog treatment follows the approved Fieldroom workshop: 624px
review at desktop and a full-height compact address flow. Shared Dialog retains
focus containment, Escape, backdrop dismissal and focus return. The shell owns
navigation; Home owns first-night and catalog content only.
