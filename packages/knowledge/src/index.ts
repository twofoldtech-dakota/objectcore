export * from "./types";
export { parseEntry, serializeEntry } from "./frontmatter";
export { renderIndex, isActive, checkIndexBudget, INDEX_MAX_LINES, INDEX_MAX_BYTES } from "./render";
export type { BudgetCheck } from "./render";
export { checkLifecycle } from "./lifecycle";
export { parseSourceRefs, assessStaleness, type Freshness, type SourceRef, type PathEvidence, type StalenessAssessment } from "./staleness";
export { tokenize, searchEntries, runRetrievalCases, type SearchOptions, type SearchHit, type RetrievalCase, type RetrievalCaseResult } from "./search";
export { findNearDuplicates, DUP_THRESHOLD, type DuplicateMatch } from "./dedup";
export { FileKnowledgeStore } from "./file-store";
