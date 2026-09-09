# Comparison experiments

These are workshop proposals for Chris to try, not application capabilities.
Both use Vela Current and remain non-exported product specimens. They issue no
rig commands. Exposure pixels are procedural fixtures; target photographs retain
the credits in `target-framing/README.md`, and target windows are invented.

## Has the field changed?

Specimen: `panel-exposure-comparison`.

A good exposure makes a useful reference when judging the next one. Pin it,
hold **Hold to compare** with a pointer, Space or Enter, and release to return to
the latest frame. The two close crops follow the same point, selected by tapping
the field or moving the horizontal/vertical sliders. Try softened stars, haze,
and a streak; then pin the new image and compare another condition. Comparison
never blinks automatically.

This is the stronger first candidate for adoption: it supports the existing
capture loop and makes the meaning of changing image statistics visible. A small
implementation could retain one reference's pixels and metadata in the browser,
with one shared crop position. It must preserve frame identity, use matched
rendering/stretch, and state when framing differs. Registration, automatic
judgments and durable capture-run history are separate capabilities.

## Which subject gets your night?

Specimen: `panel-target-comparison`.

Compare M13, Crescent and Andromeda against the same clock. Move **Look ahead**
to see a short opportunity end while another opens. Select a photograph for its
remaining opportunity and filter tradeoff. Toggle a third subject out and back
in to judge whether two or three comparisons feel clearer. The phone layout
stacks identities while keeping each time band on the same scale.

If adopted, this can be a temporary shortlist of selected target IDs and one
inspection time in Targets. Existing discovery opportunities provide the bands;
it needs no new planning service, saved sequence or automated handoff between
subjects. The design question is whether this comparison helps Chris choose
more readily than opening target details one at a time.
