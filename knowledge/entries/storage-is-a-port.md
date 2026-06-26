---
id: storage-is-a-port
type: pattern
title: Storage is a port, not a choice — files first, DB/MCP as later adapters
tags: [architecture, ports, knowledge-base]
source: packages/knowledge/src/types.ts
created: 2026-06-26
---

ObjectCore treats storage as a PORT, then swaps adapters at a trigger — never a
rewrite. The catalog proved it: `CatalogSource` (Git files → Turso at Stage 3)
feeds the pure `deriveCatalog`, served at the frozen `/v1/marketplace.json` seam.

The knowledge base copies the discipline: `KnowledgeStore` is the port;
`FileKnowledgeStore` is operated now (git-tracked, diffable in PRs so every
written lesson is reviewable). A `DbKnowledgeStore` (Turso, reusing
`@objectcore/registry-db`) lights up at the same kind of trigger Stage 3 had. An
MCP resource server is a later ACCESS seam *over* a store (the KB's equivalent of
the HTTP route), not a storage backend. Build files-first behind the port so
DB/MCP are relocations, not rewrites.
