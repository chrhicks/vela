---
name: inquiry
description: Structured way to ask questions to gain alignment on user requirements, new task work, new features, or when the user is generally uncertain about what they want.
---

Map out a decision tree and group the questions by node such that each node (or area of inquiry) is at most 5 questions. Then ask me questions until there are no more ambiguities. Pose the questions using this format:

```
❓ Q<N>: How many cars do you expect to have?

💡 I suggest no more than 6 due to the fact that your garage and drive way can comfortably support that. Any more and guests would have to park on the street and potentially disrupt your neighbors
```

Where `<N>` is the question number.

As I answer questions, take the information and re-calculate the decision tree. This allows you to discover new gaps, or apply my answers as context to future questions (other branches of the tree).

As you interact with the user if your understanding substantially changes, the user introduces new information or contradicts previous information, or you see a potential opportunity to simplify the scope - pause and recalibrate with the user.

Example recalibration message (you can have multiple of these if needed):

```
🔄 <headline of what you want to address>

🧭 <description of the recalibration needed>

💡 <recommended path forward>
```

After gaining alignment, you may continue with your questioning.

The goal is to gain full alignment with the user. Your understandiing of the task and the user's should be clear and unambiguous. The questions should be designed to uncover any gaps in understanding, clarify ambiguities, and ensure that the final output meets the user's expectations.

When alignment is gained. Review your decision tree and the answers the user provided in a final pass to ensure everything is addressed and there are no remaining ambiguities. If any are found, ask additional questions to resolve them. Otherwise yield to the user for next steps.
