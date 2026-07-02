# design-forge

## 0.1.0

- Seeded design themes: /design gains a quick-start fork — pick a curated preset (inkwell: quiet
  editorial warm-paper, 6 themes; cathode: loud technical emissive, 9 themes) via `bun run
  design:seed` — alongside the full custom grill. The new `choosing-a-seeded-theme` skill carries the
  preset inventory and the seed-vs-grill decision rule, with activation cases covering the new
  surface and pinning the boundary with defining-design-tokens. Presets are verified at WCAG AAA by
  the gate's own contrast math, and every system now gets a generated spec.html specimen page whose
  proof table is computed, not promised.

## 0.0.2

- Factory-wide audit hardening: plugin-forge sheds its stale "(Stage 1 skeleton.)" catalog description and gains the activation-case budget its own planning skill mandates (two positives per skill + a nearer confusability negative); reflection's gate hook no longer fires on non-evidence-writing siblings (`check:catalog`, `eval:trend`, `eval:record`) and ignores stale evidence; kb-writer re-surfaces the KB after `/clear` and compaction, not just startup; marketplace-builder and plugin-validator sharpen their sibling trigger-surface boundary (drifted catalog vs. broken manifest) with eval cases pinning it; design-forge's `/design` gate step names the runnable command (`bun run design:check`) and both forge plugins ship `evals/output.json` so their catalog entries are asserted and version-lockstepped.
