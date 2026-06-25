---
name: writing-great-skills
description: Reference for the vocabulary and principles that make a skill predictable — the spec plugin-forge writes against. Use when authoring or reviewing a skill's metadata, body, or reference layers.
---
# Writing great skills (the spec the generator conforms to)

**Progressive disclosure is the core discipline.** Three layers; pay token cost only for the one reached:
- **Metadata** (name + description) — the trigger surface, seen every session. Precise enough to fire on the right task, quiet enough not to fire on the wrong one. Most skill failures are description failures. Build the description from three parts — the **artifact** it acts on, the **form** of its output, and the **enumerated entry-triggers** — then check it against the sibling surfaces already in the catalog so it doesn't overlap one of them.
- **Instructions** (this body) — loaded on task match. For a real (non-meta) skill the body is **mandatory**: the metadata decides *whether* it fires, the body decides *what it does*; an unfilled body is a stub the gate rejects.
- **Reference** (deep files) — pulled only when explicitly needed.

**Small and composable beats monolithic.** Workflow-enforcement, not capability-extension.

**The generator must emit the trigger surface as a first-class output** and gate the catalog on an activation eval — a skill that never fires is worse than one that fails to parse.
