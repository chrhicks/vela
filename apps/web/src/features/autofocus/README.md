# Autofocus presentation

The server owns the active walk, positions, samples, fit and restoration outcome.
The browser displays those projections without advancing the walk itself.

`captureReadState: 'retrying'` retains the curve and last sample timestamp while
the same exposure's reads retry. The notice identifies the interruption, and the
active status card is replaced by the interruption notice. Stop and restore
start remains available while server communication permits it. Current reads
resume the supplied activity; they do not add a sample or confirm fitted focus.

Offline and unconfirmed command feedback take precedence over camera-read retry
feedback. A restoration failure remains a failure, with prior samples retained.
After a lost Stop response, a fresh terminal server projection resolves command
uncertainty into its observed stopped, failed or completed outcome. Active work
does not clear that uncertainty, and the browser never repeats the command.

An unconfirmed Stop also gates the hook's command entry, not only its visible
button. The hook exposes its existing `stopUnconfirmed` flag so pending completion
rerenders the disabled control. Still-active reads retain that flag; only a
validated terminal projection clears it and the associated error. This does not
block an explicit Stop after a lost Start response when reads establish that a
walk is active.

The browser regressions include a small test-only React harness that calls the
same captured hook callback twice without a button. Before this guard it produced
two Stop POSTs while the first outcome remained unknown; afterward it produces
one and rejects Start until terminal reconciliation. Route coverage also checks
retained samples, terminal recovery into setup, and the separate lost-Start case.


The route adopts the approved `Panel / Autofocus walk` workshop composition:
a planned-window setup, measured curve and activity card, followed by honest
outcome cards. Phone layout keeps active status above the compact chart and Stop
within the initial viewport. The chart measures its rendered width so SVG text
stays at native size rather than shrinking a desktop diagram. Setup uses the
approved separate 320×120 phone diagram so window labels remain readable. Its dashed line
always means session start; it does not claim the focuser is still there. A hollow
marker records a sample position with no measurable stars without assigning HFR.

`fieldroom-autofocus.e2e.ts` exercises deterministic views at 1440, 768 and 390 px
in light and dark appearances, including retrying reads, offline state, failed
restoration and confirmed outcomes. Appearance changes retain curve samples and
do not issue commands. These are synthetic browser fixtures, not hardware evidence.
