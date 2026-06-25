import { test, expect } from "bun:test";
import { searchCatalog, type MarketplaceJson } from "../src/index";

const catalog: MarketplaceJson = {
  name: "objectcore",
  owner: { name: "Dakota" },
  plugins: [
    { name: "commit-craft", source: "commit-craft", description: "Write great git commit messages", keywords: ["git", "commits"], category: "workflow" },
    { name: "alpha-plugin", source: "alpha-plugin", description: "Alpha demo", keywords: ["demo"], category: "example" },
  ],
};

test("q matches a substring of the description", () => {
  expect(searchCatalog(catalog, { q: "commit" }).plugins.map((p) => p.name)).toEqual(["commit-craft"]);
});
test("q matches a keyword", () => {
  expect(searchCatalog(catalog, { q: "git" }).plugins.map((p) => p.name)).toEqual(["commit-craft"]);
});
test("keyword is an exact (case-insensitive) filter", () => {
  expect(searchCatalog(catalog, { keyword: "Demo" }).plugins.map((p) => p.name)).toEqual(["alpha-plugin"]);
});
test("category filters", () => {
  expect(searchCatalog(catalog, { category: "workflow" }).plugins.map((p) => p.name)).toEqual(["commit-craft"]);
});
test("filters combine with AND", () => {
  expect(searchCatalog(catalog, { q: "demo", category: "workflow" }).count).toBe(0);
});
test("an empty query returns all entries", () => {
  expect(searchCatalog(catalog, {}).count).toBe(2);
});
