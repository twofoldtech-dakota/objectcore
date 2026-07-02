// The semantic role contract (plan 014) — the shared vocabulary every ObjectCore
// design system speaks: which roles exist and which (fg, bg) pairs the deterministic
// contrast gate holds them to. This is the ONE pair source: the scaffold self-gate,
// `design:check`, and the proof table (proof.ts) all read the same rules, so the
// gate can never disagree with what the spec page proves. Pure; never throws.
//
// The contract pair table (all text pairs gate at the system's DECLARED level —
// no per-pair policy exceptions):
//
//   | fg                                                             | bg                                | kind            |
//   |----------------------------------------------------------------|-----------------------------------|-----------------|
//   | `text.emphasis`, `text.primary`, `text.secondary`, `text.muted` | `bg.base`, `bg.surface`, `bg.raised` | text            |
//   | `accent.default`                                                | `bg.base`, `bg.surface`, `bg.raised` | text            |
//   | `accent.default`                                                | `accent.subtle-bg`                 | text            |
//   | `accent.on-accent`                                              | `accent.default`, `accent.hover`   | text            |
//   | `status.{s}-text`                                               | `status.{s}-bg` (×3)               | text            |
//   | `solid.on-{s}`                                                  | `solid.{s}` (×3)                   | text            |
//   | `border.input`                                                  | `bg.base`, `bg.surface`            | non-text (3:1)  |
//   | `accent.focus-ring`                                             | `bg.base`, `bg.surface`, `bg.raised` | non-text (3:1)  |
//
// Exempt by design (measured for the proof table, NEVER gated — see EXEMPT_PAIRS):
//   • `text.disabled` — the WCAG 1.4.3 exception for disabled/inactive components;
//   • `border.subtle` / `border.strong` — decorative separators, not the meaningful
//     UI boundaries SC 1.4.11's 3:1 floor applies to (requiring it there is a false
//     failure — the gated boundary tokens are `border.input` and `accent.focus-ring`);
//   • `status.*-bg` vs `bg.*` — tinted chips sit at ~1:1 against the canvas by design
//     (their TEXT carries the contrast);
//   • `accent.subtle-bg` vs `bg.*` — a wash, not a boundary;
//   • `border.input` vs `bg.raised` — inputs don't sit on raised surfaces
//     (documented exclusion; raised measured 2.30 in the seeded presets).

import type { DerivedTheme } from "./derive";
import type { ContrastPair } from "./gate";
import type { TokenIssue } from "./schema";

/** The WCAG conformance level a system declares (system.json `gate.level`). */
export type GateLevel = "AA" | "AAA";

/** One row of the contract: role paths for foreground/background + the check kind.
 *  `kind: "text"` gates at the system's declared level (1.4.3/1.4.6); `"non-text"`
 *  is always the 3:1 floor (1.4.11). */
export interface ContractPairRule {
  /** Foreground role path, e.g. `text.primary`. */
  fg: string;
  /** Background role path, e.g. `bg.surface`. */
  bg: string;
  kind: "text" | "non-text";
  /** Pin the pair to a FIXED level regardless of the declared one — only the legacy
   *  pairs use this (pre-014 `text.primary` always gated at AAA). Absent ⇒ declared. */
  level?: GateLevel;
}

const text = (fg: string, bg: string, level?: GateLevel): ContractPairRule =>
  level ? { fg, bg, kind: "text", level } : { fg, bg, kind: "text" };
const nonText = (fg: string, bg: string): ContractPairRule => ({ fg, bg, kind: "non-text" });

const CANVAS_BGS = ["bg.base", "bg.surface", "bg.raised"] as const;
const STATUSES = ["success", "warning", "danger"] as const;

/** The gated contract pairs — the table above, row by row. */
export const CONTRACT_PAIRS: readonly ContractPairRule[] = [
  ...["text.emphasis", "text.primary", "text.secondary", "text.muted"].flatMap((fg) =>
    CANVAS_BGS.map((bg) => text(fg, bg)),
  ),
  ...CANVAS_BGS.map((bg) => text("accent.default", bg)),
  text("accent.default", "accent.subtle-bg"),
  text("accent.on-accent", "accent.default"),
  text("accent.on-accent", "accent.hover"),
  ...STATUSES.map((s) => text(`status.${s}-text`, `status.${s}-bg`)),
  ...STATUSES.map((s) => text(`solid.on-${s}`, `solid.${s}`)),
  nonText("border.input", "bg.base"),
  nonText("border.input", "bg.surface"),
  ...CANVAS_BGS.map((bg) => nonText("accent.focus-ring", bg)),
];

/** The pre-014 STD trio, byte-for-byte: `text.primary`@AAA + `text.subtle`@AA +
 *  `accent.text`@AA on `bg.canvas`/`bg.subtle`/`bg.surface`. Systems on the narrow
 *  legacy vocabulary keep gating EXACTLY as before the contract landed — the pins
 *  encode the old fixed levels, never the declared one. */
export const LEGACY_PAIRS: readonly ContractPairRule[] = ["bg.canvas", "bg.subtle", "bg.surface"].flatMap((bg) => [
  text("text.primary", bg, "AAA"),
  text("text.subtle", bg, "AA"),
  text("accent.text", bg, "AA"),
]);

