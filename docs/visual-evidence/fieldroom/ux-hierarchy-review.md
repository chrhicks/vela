# Fieldroom workflow hierarchy review

Reviewed 2026-10-01 during PR #86 acceptance, at application head `e991f0d`.
Chris requested a cross-page review after finding the framing footer detached,
the sky panel excessively tall, and Through the night difficult to discover.

This is a focused usability review, not a new implementation acceptance verdict.
The proposed sky treatment belongs in the workshop before application adoption.

## Evidence and scope

Inspected the actual application through the native collaborative browser at
1280px desktop and 390px phone widths, using the deterministic routes at
`http://127.0.0.1:5176/__review`. Also inspected the live FRA400 framing page
without issuing device commands. Reviewed route composition and all native
disclosures, with an independent read-only source audit of non-target pages.

Rendered scenes included Explore, framing, capture preparation, active Tonight,
Equipment, Home, Photographs, alignment setup/phone adjustment, and autofocus
setup/phone running. The disconnected capture-preparation placement below is
source-confirmed; it was not reproduced with a complete disconnected fixture.
This audit does not establish physical device behavior.

## Findings

| Priority | Surface | Finding | Proposed treatment |
| --- | --- | --- | --- |
| High | Framing | Through the night is a closed disclosure beside unrelated framing measurements and optics. Opening it creates a tall narrow column and large empty areas. | Visible night context near the target; bounded chart beside time controls and facts on desktop, stacked on phone. Attach measurements to composition and optics to frame controls. |
| High | Explore | The interactive sky tool sits inside **Subject facts & imaging advice**, after results and pagination. At 1280px, opening it grew the fixture page from 988px to 2762px; the map expanded with the full available width. | Explicit **View sky path** action beside the selected subject's visible sky summary. Keep catalog facts/advice with that subject and constrain chart size. |
| High | Tonight → sky | **Open sky view** navigated to the target route with `#sky`, but the destination disclosure stayed closed and the page remained at scroll position zero. | The destination should expose the promised sky view directly, including after route data loads. |
| Medium | Capture preparation | Autofocus is a small link in the cooling footnote; polar alignment is in the equipment footer. On the 390px fixture their document positions were approximately 1442px and 1531px. | A visible, coherent group of preparation actions near rig/subject context, without imposing a mandatory sequence. |
| Medium | Capture preparation, unavailable state | Rig readiness and **Connect devices** are appended after the image/settings grid and equipment summary. Auto-opening the disclosure does not put the remedy beside the disabled capture action. | Show actionable readiness ahead of, or adjacent to, the blocked form. Preserve uncertain-command explanations and explicit connection behavior. Source evidence: `routes/observe.tsx`, `features/observation/RigReadiness.tsx`. |
| Medium | Equipment | **Capture preparation** is hidden in **Rig details**, alongside endpoint, inventory timestamps and Forget rig, while alignment and autofocus are visible above it. | Put preparation navigation together; keep endpoint/history/removal in secondary details. |
| Lower | Tonight cooling | **Camera cooling** opens a 452px-wide card below the full-width equipment footer, detached from its trigger and telemetry. | Attach the expanded controls to the camera/equipment context, or use a deliberate anchored surface. Keeping these controls collapsed during a run is reasonable. |

## Appropriate progressive detail

- Photographs exposes Nights/Targets, groups, images and inspection directly.
- Home exposes rig status, equipment destinations and Add a rig.
- Alignment exposes the active step, measurement, adjustment guidance and stop/finish actions.
- Autofocus exposes setup, current sampling and results. The focuser-limit disclosure contains supporting explanation, with the relevant limit warning already visible.
- Equipment rows keep connection/activity and key measurements visible; expanding extra telemetry is appropriate.
- Image technical details and lower-level interruption causes supplement already-visible image metrics and outcome messages.
- Explore's method/credits disclosure is appropriate for methodology and attribution, not a home for a primary sky tool.

On phone, Explore already scrolls and focuses the selected subject panel after
**View subject**; the problem is the additional sky feature hidden beneath it,
not a missing selection transition.

## Recommended scope

First revise the shared presentation of sky context in framing and Explore in
the workshop, including the Tonight entry point. Then address preparation
navigation/readiness as a small separate composition pass, and attach Tonight's
cooling controls to their context. Avoid turning this into a global redesign or
making all technical details permanently visible.

## Workshop proposal

The first combined proposal below is superseded for design review. Chris found
its reduced Explore example unrecognizable compared with the real grid and
sidebar. Review one change in its faithful page context at a time.

The current proposal is **Explore sky access**: preserve Explore's navigation,
filters, nine-card grid and selected-subject sidebar, adding only the sky-path
icon at the sidebar heading to open the dialog. Its static catalog fixture uses
the same nine subjects and survey cutouts as the real page. Framing and the
remaining audit findings are deferred until this proposal has been reviewed.

Open [Explore sky access](http://127.0.0.1:5174/?component=panel&specimen=panel-explore-sky&profile=fieldroom&mode=dark&context=isolated&viewport=1280).
UI typecheck, workshop build and lint pass. Native-browser inspection confirmed
the nine-card desktop layout, selected-subject icon/dialog and dismissal, and
phone selection scroll/focus without horizontal overflow. These are workshop
checks; this proposal has not changed the application.

### Earlier exploratory composition

[Sky context & framing](http://127.0.0.1:5174/?component=panel&specimen=panel-sky-context&profile=fieldroom&mode=light&context=isolated&viewport=1280)
remains a historical sketch.
The Page control switches between Framing and a deliberately reduced Explore
example focused on the selected subject's sky entry point. The Explore example
does not propose replacing the existing catalog grid.

The framing proposal keeps night summary facts visible, attaches technical
disclosures to composition, and uses a 300px sky map beside time controls and
the light-phase legend. At a 1215px specimen content width, the complete night
section is approximately 477px tall. Phone content stacks with facts first.
The sample path, Moon, twilight colors and camera geometry are illustrative.

Workshop build and lint passed. Parent browser inspection covered the desktop
light and phone dark compositions, the full light-phase legend, keyboard time
scrubbing (readout and stable URL update), and opening/dismissing the sky dialog
from both page variants. Production adoption remains pending design feedback.
