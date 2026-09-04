---
name: inquiry
description: Align on material decisions before a new Vela ticket or workstream, or when changed requirements affect the agreed scope. Use existing context to avoid reopening settled decisions.
---

Gain enough shared understanding to act: stop asking when there are **no unresolved decisions that materially affect the agreed task**.

Read the request, relevant ticket, repository guidance, and prior decisions first. Map the remaining decisions and their dependencies. Group questions by decision area, with at most five questions in a group; ask fewer when one answer determines the next branch. Do not manufacture questions to fill a group or show a formal tree unless it helps Chris decide.

Ask about choices that change the outcome, scope, product experience, important architectural boundaries, acceptance criteria, or authorization. Use judgment for routine, reversible implementation details. State consequential assumptions rather than asking Chris to choose every detail. Existing answers and authorization persist unless Chris changes them or new evidence creates a material conflict.

Pose questions using this format, with continuous numbering through the inquiry:

```text
❓ Q<N>: <One concrete question>

💡 <Your recommended choice and the relevant reason or tradeoff.>
```

As answers arrive, update the decision tree and drop questions the answers have resolved. Continue useful work that does not depend on a pending answer; wait for required answers before taking dependent actions. Elapsed time is not an answer or approval.

When new information substantially changes the understanding or suggests a smaller scope, explain the change and recommendation before asking the next material question:

```text
🔄 <What changed>

🧭 <How it affects the agreed task>

💡 <Recommended path forward>
```

At completion, review the decisions once for remaining material gaps and briefly state the agreed scope and consequential assumptions. If execution is already requested, continue under the repository's delivery workflow without asking for another start signal. If Chris requested exploration or planning only, yield the agreed scope for next steps. Inquiry does not replace workshop collaboration, independent verification, or the browser-review requirement in AGENTS.md.
