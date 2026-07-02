// Reference resolution — the second half of the DTCG floor. DTCG aliases
// (`{group.token}`) "always resolve to the $value of the target token", "MUST NOT
// be circular", and tools "MUST follow each reference until they find a token with
// an explicit value." This module flattens a tree to dotted-path tokens, then
// follows every alias (including those nested inside composite values) to a concrete
// value — reporting dangling refs and cycles deterministically. Pure; never throws.
// This is the mechanism the multi-tier primitive→semantic→component model rests on.

import type { ResolvedToken, TokenType } from "./tokens";
import { TOKEN_TYPES, isReference, isToken, referencePath } from "./tokens";
import type { TokenIssue } from "./schema";

/** A token lifted out of the tree to a dotted path, with its inherited `$type`
 *  and still-raw value (aliases not yet followed). */
export interface FlatToken {
  path: string;
  /** Own or inherited type; may be undefined if the token relies on a reference. */
  type?: TokenType;
  rawValue: unknown;
  description?: string;
  /** The token's OWN `$extensions` (verbatim passthrough — no group inheritance,
   *  no resolution through references). */
  extensions?: Record<string, unknown>;
}

export interface ResolveResult {
  resolved: ResolvedToken[];
  issues: TokenIssue[];
}

/** Walk the tree to a flat list of tokens, applying group `$type` inheritance. Pure. */
export function flattenTokens(tree: Record<string, unknown>): FlatToken[] {
  const out: FlatToken[] = [];
  const walk = (node: Record<string, unknown>, path: string, inherited: TokenType | undefined): void => {
    if (isToken(node)) {
      const own = TOKEN_TYPES.includes(node.$type as TokenType) ? (node.$type as TokenType) : undefined;
      const ext = node.$extensions;
      out.push({
        path,
        type: own ?? inherited,
        rawValue: (node as { $value: unknown }).$value,
        description: typeof node.$description === "string" ? node.$description : undefined,
        extensions:
          typeof ext === "object" && ext !== null && !Array.isArray(ext) ? (ext as Record<string, unknown>) : undefined,
      });
      return;
    }
    const groupType = TOKEN_TYPES.includes(node.$type as TokenType) ? (node.$type as TokenType) : inherited;
    for (const [name, child] of Object.entries(node)) {
      if (name.startsWith("$")) continue;
      if (typeof child !== "object" || child === null || Array.isArray(child)) continue;
      walk(child as Record<string, unknown>, path ? `${path}.${name}` : name, groupType);
    }
  };
  walk(tree, "", undefined);
  return out;
}

/** Resolve every alias to a concrete value (following chains, detecting cycles). */
export function resolveAliases(tree: Record<string, unknown>): ResolveResult {
  const flat = flattenTokens(tree);
  const byPath = new Map<string, FlatToken>(flat.map((t) => [t.path, t]));
  const issues: TokenIssue[] = [];

  // Deep-resolve a value: follow `{ref}`s (tracking the chain for cycle detection)
  // and recurse into composite arrays/objects whose sub-values may be refs.
  const resolveValue = (value: unknown, chain: string[], origin: string): unknown => {
    if (isReference(value)) {
      const target = referencePath(value);
      if (chain.includes(target)) {
        issues.push({ level: "error", token: origin, message: `circular reference via \`{${target}}\` (chain: ${[...chain, target].join(" -> ")})` });
        return value;
      }
      const node = byPath.get(target);
      if (!node) {
        issues.push({ level: "error", token: origin, message: `dangling reference \`{${target}}\` (no such token)` });
        return value;
      }
      return resolveValue(node.rawValue, [...chain, target], origin);
    }
    if (Array.isArray(value)) return value.map((v) => resolveValue(v, chain, origin));
    if (typeof value === "object" && value !== null) {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = resolveValue(v, chain, origin);
      return out;
    }
    return value;
  };

  // Follow references for TYPE too (a pure-alias token inherits its target's type).
  const resolveType = (t: FlatToken, chain: string[]): TokenType | undefined => {
    if (t.type) return t.type;
    if (isReference(t.rawValue)) {
      const target = referencePath(t.rawValue);
      if (chain.includes(target)) return undefined;
      const node = byPath.get(target);
      if (node) return resolveType(node, [...chain, target]);
    }
    return undefined;
  };

  const resolved: ResolvedToken[] = [];
  for (const t of flat) {
    const type = resolveType(t, [t.path]);
    const value = resolveValue(t.rawValue, [t.path], t.path);
    if (!type) {
      issues.push({ level: "error", token: t.path, message: "cannot resolve `$type` (no explicit type and no resolvable reference)" });
      continue;
    }
    resolved.push({ path: t.path, type, value, description: t.description, extensions: t.extensions });
  }
  resolved.sort((a, b) => a.path.localeCompare(b.path));
  return { resolved, issues };
}
