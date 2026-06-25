import { test, expect } from "bun:test";
import { bumpVersion, maxBump } from "../src/semver";
import { parseChangeset } from "../src/changeset";
import { planRelease } from "../src/plan";
import { renderChangelogEntry, prependChangelog } from "../src/changelog";
import { requiresProvenance } from "../src/provenance";
import { releaseTag, parseReleaseTag } from "@objectcore/registry-core";

test("bumpVersion follows straight semver", () => {
  expect(bumpVersion("1.2.3", "patch")).toBe("1.2.4");
  expect(bumpVersion("1.2.3", "minor")).toBe("1.3.0");
  expect(bumpVersion("1.2.3", "major")).toBe("2.0.0");
});

test("maxBump picks the larger bump", () => {
  expect(maxBump("patch", "minor")).toBe("minor");
  expect(maxBump("major", "minor")).toBe("major");
  expect(maxBump("patch", "patch")).toBe("patch");
});

test("parseChangeset reads frontmatter map + summary", () => {
  const cs = parseChangeset(
    "brave-lions",
    `---\n"hello-objectcore": minor\nplugin-forge: patch\n---\n\nAdd a thing.\n`,
  );
  expect(cs.bumps).toEqual({ "hello-objectcore": "minor", "plugin-forge": "patch" });
  expect(cs.summary).toBe("Add a thing.");
});

test("parseChangeset rejects a malformed file", () => {
  expect(() => parseChangeset("bad", "no frontmatter here")).toThrow();
  expect(() => parseChangeset("bad", `---\n"x": sideways\n---\n`)).toThrow();
});

test("planRelease aggregates overlapping bumps (max wins) and sorts", () => {
  const plugins = [
    { name: "hello-objectcore", version: "0.1.0" },
    { name: "plugin-forge", version: "0.0.1" },
  ];
  const changesets = [
    parseChangeset("a", `---\n"hello-objectcore": patch\n---\nfix one`),
    parseChangeset("b", `---\n"hello-objectcore": minor\nplugin-forge: patch\n---\nfeature`),
  ];
  const plan = planRelease(plugins, changesets);
  expect(plan.unknown).toEqual([]);
  expect(plan.releases.map((r) => [r.name, r.oldVersion, r.newVersion, r.bump])).toEqual([
    ["hello-objectcore", "0.1.0", "0.2.0", "minor"],
    ["plugin-forge", "0.0.1", "0.0.2", "patch"],
  ]);
  // both summaries collected for the plugin touched twice
  expect(plan.releases[0]!.summaries.length).toBe(2);
});

test("planRelease flags changesets that name unknown plugins", () => {
  const plan = planRelease(
    [{ name: "real-plugin", version: "1.0.0" }],
    [parseChangeset("c", `---\n"ghost-plugin": minor\n---\noops`)],
  );
  expect(plan.releases).toEqual([]);
  expect(plan.unknown).toEqual([{ changeset: "c", plugin: "ghost-plugin" }]);
});

test("changelog renders a section and prepends below the H1", () => {
  const r = { name: "x", oldVersion: "1.0.0", newVersion: "1.1.0", bump: "minor" as const, summaries: ["Added Y."] };
  const entry = renderChangelogEntry(r);
  expect(entry).toContain("## 1.1.0");
  expect(entry).toContain("- Added Y.");
  const next = prependChangelog(`# x\n\n## 1.0.0\n\n- First.\n`, entry, "x");
  expect(next.indexOf("## 1.1.0")).toBeLessThan(next.indexOf("## 1.0.0"));
  expect(next.startsWith("# x")).toBe(true);
});

test("releaseTag round-trips and matches the {plugin}--v{semver} format", () => {
  expect(releaseTag("hello-objectcore", "0.1.0")).toBe("hello-objectcore--v0.1.0");
  expect(parseReleaseTag("hello-objectcore--v0.1.0")).toEqual({
    name: "hello-objectcore",
    version: "0.1.0",
  });
  expect(parseReleaseTag("not-a-tag")).toBeNull();
});

test("requiresProvenance flags MCP-bundling manifests", () => {
  expect(requiresProvenance({ name: "x" })).toBe(false);
  expect(requiresProvenance({ name: "x", mcpServers: "./mcp.json" })).toBe(true);
});
