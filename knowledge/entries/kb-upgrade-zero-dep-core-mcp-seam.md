---
id: kb-upgrade-zero-dep-core-mcp-seam
type: decision
title: KB upgrade keeps the core zero-dep — lexical retrieval now, MCP access seam at the edge
tags: [knowledge-base, architecture, retrieval, mcp, plan-013]
source: plans/013-kb-agent-memory-upgrade.md
created: 2026-07-02
---

Plan 013 upgrades the KB to close the mid-2026 agent-memory gaps (lifecycle/supersede, staleness verification, retrieval, write-time dedup, usage/ROI, MCP access) while keeping `@objectcore/knowledge` zero-dep. Retrieval is a deterministic lexical scorer (BM25-style, field-weighted, id tie-break) precisely so the KB's retrieval evals run OFFLINE inside `bun run check` — a keyed/embedding retriever would make the gate non-deterministic. The semantic upgrade is an at-trigger adapter behind the same `searchEntries`/`kb_search` API (a Judge-port Haiku reranker or an embedding store); re-open only if retrieval evals fail as the corpus grows.

The MCP resource server is the ACCESS seam over `KnowledgeStore` (not a storage backend) and lands in `packages/knowledge-mcp` — the ONLY package depending on `@modelcontextprotocol/sdk`, mirroring `@objectcore/registry-db` as the only `@libsql/client` dependent. Deps live at the edges; the pure core stays dependency-free.
