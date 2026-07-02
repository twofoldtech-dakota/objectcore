import { test, expect } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileTokenSource, loadSystemManifest } from "../src/sources";
import { deriveDesignSystem } from "../src/derive";

test("FileTokenSource loads *.tokens.json sets + resolver.json, deriving themed output", async () => {
  const dir = await mkdtemp(join(tmpdir(), "design-src-"));
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "primitives.tokens.json"),
      JSON.stringify({ color: { $type: "color", white: { $value: "#ffffff" }, black: { $value: "#000000" } } }),
    );
    await writeFile(
      join(dir, "semantic-light.tokens.json"),
      JSON.stringify({ bg: { $type: "color", $value: "{color.white}" } }),
    );
    await writeFile(
      join(dir, "semantic-dark.tokens.json"),
      JSON.stringify({ bg: { $type: "color", $value: "{color.black}" } }),
    );
    await writeFile(
      join(dir, "resolver.json"),
      JSON.stringify({
        resolutionOrder: ["primitives", "theme"],
        modifiers: [{ name: "theme", contexts: { light: ["semantic-light"], dark: ["semantic-dark"] } }],
        themes: [
          { name: "light", context: { theme: "light" } },
          { name: "dark", context: { theme: "dark" } },
        ],
      }),
    );

    const source = await new FileTokenSource(dir).load();
    expect(Object.keys(source.sets).sort()).toEqual(["primitives", "semantic-dark", "semantic-light"]);
    expect(source.themes?.map((t) => t.name)).toEqual(["light", "dark"]);

    const out = deriveDesignSystem(source);
    expect(out.issues.filter((i) => i.level === "error")).toEqual([]);
    expect(out.themes.find((t) => t.name === "light")!.tokens.find((t) => t.path === "bg")?.value).toBe("#ffffff");
    expect(out.themes.find((t) => t.name === "dark")!.tokens.find((t) => t.path === "bg")?.value).toBe("#000000");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("FileTokenSource labels a malformed *.tokens.json with its file path", async () => {
  const dir = await mkdtemp(join(tmpdir(), "design-src-"));
  try {
    await writeFile(join(dir, "primitives.tokens.json"), "{ trailing comma, }");
    expect(new FileTokenSource(dir).load()).rejects.toThrow(/primitives\.tokens\.json/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("FileTokenSource labels a malformed resolver.json with its file path", async () => {
  const dir = await mkdtemp(join(tmpdir(), "design-src-"));
  try {
    await writeFile(join(dir, "primitives.tokens.json"), "{}");
    await writeFile(join(dir, "resolver.json"), "not json");
    expect(new FileTokenSource(dir).load()).rejects.toThrow(/resolver\.json/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("FileTokenSource returns empty sets for a missing directory", async () => {
  const source = await new FileTokenSource(join(tmpdir(), "does-not-exist-xyz")).load();
  expect(source.sets).toEqual({});
});

// ── loadSystemManifest (plan 014) ─────────────────────────────────────────────

test("loadSystemManifest defaults to AA/presence when system.json is absent (ENOENT)", async () => {
  const manifest = await loadSystemManifest(join(tmpdir(), "does-not-exist-xyz"));
  expect(manifest).toEqual({ gate: { level: "AA", coverage: "presence" } });
});

test("loadSystemManifest loads a full manifest (level, coverage, seed provenance)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "design-src-"));
  try {
    await writeFile(
      join(dir, "system.json"),
      JSON.stringify({
        gate: { level: "AAA", coverage: "full" },
        seed: { preset: "inkwell", version: "2.2.0", themes: ["paper", "ink"] },
      }),
    );
    const manifest = await loadSystemManifest(dir);
    expect(manifest.gate).toEqual({ level: "AAA", coverage: "full" });
    expect(manifest.seed).toEqual({ preset: "inkwell", version: "2.2.0", themes: ["paper", "ink"] });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("loadSystemManifest accepts the scaffold's minimal manifest (coverage stays optional)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "design-src-"));
  try {
    await writeFile(join(dir, "system.json"), JSON.stringify({ gate: { level: "AA" } }));
    const manifest = await loadSystemManifest(dir);
    expect(manifest.gate.level).toBe("AA");
    expect(manifest.gate.coverage).toBeUndefined();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("loadSystemManifest fails LOUDLY (with the path) on malformed JSON", async () => {
  const dir = await mkdtemp(join(tmpdir(), "design-src-"));
  try {
    await writeFile(join(dir, "system.json"), "{ not json");
    expect(loadSystemManifest(dir)).rejects.toThrow(/system\.json/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("loadSystemManifest rejects a bad gate.level and unknown keys — never a silent default", async () => {
  const dir = await mkdtemp(join(tmpdir(), "design-src-"));
  try {
    await writeFile(join(dir, "system.json"), JSON.stringify({ gate: { level: "AAAA" } }));
    expect(loadSystemManifest(dir)).rejects.toThrow(/gate\.level/);
    // a typo'd gate key would silently gate at the looser default — reject-unknown
    await writeFile(join(dir, "system.json"), JSON.stringify({ gate: { level: "AAA", coverge: "full" } }));
    expect(loadSystemManifest(dir)).rejects.toThrow(/coverge/);
    await writeFile(join(dir, "system.json"), JSON.stringify({ gaet: { level: "AAA" } }));
    expect(loadSystemManifest(dir)).rejects.toThrow(/gaet/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("system.json is not a token set: FileTokenSource's *.tokens.json glob ignores it", async () => {
  const dir = await mkdtemp(join(tmpdir(), "design-src-"));
  try {
    await writeFile(join(dir, "primitives.tokens.json"), JSON.stringify({}));
    await writeFile(join(dir, "system.json"), JSON.stringify({ gate: { level: "AA" } }));
    const source = await new FileTokenSource(dir).load();
    expect(Object.keys(source.sets)).toEqual(["primitives"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
