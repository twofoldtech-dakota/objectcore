// Pure search over a derived catalog. No I/O, no dependencies — the same posture
// as deriveCatalog: the route is a thin adapter over this function.
import type { MarketplaceEntry, MarketplaceJson } from "./types";

export interface SearchQuery {
  q?: string;
  keyword?: string;
  category?: string;
}

export interface SearchResult {
  query: SearchQuery;
  count: number;
  plugins: MarketplaceEntry[];
}

export function searchCatalog(catalog: MarketplaceJson, query: SearchQuery): SearchResult {
  const q = query.q?.trim().toLowerCase();
  const keyword = query.keyword?.trim().toLowerCase();
  const category = query.category?.trim().toLowerCase();

  const plugins = catalog.plugins.filter((e) => {
    if (q) {
      const hay = [e.name, e.displayName, e.description, ...(e.keywords ?? [])]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (keyword && !(e.keywords ?? []).some((k) => k.toLowerCase() === keyword)) return false;
    if (category && (e.category ?? "").toLowerCase() !== category) return false;
    return true;
  });

  return { query, count: plugins.length, plugins };
}
