// Per-plugin CHANGELOG.md rendering. Pure string-in/string-out so it is trivially
// testable; the script owns reading/writing the file. Keep-a-Changelog-ish: an H1
// per plugin, newest version section on top.

import type { Release } from "./plan";

/** Render the markdown section for a single released version. */
export function renderChangelogEntry(r: Release): string {
  const lines: string[] = [`## ${r.newVersion}`, ""];
  const bullets = r.summaries.length ? r.summaries : ["Release."];
  for (const summary of bullets) {
    const [first, ...rest] = summary.split("\n");
    lines.push(`- ${first}`);
    for (const extra of rest) lines.push(`  ${extra}`);
  }
  lines.push("");
  return lines.join("\n");
}

/** Insert a new version section below the H1 header (created if absent). */
export function prependChangelog(existing: string, entry: string, pluginName: string): string {
  const header = `# ${pluginName}`;
  const norm = existing.replace(/\r\n/g, "\n").trim();

  if (!norm) return `${header}\n\n${entry}`;
  if (norm.startsWith("# ")) {
    const nl = norm.indexOf("\n");
    const head = nl < 0 ? norm : norm.slice(0, nl);
    const body = nl < 0 ? "" : norm.slice(nl + 1).replace(/^\n+/, "");
    return body ? `${head}\n\n${entry}\n${body}\n` : `${head}\n\n${entry}`;
  }
  // No H1 — add one and keep the prior content underneath.
  return `${header}\n\n${entry}\n${norm}\n`;
}
