import { test, expect } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileTokenSource } from "../src/sources";
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
