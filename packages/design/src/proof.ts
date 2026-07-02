// The contrast PROOF — "measured, not promised" as data (plan 014). `proveContrast`
// runs the contract pair table (roles.ts) through the SAME math the gate uses
// (`contrastRatio` + `requiredRatio`) and returns every measurement, including the
// exempt-by-design rows, so the spec page's proof table and `dist/contrast-proof.json`
// are the gate's own numbers. `checkContractContrast` — the gate half of design:check
// and the scaffold self-gate — is nothing but the FAILING proof entries mapped to
// TokenIssues, so the gate can never disagree with the proof. Pure; never throws.

import type { DesignSystemOutput } from "./derive";
import type { TokenIssue } from "./schema";
import type { GateLevel } from "./roles";
import { contractPairInstances } from "./roles";
import { requiredRatio } from "./gate";
import { contrastRatio } from "./color";

/** One measured contract pair in one theme — a proof-table row. */
export interface ProofEntry {
  theme: string;
  /** `<fg> on <bg>` (the theme rides in its own field). */
  label: string;
  fgPath: string;
  bgPath: string;
  fg: unknown;
  bg: unknown;
  kind: "text" | "non-text";
  level: GateLevel;
  /** Measured WCAG ratio; null when a color is uncomputable (wide-gamut/unsupported)
   *  — which also forces `pass: false`, surfaced as a warning, never a silent pass. */
  ratio: number | null;
  required: number;
  pass: boolean;
  /** Exempt by design (roles.ts) — shown in the proof table, never gated. */
  exempt?: boolean;
}

export interface ProofOptions {
  /** The system's declared conformance level (system.json `gate.level`). */
  level: GateLevel;
  /** Also measure/gate the pre-014 legacy pairs (narrow-vocabulary systems). */
  includeLegacy?: boolean;
}

/** Measure every contract pair (plus the exempt rows) across every theme.
 *  Deterministic: themes in output order; within a theme, gated entries before
 *  exempt ones, then by fg/bg path. */
export function proveContrast(output: DesignSystemOutput, opts: ProofOptions): ProofEntry[] {
  const entries: ProofEntry[] = [];
  for (const theme of output.themes) {
    const instances = contractPairInstances(theme, opts.level, {
      includeLegacy: opts.includeLegacy,
      includeExempt: true,
    }).sort(
      (a, b) =>
        Number(a.exempt) - Number(b.exempt) ||
        a.fgPath.localeCompare(b.fgPath) ||
        a.bgPath.localeCompare(b.bgPath),
    );
    for (const p of instances) {
      const ratio = contrastRatio(p.fg, p.bg);
      const required = requiredRatio({ label: p.fgPath, fg: p.fg, bg: p.bg, level: p.level, nonText: p.kind === "non-text" });
      entries.push({
        theme: theme.name,
        label: `${p.fgPath} on ${p.bgPath}`,
        fgPath: p.fgPath,
        bgPath: p.bgPath,
        fg: p.fg,
        bg: p.bg,
        kind: p.kind,
        level: p.level,
        ratio,
        required,
        pass: ratio != null && ratio >= required,
        ...(p.exempt ? { exempt: true } : {}),
      });
    }
  }
  return entries;
}

/** The contract contrast gate ≡ the failing proof entries. An uncomputable pair is
 *  a warning (matching `checkContrast`); a measured miss is an error. Exempt rows
 *  never gate. */
export function checkContractContrast(output: DesignSystemOutput, opts: ProofOptions): TokenIssue[] {
  const issues: TokenIssue[] = [];
  for (const e of proveContrast(output, opts)) {
    if (e.pass || e.exempt) continue;
    issues.push(
      e.ratio == null
        ? { level: "warning", token: `${e.theme}: ${e.label}`, message: `could not compute contrast (unsupported color space)` }
        : {
            level: "error",
            token: `${e.theme}: ${e.label}`,
            message: `contrast ${e.ratio.toFixed(2)}:1 is below the ${e.required}:1 floor (${e.level}${e.kind === "non-text" ? ", non-text" : ""})`,
          },
    );
  }
  return issues;
}
