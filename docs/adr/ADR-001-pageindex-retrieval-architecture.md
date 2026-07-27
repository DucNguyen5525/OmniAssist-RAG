# ADR-001: PageIndex retrieval architecture

- Status: Accepted for experimental implementation; production rollout rejected
- Date: 2026-07-27
- Related plan: `docs/plan-pageindex-retrieval-evolution.md`

## Decision

Keep `lexical` as the production default. Retain Candidate A (`tree-reasoning`) behind
`PAGEINDEX_REASONING_ENABLED=false` as an experimental retriever with strict scope
validation, timeout, diagnostics, and lexical fallback.

Do not migrate to Candidate B or deploy Candidate C in this iteration:

- B fits the current MongoDB size limit, but the existing document has no persisted raw
  PageIndex artifact. Reconstructing a tree from flat nodes cannot recover upstream
  metadata that was never stored.
- The self-hosted PageIndex reference at commit
  `39121c4d3479edeb049fb1e37045f3227bf50355` exposes indexing plus
  `get_document`, `get_document_structure`, and `get_page_content`. Its public example
  performs retrieval with an LLM agent over those tools. It does not expose the
  dashboard's MCTS/value-function retrieval engine. A separate service would therefore
  wrap the same pattern while adding network and operations.
- Candidate D was not evaluated because enhanced OCR/managed storage is not required
  for the already-ingested manual and no privacy/cost approval was provided.

Production canary must not begin until a future candidate passes both quality and
operational gates on the full golden set.

## Evidence

### Corpus and baseline

- Helpdesk: `tech-support`
- Document: `tech-support-manual`
- MongoDB nodes: 155 total, 142 with content
- Golden set: 50 human-verified cases
- Baseline artifact: `evals/results/baseline-lexical-v1.json`

Full lexical baseline:

| Metric | Result |
|---|---:|
| Hit@1 | 0.6000 |
| Hit@3 | 0.7600 |
| Recall@6 | 0.7600 |
| MRR | 0.6773 |
| Paraphrase Hit@3 | 0.5333 |
| Exact Hit@3 | 1.0000 |
| No-answer false-positive | 1.0000 |
| p95 retrieval | 1,213.83 ms |

### Same-case 15-query spike

Artifacts:

- `evals/results/spike-lexical-v1.json`
- `evals/results/spike-tree-reasoning-v1.json`
- `evals/results/spike-tree-reasoning-prompt-v2.json`
- `evals/results/spike-tree-reasoning-full-outline-v3.json`
- `evals/results/spike-tree-reasoning-gemini-2.5-flash-v4.json`

The decisive quality comparison used the same 15 representative cases and `topK=6`:

| Metric | Lexical | Tree, full outline |
|---|---:|---:|
| Hit@1 | 0.6000 | 1.0000 |
| Hit@3 | 0.6667 | 1.0000 |
| Recall@6 | 0.6667 | 1.0000 |
| MRR | 0.6333 | 1.0000 |
| Paraphrase Hit@3 | 0.5000 | 1.0000 |
| Exact Hit@3 | 1.0000 | 1.0000 |
| No-answer false-positive | 1.0000 | 0.0000 |
| p95 retrieval | 1,961.68 ms | 12,577.54 ms |
| Fallback rate | 0% | 6.67% |
| LLM calls/query | 0 | 1 |

Tree reasoning passed the measured quality thresholds, including a 50 percentage-point
paraphrase Hit@3 gain and zero scope violations. It failed the initial tree retrieval
p95 target of 3.5 seconds.

Changing only the reasoning model to `gemini-2.5-flash` reduced p50 to about 3 seconds,
but schema/timeout fallback rose to 46.67%, p95 remained 13.33 seconds, and quality
regressed. The structured parser was subsequently made tolerant of an omitted
`insufficientEvidence` field, but that does not resolve upstream tail latency.

### Outline and storage feasibility

Artifact: `evals/results/architecture-feasibility.json`

| Measurement | Result |
|---|---:|
| 30k outline coverage | 121/155 (78.06%) |
| 50k/full outline size | 38,439 characters |
| Reconstructed nested tree | 389,753 bytes |
| MongoDB 16 MB limit usage | 2.32% |
| Raw tree source available | No |

The initial 30k outline omitted 34 nodes and caused false selections of broad sections.
Increasing the budget to 50k was the single change that produced perfect spike quality.

## Weighted decision matrix

