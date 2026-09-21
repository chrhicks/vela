# Autofocus presentation

The server owns the active walk, positions, samples, fit and restoration outcome.
The browser displays those projections without advancing the walk itself.

`captureReadState: 'retrying'` retains the curve and last sample timestamp while
the same exposure's reads retry. The notice identifies the interruption, and the
activity spinner and graph's current-position annotation pause. Stop and restore
start remains available while server communication permits it. Current reads
resume the supplied activity; they do not add a sample or confirm fitted focus.

Offline and unconfirmed command feedback take precedence over camera-read retry
feedback. A restoration failure remains a failure, with prior samples retained.
After a lost Stop response, a fresh terminal server projection resolves command
uncertainty into its observed stopped, failed or completed outcome. Active work
does not clear that uncertainty, and the browser never repeats the command.
