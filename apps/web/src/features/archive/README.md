# Archive health

Tonight's **Preservation** section renders the server's `ArchiveHealthView`
(`/api/web/rigs/:rigId/archive`). The server owns every count, status and
reason; the browser owns wording, formatting and disclosure. ALPACA rigs have no
originals in Vela custody, so nothing is shown for them.

`useArchiveHealth` polls every 10 seconds while the page is visible. The server
reuses one read for 5 seconds, so faster polling would add nothing. A failed read
keeps the last view and marks its age. **Check archive now** sends one reconcile
request; a missing response is never replayed, and the next read shows the result.

`presentation.ts` turns a view into the summary. An unavailable archive while
capturing reads, for example, "Capturing · 6 originals waiting for archive. The
Vela archive cannot accept originals: … Cria is retaining them; new captures will
be refused when its capacity is exhausted." An intent refusal is a separate
notice saying no exposure was requested. Whenever Cria's facts are last known,
the summary says so. Copy, issue labels and next steps live there, beside their tests.

The workshop feature `archive-health` renders this component with fixture
projections for each state, as the reference for refining its design.
See the [acquisition archive](../../../../server/src/acquisitions/README.md#health-and-forecast)
for what each count means and how reads are bounded.
