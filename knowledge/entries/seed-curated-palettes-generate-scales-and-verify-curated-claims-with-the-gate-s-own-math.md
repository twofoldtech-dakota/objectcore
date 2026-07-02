---
id: seed-curated-palettes-generate-scales-and-verify-curated-claims-with-the-gate-s-own-math
type: lesson
title: Seed curated palettes, generate scales — and verify curated claims with the gate's own math
tags: [design, presets, contrast, gate, plan-014]
created: 2026-07-02
---

Curated per-theme palettes (plan 014's inkwell/cathode presets) read as designed in a way generated ramps don't, but their accessibility claims are prose until recomputed. The working split: seeds pin the hand-tuned palette as checked-in DTCG and the engine re-verifies every contract pair at instantiation AND in fixture tests (proveContrast — the same math as the gate), while the scaffold path generates ramps that pass by construction (solved lightness). When a curated claim fails the recompute (14 POC pairs missed AAA), fix by re-pointing semantic aliases a step deeper on the same ramp — hex edits are the last resort — and record every deviation with before/after ratios in the preset's source note.