Scores are 1–10. Weighted total is also on a 10-point scale.

| Option | Quality 35% | Citation 15% | Latency 15% | Cost 10% | Ops 10% | Migration 10% | Vendor 5% | Total |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Current lexical control | 6 | 10 | 9 | 10 | 10 | 10 | 10 | **8.45** |
| A: TypeScript tree reasoning | 9 | 10 | 2 | 5 | 8 | 10 | 6 | **7.55** |
| B: Tree-native storage | 5 | 9 | 7 | 8 | 5 | 3 | 8 | **6.15** |
| C: PageIndex service | 5 | 8 | 3 | 4 | 2 | 5 | 3 | **4.65** |

Candidate A wins among new candidates and is the only one implemented as an experiment.
The lexical control remains the production decision because A fails the operational gate.

## Implemented boundaries

- `PageIndexRetrievalStrategy` is separate from `RetrievalMode`; AMG remains isolated.
- `retrievePageIndex` dispatches strategies and defaults safely to lexical.
- All tree selections are untrusted and must map back to the scoped document/node map.
- Unknown, duplicate, contradictory, empty-content, malformed, timed-out, and disabled
  reasoning paths cannot bypass the lexical fallback.
- An AbortSignal cancels timed-out GCLI fetches so a fallback does not leave an
  unbounded request running.
- No prompt, full outline, document body, API key, or token is logged.
- Debug retrieval returns diagnostics; normal chat continues returning answer/sources.

## Rollout and rollback

Current rollout state:

```text
PAGEINDEX_RETRIEVAL_STRATEGY=lexical
PAGEINDEX_REASONING_ENABLED=false
```

Future canary prerequisites:

1. Resolve GCLI p95 and invalid-key tail latency.
2. Run all 50 cases with the exact production model/config.
3. Meet the plan's quality and operational gates.
4. Enable one helpdesk only and monitor fallback/citation behavior.

Rollback is setting the strategy to `lexical` or disabling reasoning. No data migration
or manual recovery is required.

## Consequences

Positive:

- The project now has reproducible retrieval evals and evidence-based gates.
- Tree reasoning can be improved without changing AMG or production behavior.
- Scope validation and rollback exist before experimental activation.

Negative:

- Experimental tree queries add one LLM call and currently have unacceptable tail
  latency.
- The golden set covers one helpdesk/document and must expand with the corpus.
- Raw PageIndex metadata still is not the source of truth; future imports should retain
  raw JSON if Candidate B is reconsidered.

## Continuation results: key health and compact references

On 2026-07-27, the next optimization phase tested one change at a time on the same
15-case spike:

1. A process-local GCLI circuit breaker disables keys after HTTP 401/403.
2. Compact references replace long node keys in the prompt with `n000`-style aliases,
   then map them back to exact scoped node keys before context/citation construction.
3. Three reasoning model routes were compared without changing the golden labels.

Artifacts:

- `evals/results/spike-tree-reasoning-key-circuit-v5.json`
- `evals/results/spike-tree-reasoning-compact-refs-v6.json`
- `evals/results/spike-tree-reasoning-compact-preview-v7.json`
- `evals/results/spike-tree-reasoning-compact-gemini-3-flash-v8.json`

| Configuration | Hit@3 | Recall@6 | No-answer FP | Fallback | p50 | p95 |
|---|---:|---:|---:|---:|---:|---:|
| 2.5 Flash, full refs, circuit breaker | 0.8667 | 0.8667 | 0.6667 | 0% | 2.34s | 3.85s |
| 2.5 Flash, compact refs | 0.9333 | 0.9000 | 0.3333 | 0% | 1.92s | 5.78s |
| 3 Flash Preview, compact refs | 1.0000 | 1.0000 | 0.0000 | 26.67% | 6.55s | 12.86s |
| 3 Flash, compact refs | 0.9333 | 0.9333 | 0.0000 | 0% | 6.36s | 9.47s |

The circuit breaker eliminated repeated use of the rejected key and removed fallback
from the 2.5 Flash run. Compact references reduced the full outline from 38,439 to
30,627 characters while preserving 155/155 node coverage and exact scope mapping.

No configuration passed both quality and the 3.5-second p95 operational target.
Therefore the decision remains unchanged:

- no full 50-case tree run;
- no canary;
- lexical remains production;
- compact references remain optional and disabled by default;
- circuit breaking remains enabled because it improves all GCLI traffic without
  changing retrieval semantics.
