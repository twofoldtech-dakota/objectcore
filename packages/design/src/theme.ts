// Theming — the mechanism the research settled on: NOT a single file, but multiple
// token SETS combined by a RESOLVER (an order-significant selection + merge step),
// with aliases resolved only AFTER the merge. Modeled after the DTCG Resolver Module
// (sets + conditional `modifiers` whose `contexts` map light/dark/brand → set lists +
// a `resolutionOrder` where later overrides earlier) but with our OWN stable field
// names — that module is a preview draft ("do not implement"), so we target its shape
// without binding to its churn (plans/012, Decision B). This is the same multiple-
// sets+resolver model Tokens Studio Themes, Figma modes, and CSS `[data-theme]` all
// implement. Pure; never throws.

import type { ResolvedToken } from "./tokens";
import { isToken } from "./tokens";
import type { TokenIssue } from "./schema";
import { resolveAliases } from "./resolve";

/** A conditional axis (theme, brand, density…): a context value selects set names. */
export interface ThemeModifier {
  /** Axis name, keyed into the runtime {@link ThemeContext} (e.g. "theme"). */
  name: string;
  /** Context value (e.g. "light") -> the set names to include for it. */
  contexts: Record<string, string[]>;
}

/** The resolver: how named sets + modifiers combine, in override order. */
export interface Resolver {
  /** Set names AND modifier names, applied in order — later entries override earlier. */
  resolutionOrder: string[];
  modifiers: ThemeModifier[];
}

/** The runtime selection, e.g. `{ theme: "dark", brand: "acme" }`. */
export type ThemeContext = Record<string, string>;

export interface AppliedTheme {
  /** The merged (unresolved) tree — aliases not yet followed. */
  merged: Record<string, unknown>;
  resolved: ResolvedToken[];
  issues: TokenIssue[];
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Deep-merge two token trees: groups merge recursively; a token (a node with
 *  `$value`) from `b` wholly replaces the one in `a` (a semantic override). Pure. */
export function mergeTrees(a: Record<string, unknown>, b: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...a };
  for (const [k, bv] of Object.entries(b)) {
    const av = out[k];
    if (isPlainObject(av) && isPlainObject(bv) && !isToken(av) && !isToken(bv)) {
      out[k] = mergeTrees(av, bv);
    } else {
      out[k] = bv; // token override, scalar, or group↔token change → b wins
    }
  }
  return out;
}

/** Select + merge the sets for one context, then resolve aliases over the merge. */
export function applyResolver(
  sets: Record<string, Record<string, unknown>>,
  resolver: Resolver,
  context: ThemeContext,
): AppliedTheme {
  const modByName = new Map(resolver.modifiers.map((m) => [m.name, m]));
  const trees: Record<string, unknown>[] = [];
  const issues: TokenIssue[] = [];

  for (const name of resolver.resolutionOrder) {
    const mod = modByName.get(name);
    if (mod) {
      const ctxVal = context[mod.name];
      if (ctxVal == null) {
        issues.push({ level: "warning", message: `no context value provided for modifier \`${mod.name}\`` });
        continue;
      }
      const sources = mod.contexts[ctxVal];
      if (!sources) {
        issues.push({ level: "error", message: `modifier \`${mod.name}\` has no context \`${ctxVal}\`` });
        continue;
      }
      for (const s of sources) {
        if (sets[s]) trees.push(sets[s]);
        else issues.push({ level: "error", message: `unknown set \`${s}\` (referenced by modifier \`${mod.name}\`)` });
      }
    } else if (sets[name]) {
      trees.push(sets[name]);
    } else {
      issues.push({ level: "error", message: `unknown set \`${name}\` in resolutionOrder` });
    }
  }

  const merged = trees.reduce<Record<string, unknown>>((acc, t) => mergeTrees(acc, t), {});
  const res = resolveAliases(merged);
  return { merged, resolved: res.resolved, issues: [...issues, ...res.issues] };
}
