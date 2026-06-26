import { test, expect } from "bun:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deriveCatalog } from "../src/derive";
import { validateAll, validatePlacement } from "../src/validate";
import type { WorkspacePlugin } from "../src/types";

const fixture: WorkspacePlugin[] = [
  { manifest: { name: "beta-plugin", version: "1.0.0", description: "B" }, dir: "/x/plugins/beta-plugin", relDir: "beta-plugin" },
  { manifest: { name: "alpha-plugin", version: "0.1.0", description: "A" }, dir: "/x/plugins/alpha-plugin", relDir: "alpha-plugin" },
];
const opts = { name: "objectcore", owner: { name: "Dakota" }, pluginRoot: "./plugins" };

test("deriveCatalog is pure (same input -> equal output)", () => {
  expect(deriveCatalog(fixture, opts)).toEqual(deriveCatalog(fixture, opts));
});

test("deriveCatalog sorts entries and sets pluginRoot + bare source", () => {
  const cat = deriveCatalog(fixture, opts);
  expect(cat.plugins.map((p) => p.name)).toEqual(["alpha-plugin", "beta-plugin"]);
  expect(cat.metadata?.pluginRoot).toBe("./plugins");
  expect(cat.plugins[0]!.source).toBe("alpha-plugin");
});

test("a derived catalog passes every check", async () => {
  const cat = deriveCatalog(fixture, opts);
  const errors = (await validateAll(fixture, cat)).filter((i) => i.level === "error");
  expect(errors).toEqual([]);
});

test("a stale catalog entry fails the sync invariant", async () => {
  const cat = deriveCatalog(fixture, opts);
  cat.plugins.push({ name: "ghost-plugin", source: "ghost-plugin" });
  const issues = await validateAll(fixture, cat);
  expect(issues.some((i) => i.plugin === "ghost-plugin" && i.level === "error")).toBe(true);
});

test("a reserved marketplace name is rejected", async () => {
  const cat = deriveCatalog(fixture, { ...opts, name: "anthropic-plugins" });
  const issues = await validateAll(fixture, cat);
  expect(issues.some((i) => i.message.includes("reserved"))).toBe(true);
});

test("placement lint flags a component dir (incl. output-styles) inside .claude-plugin/", async () => {
  const root = await mkdtemp(join(tmpdir(), "place-"));
  try {
    const dir = join(root, "misplaced");
    // The forbidden case: output-styles/ nested under .claude-plugin/ instead of root.
    await mkdir(join(dir, ".claude-plugin", "output-styles"), { recursive: true });
    const plugins: WorkspacePlugin[] = [
      { manifest: { name: "misplaced" }, dir, relDir: "misplaced" },
    ];
    const issues = await validatePlacement(plugins);
    expect(
      issues.some((i) => i.level === "error" && i.message.includes("output-styles")),
    ).toBe(true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a non-string repository is rejected", async () => {
  const bad: WorkspacePlugin[] = [
    { manifest: { name: "bad-plugin", repository: { url: "x" } as unknown as string }, dir: "/x/plugins/bad-plugin", relDir: "bad-plugin" },
  ];
  const cat = deriveCatalog(bad, opts);
  const issues = await validateAll(bad, cat);
  expect(issues.some((i) => i.message.includes("`repository` must be a string"))).toBe(true);
});
