// The seam — the pure invariant, the design-token analogue of `deriveCatalog`.
// `deriveDesignSystem(source)` takes named token sets (+ an optional theming
// resolver) and produces the resolved tokens for every theme permutation. No I/O:
// a `TokenSource` (sources.ts) loads the input, a `TokenSink` (sinks.ts) serializes
// the output — so this is the one derivation path (never write a second). The gate
// (P2) runs `validateTokens` over the sets separately, like `validateAll` is
// separate from `deriveCatalog`. Pure; never throws.

import type { ResolvedToken } from "./tokens";
import type { TokenIssue } from "./schema";
import { resolveAliases } from "./resolve";
import type { Resolver, ThemeContext } from "./theme";
import { applyResolver, mergeTrees } from "./theme";

/** A theme to derive: a name + the context selecting its sets via the resolver. */
export interface ThemeSpec {
  name: string;
  context: ThemeContext;
}

/** The loaded input: named token sets, an optional resolver, and the themes to emit. */
export interface DesignSystemSource {
  /** Named token sets, e.g. `{ primitives, semantic-light, semantic-dark }`. */
  sets: Record<string, Record<string, unknown>>;
  /** Theming resolver; absent ⇒ a single "default" theme merging all sets. */
  resolver?: Resolver;
  /** Theme permutations to derive (required with a resolver). */
  themes?: ThemeSpec[];
}

export interface DerivedTheme {
  name: string;
  context: ThemeContext;
  tokens: ResolvedToken[];
}

export interface DesignSystemOutput {
  themes: DerivedTheme[];
  /** Resolution issues (dangling/circular refs, unknown sets), theme-prefixed. */
  issues: TokenIssue[];
}

/** Derive the resolved tokens for every theme. Pure. */
export function deriveDesignSystem(source: DesignSystemSource): DesignSystemOutput {
  const issues: TokenIssue[] = [];
  const themes: DerivedTheme[] = [];

  if (source.resolver && source.themes && source.themes.length > 0) {
    for (const spec of source.themes) {
      const applied = applyResolver(source.sets, source.resolver, spec.context);
      for (const it of applied.issues) {
        issues.push({ level: it.level, token: it.token, message: `[${spec.name}] ${it.message}` });
      }
      themes.push({ name: spec.name, context: spec.context, tokens: applied.resolved });
    }
  } else {
    // No theming: merge every set in insertion order into a single "default" theme.
    const merged = Object.values(source.sets).reduce<Record<string, unknown>>((acc, t) => mergeTrees(acc, t), {});
    const res = resolveAliases(merged);
    issues.push(...res.issues);
    themes.push({ name: "default", context: {}, tokens: res.resolved });
  }

  return { themes, issues };
}