/** The exempt-by-design pairs (rationale in the module header): measured so the
 *  proof table can SHOW them (badged EXEMPT), never fed to the gate. */
export const EXEMPT_PAIRS: readonly ContractPairRule[] = [
  ...CANVAS_BGS.map((bg) => text("text.disabled", bg)),
  ...CANVAS_BGS.map((bg) => nonText("border.subtle", bg)),
  ...CANVAS_BGS.map((bg) => nonText("border.strong", bg)),
  ...STATUSES.flatMap((s) => CANVAS_BGS.map((bg) => nonText(`status.${s}-bg`, bg))),
  ...CANVAS_BGS.map((bg) => nonText("accent.subtle-bg", bg)),
  nonText("border.input", "bg.raised"),
];

/** Every role the full contract requires — what `gate.coverage: "full"` asserts.
 *  (`text.disabled` is required as a ROLE even though its contrast is exempt.) */
export const REQUIRED_ROLES: readonly string[] = [
  "bg.base", "bg.surface", "bg.raised",
  "border.subtle", "border.strong", "border.input",
  "text.emphasis", "text.primary", "text.secondary", "text.muted", "text.disabled",
  "accent.default", "accent.hover", "accent.subtle-bg", "accent.on-accent", "accent.focus-ring",
  ...STATUSES.flatMap((s) => [`status.${s}-bg`, `status.${s}-text`]),
  ...STATUSES.flatMap((s) => [`solid.${s}`, `solid.on-${s}`]),
];

/** A contract rule resolved against one theme: role paths plus the resolved values
 *  — the shared substrate `contractPairs` (the gate) and `proveContrast` (the proof
 *  table) both map from, so gate ≡ proof by construction. */
export interface ContractPairInstance {
  fgPath: string;
  bgPath: string;
  fg: unknown;
  bg: unknown;
  kind: "text" | "non-text";
  /** The effective level: the rule's pin (legacy) or the system's declared level. */
  level: GateLevel;
  /** Measured for the proof table but never gated. */
  exempt: boolean;
}

const rank = (level: GateLevel): number => (level === "AAA" ? 1 : 0);

/** Resolve the contract (± legacy, ± exempt) against one theme. PRESENCE-GATED: a
 *  pair fires only when BOTH roles resolve in the theme — a narrow system is gated
 *  on the vocabulary it actually speaks (`coverage: "full"` is the separate check
 *  that the vocabulary is complete). A (fg, bg) pair matched by two rule sets (e.g.
 *  legacy `text.primary` on `bg.surface` duplicating the contract row) collapses to
 *  ONE pair at the STRICTER level. */
export function contractPairInstances(
  theme: DerivedTheme,
  level: GateLevel,
  opts: { includeLegacy?: boolean; includeExempt?: boolean } = {},
): ContractPairInstance[] {
  const byPath = new Map(theme.tokens.map((t) => [t.path, t.value]));
  const out: ContractPairInstance[] = [];
  const index = new Map<string, number>();

  const add = (rules: readonly ContractPairRule[], exempt: boolean): void => {
    for (const rule of rules) {
      if (!byPath.has(rule.fg) || !byPath.has(rule.bg)) continue;
      const effective = rule.level ?? level;
      const key = `${rule.fg}|${rule.bg}`;
      const prior = index.get(key);
      if (prior !== undefined) {
        if (rank(effective) > rank(out[prior]!.level)) out[prior]!.level = effective;
        continue;
      }
      index.set(key, out.length);
      out.push({
        fgPath: rule.fg,
        bgPath: rule.bg,
        fg: byPath.get(rule.fg),
        bg: byPath.get(rule.bg),
        kind: rule.kind,
        level: effective,
        exempt,
      });
    }
  };

  add(CONTRACT_PAIRS, false);
  if (opts.includeLegacy) add(LEGACY_PAIRS, false);
  if (opts.includeExempt) add(EXEMPT_PAIRS, true);
  return out;
}

/** The gate's view of the contract: `checkContrast`-ready pairs for one theme,
 *  labeled `<theme>: <fg> on <bg>` (matching the pre-014 issue tokens). Exempt
 *  pairs are never included — they exist only in the proof table. */
export function contractPairs(
  theme: DerivedTheme,
  level: GateLevel,
  opts: { includeLegacy?: boolean } = {},
): ContrastPair[] {
  return contractPairInstances(theme, level, { includeLegacy: opts.includeLegacy }).map((p) => ({
    label: `${theme.name}: ${p.fgPath} on ${p.bgPath}`,
    fg: p.fg,
    bg: p.bg,
    level: p.level,
    nonText: p.kind === "non-text",
  }));
}

/** `gate.coverage: "full"`: every contract role must be present in the theme. */
export function checkContractCoverage(theme: DerivedTheme): TokenIssue[] {
  const have = new Set(theme.tokens.map((t) => t.path));
  return REQUIRED_ROLES.filter((role) => !have.has(role)).map((role) => ({
    level: "error" as const,
    token: `${theme.name}: ${role}`,
    message: `required contract role is missing (gate.coverage: "full")`,
  }));
}
