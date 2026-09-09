# Observatory navigation experiment

This workshop proposal gives the app bar three jobs: identify the rig being
viewed, reach Observe/Targets/Capture, and return to a running capture. Vela
returns to all rigs. Rig details and saved images remain contextual links in
the page. No app route, device command, connection state, or production shell
is changed by this experiment.

Open the Panel / Card specimen **Observatory navigation · Experiment**. Switch
pages and rigs, follow a target detail and return, then use the activity link
to return to Askar. The footer changes the sample activity between idle,
capturing and interrupted. Idle removes the activity link; interrupted reports
lost updates and retains explicitly last-known capture details. All-rigs clears
the rig-specific page links. Phone widths use two rows instead of an overflow
menu. Keyboard/native select navigation and the inspector share specimen state.

The example models one capture on Askar. This is a bounded design fixture, not
a policy limiting Vela to one operating rig. A real adoption needs a current,
rig-identified activity summary and a decision about how multiple simultaneous
activities are represented. Viewing a rig must remain navigation, never a
connection or command. Preserve target search context when leaving/returning.

The page bodies are deliberately abbreviated context for evaluating the bar;
they are not replacements for the approved feature specimens. Capture imagery
uses the existing procedural fixture, and reference photographs retain their
credits and source links from the target-framing fixtures. No fixture becomes
application state or imagery during adoption.
