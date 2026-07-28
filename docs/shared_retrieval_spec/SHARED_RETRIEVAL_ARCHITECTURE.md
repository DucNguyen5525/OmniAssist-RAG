# 🔄 Shared Retrieval Architecture & Algorithm Sync Specification

> **Target Projects:**
> 1. **OmniAssist-RAG (Web/Backend):** `C:\.dev\.pjs\OmniAssist-RAG` *(TypeScript / Next.js)*
> 2. **support_kb (Desktop Client):** `C:\.dev\.pjs\support_kb` *(Flutter / Dart)*

---

## 🎯 1. Objective & Cross-Project Synchronization Rule

This document defines the unified specification for the **Zero-LLM Lexical & PageIndex Hybrid Retrieval Algorithm**. 

### ⚡ Mandatory Synchronization Rule for AI Agents
Whenever an optimization, weight adjustment, tokenization fix, or algorithm upgrade is implemented in **either** project:
1. **Mirror the Logic:** The corresponding implementation in the second project **MUST** be updated immediately to maintain parity.
2. **Benchmark Parity:** Verify both implementations against the benchmark standard (**Hit@3**, **Recall@6**, **MRR**).
3. **Cross-Reference:** Update this document if the core scoring formula, normalization rules, or RRF parameters are modified.

---

## 📐 2. Unified Algorithm Specification

### A. Vietnamese Normalization & Tokenization
Both implementations must apply identical text preprocessing:
* **Lowercasing:** Strip case sensitivity.
* **Diacritic Removal:** Convert Vietnamese accented characters to non-accented ASCII equivalent (`quy trình hoàn tiền` $\rightarrow$ `quy trinh hoan tien`).
* **Clean Special Chars:** Remove non-alphanumeric punctuation while preserving spaces.
* **Tokenization:** Split text by whitespace into clean word tokens.

### B. Multi-Field Weighted IDF Scoring Formula
For a given query $Q = \{t_1, t_2, \dots, t_n\}$ and candidate node $N$:

$$\text{Score}(N, Q) = \sum_{t \in Q} \text{Weight}(t) \cdot \text{IDF}(t) + \text{Bonus}_{\text{Phrase}} + \text{Bonus}_{\text{IdfCoverage}} + \text{Bonus}_{\text{Level}}$$

#### Field Weights:
* **Title Match:** $+8$ points per occurrence term.
* **Path Match (Parent hierarchy):** $+4$ points per occurrence term.
* **Summary Match:** $+4$ points per occurrence term.
* **Content Match:** $+2$ points per occurrence (capped at max 3 occurrences = $+6$).

#### Bonuses:
* **Phrase Match Bonus:** If normalized query length $> 4$ chars:
  * Title contains exact phrase: $+18$
  * Summary contains exact phrase: $+10$
  * Content contains exact phrase: $+5$
* **Matched IDF Ratio Bonus:** $\left( \frac{\sum_{t \in \text{Matched}} \text{IDF}(t)}{\sum_{t \in Q} \text{IDF}(t)} \right) \cdot 15$
* **Root / Top Level Node Bonus:** $+0.5$ if node level $\le 1$.

#### Inverse Document Frequency (IDF):
$$\text{IDF}(t) = \ln\left(1 + \frac{N_{\text{total}}}{1 + \text{DF}(t)}\right)$$

---

## 🔀 3. Local + Synced Mongo Cache Hybrid Fusion (RRF)

`support_kb` searches two independent local SQLite sources:

1. **Local KB:** the existing application database.
2. **OmniAssist cache:** `omniassist_cache.db`, refreshed only by an explicit
   Sync action from
   `/api/helpdesks/tech-support/sync`.

The sync endpoint must resolve the `tech-support` helpdesk and export only
ready PageIndex documents listed in that helpdesk's `documentSlugs`, plus
nodes belonging to those documents. An empty `documentSlugs` list must return
an empty snapshot and must never fall back to querying all MongoDB documents.
The cache is replaced in one SQLite transaction; a failed sync keeps the last
valid snapshot.

Normal searches do not call the server. They rank both local SQLite result
lists and fuse them as:

$$\text{RRF Score}(d) = \frac{1}{60 + \text{Rank}_{\text{Local}}(d)} + \frac{1}{60 + \text{Rank}_{\text{API}}(d)}$$

* Ranks are one-based and use `k = 60`.
* Local records use identity namespace `local:<entryId>`.
* Synced Mongo nodes use identity namespace
  `mongo:<documentId>:<nodeId>`.
* The two datasets are intentionally distinct; title/path similarity must not
  merge records across namespaces.
* Merged results are sorted by $\text{RRF Score}(d)$ descending to return Top-K items.

---

## 🗂️ 4. Codebase Implementation Mapping

| Module / Feature | TypeScript (`OmniAssist-RAG`) | Flutter / Dart (`support_kb`) |
| :--- | :--- | :--- |
| **Tokenization & Normalization** | `apps/web/lib/server/retrieval.ts` (`normalize`, `tokenize`) | `lib/services/retrieval/text_normalizer.dart` |
| **IDF & Scoring Engine** | `apps/web/lib/server/retrieval.ts` (`buildIdf`, `scoreNode`) | `lib/services/retrieval/lexical_ranker.dart` |
| **PageIndex Tree Flattening** | `apps/web/lib/server/pageindex-flatten.ts` | `lib/services/retrieval/pageindex_tree.dart` |
| **Scoped Sync Snapshot** | `apps/web/lib/server/helpdesk-sync.ts`, `apps/web/app/api/helpdesks/[slug]/sync/route.ts` | `lib/services/retrieval/helpdesk_sync_client.dart` |
| **Synced SQLite FTS5 Cache** | MongoDB `documents` + `pageindex_nodes` selected through `Helpdesk.documentSlugs` | `lib/services/retrieval/remote_cache_store.dart` |
| **Hybrid RRF Fusion** | `apps/web/lib/server/pageindex-retrieval.ts` | `lib/services/retrieval/rrf_fusion.dart` |
| **UI Integration** | `/chat/tech-support` helpdesk configuration | `lib/ui/smart_retrieval_screen.dart`, `lib/ui/settings/settings_tab.dart` |

---

## 🧪 5. Verification & Benchmark Baseline

* **Target Metrics:**
  * **Hit@3:** $\ge 0.76$
  * **Recall@6:** $\ge 0.76$
  * **MRR:** $\ge 0.67$
  * **Latency:** $< 10\text{ms}$ (Local), zero LLM token consumption.

---

## 🚀 6. Next Session Task Checklist for AI Agent

When opening a new session to build/upgrade this retrieval system:
- [x] **Read this file first** to understand the dual-project contract.
- [x] Implement/Update `support_kb` Dart services matching `apps/web/lib/server/retrieval.ts`.
- [x] Add `SmartRetrievalScreen` in `support_kb/lib/ui/smart_retrieval_screen.dart` and register in `home_shell.dart` sidebar (`NavigationRail`).
- [x] Add the scoped snapshot endpoint
      `https://omni-assist-rag-web.vercel.app/api/helpdesks/tech-support/sync`
      (`localhost:3000` remains available as an explicit development
      override).
- [x] Add a separate local SQLite FTS5 cache and manual Sync button; never
      copy the full MongoDB database.
- [x] Run normal RRF searches entirely locally using the existing database and
      the last valid synced cache.
- [x] Run unit tests on both sides to verify ranking equivalence.
