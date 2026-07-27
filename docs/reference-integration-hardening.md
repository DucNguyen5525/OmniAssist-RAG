# Reference integration hardening

**Date:** 2026-07-27  
**Status:** Implemented; production retrieval strategy unchanged

## PageIndex

- Supports official `structure`, `node_id`, `start_index`, `end_index`,
  `line_num`, `prefix_summary`, `nodes`, and `text` fields.
- Preserves the existing internal camelCase import contract.
- Rejects duplicate upstream node IDs instead of silently dropping data.
- Stores an immutable raw artifact in `pageindex_trees` when it fits safely
  below the MongoDB document limit.
- Requires an external `indexFileUrl`/R2 artifact for oversized raw trees.
- Records schema version, producer, producer commit, canonical SHA-256 hash,
  byte size, and node count.
- Pins the audited PageIndex checkout to commit
  `39121c4d3479edeb049fb1e37045f3227bf50355`.
- Uses the actual upstream `run_pageindex.py --pdf_path/--md_path` entrypoint.
- Explicitly requests node text from PageIndex because its upstream default is
  summary-only. Import rejects trees with no evidence text instead of marking a
  document ready when lexical retrieval cannot answer from it.

Empirical compatibility check:

- Before: the official `q1-fy25-earnings_structure.json` sample normalized to
  one synthetic `Untitled section`.
- After: the same sample normalizes to 41 nodes with stable upstream IDs,
  hierarchy, and page indices.

## Ragas

- Pins the audited reference to commit
  `298b68274234c060deacab3cf5fb52aa3a20e885`.
- Adds a validated offline dataset contract and evaluator.
- Measures faithfulness, context precision, answer relevancy, and—when
  human references are complete—context recall and factual correctness.
- Remains opt-in and outside the production request path.

## Safety boundary

This work does not change `PAGEINDEX_RETRIEVAL_STRATEGY=lexical`. The
tree-reasoning production canary remains blocked by the latency/quality gate in
ADR-001.

## Final verification

- TypeScript PageIndex tests: 15 passed.
- Python PageIndex worker tests: 4 passed.
- Typecheck and Next.js production build: passed.
- Ragas dataset validation: 2 valid cases with complete references.
- Full lexical regression (50 cases): Hit@1 `0.60`, Hit@3 `0.76`,
  Recall@6 `0.76`, MRR `0.6773`, zero LLM calls and zero fallbacks.
- Artifact:
  `evals/results/post-reference-hardening-lexical-v4.json`.

Operational smoke verification:

- The pinned PageIndex worker processed a real Markdown fixture into four
  official-schema nodes, all with evidence text.
- R2 + MongoDB ingestion persisted four nodes, producer commit, canonical
  content hash, and inline raw tree; exact smoke artifacts were then deleted
  and cleanup was verified.
- The pinned Ragas evaluator completed all five metrics through the configured
  OpenAI-compatible endpoint. Two-case integration smoke results are stored in
  `evals/results/ragas-answer-smoke-v1.json`; they validate the evaluator path,
  not production answer quality.
