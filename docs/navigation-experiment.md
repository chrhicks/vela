# Observatory navigation experiment

The approved navigation design gives the app bar three jobs: identify the rig being
viewed, reach Observe/Targets/Capture, and return to a running capture. Vela
returns to all rigs. Rig details and saved images remain contextual links in
the page. The stable `NavigationBar` component now owns this rendering in both
the workshop and application shell. The app supplies real routes, catalog rig
identities, and capture-controller snapshots through its navigation feature.

Open the Panel / Card specimen **Observatory navigation · Experiment**. Switch
pages and rigs, follow a target detail and return, then use the activity link
to return to Askar. The footer changes the sample activity between idle,
capturing, reading an image and interrupted. Idle removes the activity link; interrupted reports
lost updates and retains explicitly last-known capture details. All-rigs clears
the rig-specific page links. Phone widths use two rows instead of an overflow
menu. Keyboard/native select navigation and the inspector share specimen state.

The example models one capture on Askar. This is a bounded design fixture, not
a policy limiting Vela to one operating rig. App adoption supplies a current,
rig-identified activity summary. Chris expects to operate one rig at a time
for now, so multiple simultaneous activities are outside this experiment. Viewing a rig must remain navigation, never a
connection or command. Preserve target search context when leaving/returning.

The page bodies are deliberately abbreviated context for evaluating the bar;
they are not replacements for the approved feature specimens. Capture imagery
uses the existing procedural fixture, and reference photographs retain their
credits and source links from the target-framing fixtures. No fixture becomes
application state or imagery during adoption.

The capture summary shows completed exposures and a small progress bar for the
current exposure (elapsed seconds out of its duration). Runs continue until
stopped, so there is no invented target count or overall run percentage.
Reading an image hides the timed progress without increasing the completed
count; interrupted updates hide progress and mark the count as last known.
The footer elapsed slider previews progress; it does not advance a real clock
or complete exposures. Saved images remains contextual until a real need
justifies a permanent navigation destination.
