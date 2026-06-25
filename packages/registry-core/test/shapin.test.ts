import { test, expect } from "bun:test";
import { deriveCatalog } from "../src/derive";
import { validateSchema } from "../src/schema";
import { validateAll } from "../src/validate";
import type { WorkspacePlugin } from "../src/types";

const fixture: WorkspacePlugin[] = [
  { manifest: { name: "alpha-plugin", version: "0.1.0", description: "A" }, dir: "/x/plugins/alpha-plugin", relDir: "alpha-plugin" },
  { manifest: { name: "beta-plugin", version: "1.0.0", description: "B" }, dir: "/x/plugins/beta-plugin", relDir: "beta-plugin" },
];
const opts = { name: "objectcore", owner: { name: "Dakota" }, pluginRoot: "./plugins" };

test("no shaPin -> derivation is byte-identical (bare path sources)", () => {
  const cat = deriveCatalog(fixture, opts);
  expect(cat.plugins[0]!.source).toBe("alpha-plugin");
  expect(cat.plugins[1]!.source).toBe("beta-plugin");
});

test("shaPin upgrades the pinned entry to an immutable git-subdir source", () => {
  const cat = deriveCatalog(fixture, {
    ...opts,
    repoUrl: "https://github.com/twofoldtech-dakota/objectcore",
    shaPin: { "alpha-plugin": "abc123def456" },
  });
  expect(cat.plugins[0]!.source).toEqual({
    source: "git-subdir",
    url: "https://github.com/twofoldtech-dakota/objectcore",
    path: "plugins/alpha-plugin",
    sha: "abc123def456",
    ref: "alpha-plugin--v0.1.0",
  });
  // unpinned entry stays a bare path
  expect(cat.plugins[1]!.source).toBe("beta-plugin");
});

test("shaPin without repoUrl is a hard error", () => {
  expect(() =>
    deriveCatalog(fixture, { ...opts, shaPin: { "alpha-plugin": "abc123" } }),
  ).toThrow(/repoUrl/);
});

test("validateSchema rejects an unknown manifest field (typo)", () => {
  const bad: WorkspacePlugin[] = [
    { manifest: { name: "typo-plugin", keyword: ["x"] } as never, dir: "/x", relDir: "typo-plugin" },
  ];
  const issues = validateSchema(bad);
  expect(issues.some((i) => i.message.includes("unknown manifest field `keyword`"))).toBe(true);
});

test("validateSchema rejects a malformed author and accepts a good one", () => {
  const bad: WorkspacePlugin[] = [
    { manifest: { name: "p", author: { url: "x" } } as never, dir: "/x", relDir: "p" },
  ];
  expect(validateSchema(bad).some((i) => i.message.includes("author.name"))).toBe(true);

  const good: WorkspacePlugin[] = [
    { manifest: { name: "p", author: { name: "Dakota", email: "d@x.com" } }, dir: "/x", relDir: "p" },
  ];
  expect(validateSchema(good)).toEqual([]);
});

test("validateAll runs the schema check alongside the rest", async () => {
  const bad: WorkspacePlugin[] = [
    { manifest: { name: "p", description: "d", bogusField: 1 } as never, dir: "/x", relDir: "p" },
  ];
  const cat = deriveCatalog(bad, opts);
  const issues = await validateAll(bad, cat);
  expect(issues.some((i) => i.message.includes("unknown manifest field `bogusField`"))).toBe(true);
});
