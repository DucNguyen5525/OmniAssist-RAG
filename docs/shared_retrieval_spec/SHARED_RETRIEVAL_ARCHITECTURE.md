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
  * **`đ` $\rightarrow$ `d` must be an explicit mapping.** `đ` (U+0111) has **no
    canonical decomposition**, so a Unicode-NFD-plus-combining-mark-strip
    approach leaves it intact and the punctuation rule below then deletes it.
    `hóa đơn` would become `hoa on`, truncating every word beginning with `đ`
    (`đơn`, `đăng nhập`, `đặt lịch`) at both index and query time.
* **Clean Special Chars:** Remove non-alphanumeric punctuation while preserving spaces.
* **Tokenization:** Split by whitespace, keep tokens of $\ge 2$ characters, cap at 16.
* **Query Stopwords:** The **query only** additionally drops ~28 question
  scaffolding words (`lam`, `sao`, `nao`, `gi`, `how`, `what`, …). Node text is
  never filtered — a word missing from the index is unfindable, whereas a word
  missing from the question merely stops dragging in every node containing it.
  If filtering would empty the list, the unfiltered tokens are used instead.
  The list is deliberately short: with diacritics gone, a Vietnamese "stopword"
  is often a domain term. `the` (thẻ, card — which also rules out English
  `the`), `qua` (quà), `dang` (đăng nhập), `long` (lông), `chi`, `moi`, `dau`,
  `toi`, `ban`, `cung`, `cho` are excluded for that reason.

### B. Multi-Field Weighted IDF Scoring Formula
For a given query $Q = \{t_1, t_2, \dots, t_n\}$ and candidate node $N$:

$$\text{Score}(N, Q) = \sum_{t \in Q} \text{Weight}(t) \cdot \text{Strength}(t) \cdot \text{IDF}(t) + \text{Bonus}_{\text{Bigram}} + \text{Bonus}_{\text{Phrase}} + \text{Bonus}_{\text{IdfCoverage}} + \text{Bonus}_{\text{Level}}$$

#### Match Strength (token boundaries, **not** substrings):
Fields are padded with a leading and trailing space so `" term "` is a
whole-token test and `" term"` a token-prefix one.
* **Whole token:** $\times 1.0$
* **Token prefix** (`pay` in `payment`): $\times 0.5$
* **Inside a token** (`an` in `thanh`): $\times 0$

A raw substring test made `an` match inside `thanh`, `toan`, `ban` and `hoan` on
nearly every node, firing the full field weight each time. A prefix must keep
*some* score rather than merely rank lower: both implementations discard
zero-scoring nodes, and on the `support_kb` side the lexical ranker is the only
ranker for the Sổ tay and the PageIndex cache, so a lost prefix match would make
a note disappear rather than slip.

#### Field Weights:
* **Title Match:** $+8$ points per term.
* **Path Match (Parent hierarchy):** $+4$ points per term.
* **Summary Match:** $+4$ points per term.
* **Content Match:** $+2$ points per matching **token** (capped at 3 = $+6$).

#### Bonuses:
* **Adjacent-Pair (Bigram) Bonus:** for each consecutive pair of query terms
  appearing adjacently in a field — Title $+4$, Path $+2$, Summary $+2$,
  Content $+1$. Vietnamese writes a compound as separate syllables, so token
  scoring alone cannot distinguish `hóa đơn` from `hóa chất` + `đơn hàng`
  occurring separately. This recovers most of what a word segmenter
  (underthesea and similar) would give, with no model, no second index and
  nothing extra to keep in sync. Half the single-token weight of the same field,
  because both syllables have already scored on their own.
* **Phrase Match Bonus:** If normalized query length $> 4$ chars:
  * Title contains exact phrase: $+18$
  * Summary contains exact phrase: $+10$
  * Content contains exact phrase: $+5$
* **Matched IDF Ratio Bonus:** $\left( \frac{\sum_{t \in \text{Matched}} \text{IDF}(t)}{\sum_{t \in Q} \text{IDF}(t)} \right) \cdot 15$
* **Root / Top Level Node Bonus:** $+0.5$ if node level $\le 1$.

#### Inverse Document Frequency (IDF):
$$\text{IDF}(t) = \ln\left(1 + \frac{N_{\text{total}}}{1 + \text{DF}(t)}\right)$$

$\text{DF}(t)$ counts a node when $\text{Strength}(t) > 0$ in any field, i.e. it
uses the same token-boundary rule as scoring.

### C. Parity Tests
Both repositories pin the numbers above directly, with the same fixtures and
the same expected values:
* `support_kb/test/services/retrieval/lexical_ranker_test.dart` and
  `text_normalizer_test.dart`
* `OmniAssist-RAG/apps/web/lib/server/retrieval.test.ts`
  (in `npm run test:pageindex`)

Query `hoàn tiền` against a node titled `Hoàn tiền` must score
$16 \cdot \text{IDF} + 15 + 18 + 0.5 + 4$ on **both** sides. Change one, change
the other, or §1 is broken.

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

### AI context, note identity, and document images

Chat retrieval requests the top 12 ranked nodes from the synchronized Tech
Support cache, then keeps at most the two highest-ranked document identities
and at most three ranked nodes per document. This limits context dilution while
allowing a future second helpdesk document to contribute without mixing node
identities. The response prompt requires numbered citations and may copy only
Markdown image tags already present in the selected node content.

Image references under `/doc-images/` are extracted in document order, capped
at six unique images per node, persisted with chat-source history, and rendered
both inline and as source thumbnails. `support_kb` resolves the current image
set from bundled assets first; the deployed OmniAssist public path is only a
fallback for a newly synchronized image not yet present in the desktop build.
Both Chat AI citations and RRF rows expose **Mở note**, routing by the exact
`documentId + nodeId` or local `entryId`; similar titles must never decide the
destination.

---

## 🗂️ 4. Codebase Implementation Mapping

| Module / Feature | TypeScript (`OmniAssist-RAG`) | Flutter / Dart (`support_kb`) |
| :--- | :--- | :--- |
| **Tokenization & Normalization** | `apps/web/lib/server/retrieval.ts` (`normalize`, `tokenize`) | `lib/services/retrieval/text_normalizer.dart` |
| **IDF & Scoring Engine** | `apps/web/lib/server/retrieval.ts` (`buildIdf`, `scoreNode`, `matchStrength`, `buildBigrams`, `padded`) | `lib/services/retrieval/lexical_ranker.dart` |
| **Parity tests (§2.C)** | `apps/web/lib/server/retrieval.test.ts` (`npm run test:pageindex`) | `test/services/retrieval/lexical_ranker_test.dart`, `text_normalizer_test.dart` |
| **Keyword search UI** | *(none — the web app has no equivalent)* | `lib/data/entry_repository.dart` (`searchEntries`, `_expandedTerms`): FTS5 MATCH OR-ing the whole-query phrase, each individual word and the synonyms. Desktop-only, so it is outside the parity rule |
| **PageIndex Tree Flattening** | `apps/web/lib/server/pageindex-flatten.ts` | `lib/services/retrieval/pageindex_tree.dart` |
| **Scoped Sync Snapshot** | `apps/web/lib/server/helpdesk-sync.ts`, `apps/web/app/api/helpdesks/[slug]/sync/route.ts` | `lib/services/retrieval/helpdesk_sync_client.dart` |
| **Synced SQLite FTS5 Cache** | MongoDB `documents` + `pageindex_nodes` selected through `Helpdesk.documentSlugs` | `lib/services/retrieval/remote_cache_store.dart` |
| **Hybrid RRF Fusion** | `apps/web/lib/server/pageindex-retrieval.ts` | `lib/services/retrieval/rrf_fusion.dart` |
| **Local AI Answer Generation** | `apps/web/lib/server/gemini.ts` | `local_ai_config.dart`, `gcli_client.dart`, `configured_ai_completer.dart`, `local_ai_chat_service.dart`; local cache retrieval + selectable GCLI/OpenRouter/Groq/DeepSeek/Mistral service round-robin/failover + per-service weighted keys/additional prompt, no call to the web `/api/chat` |
| **AI Context Selection** | `apps/web/lib/server/gemini.ts` (`buildContextBlock`) | `lib/services/retrieval/ai_context_selector.dart`; at most two documents and three nodes per document |
| **Document Images** | `apps/web/lib/server/retrieval.ts` (`extractImageUrls`), `components/chat/ChatMessageItem.tsx` | `document_image_refs.dart`, `widgets/omniassist_markdown.dart`, bundled `assets/doc-images/` |
| **UI Integration** | `/chat/tech-support` | `lib/ui/retrieval_workspace_screen.dart` with local `Chat AI` (`ai_chat_screen.dart`) and `Tra cứu RRF` (`smart_retrieval_screen.dart`), plus `settings/settings_tab.dart` |

---

## 🧪 5. Verification & Benchmark Baseline

* **Target Metrics:**
  * **Hit@3:** $\ge 0.76$
  * **Recall@6:** $\ge 0.76$
  * **MRR:** $\ge 0.67$
  * **Latency:** $< 10\text{ms}$ (Local scoring), zero LLM token consumption.

### Current baseline — `OmniAssist-RAG`, 50-case golden set (2026-08-08)

`npm run eval:pageindex -- --strategy lexical --top-k 6`, dataset
`evals/pageindex-retrieval-golden.json`, artifacts in `evals/results/`.

| | before §2 update | after | target |
| :--- | ---: | ---: | ---: |
| **Hit@1** | 0.600 | **0.640** | — |
| **Hit@3** | 0.760 | **0.840** | $\ge 0.76$ |
| **Recall@6** | 0.760 | **0.830** | $\ge 0.76$ |
| **MRR** | 0.6773 | **0.7367** | $\ge 0.67$ |
| **no-answer false positives** | 1.000 | 1.000 | *open* |

Before the update both Hit@3 and Recall@6 sat *exactly* on the threshold and MRR
was 0.007 above it. By category, the whole gain came from **paraphrase**
(Hit@3 $0.533 \rightarrow 0.800$, MRR $0.469 \rightarrow 0.622$, n=15) and
**multi-section** (MRR $0.691 \rightarrow 0.857$, n=7) — precisely what the
stopword and bigram rules target. `exact` and `image` stayed at 1.000, so exact
identifier lookups took no damage. `mixed` MRR moved $0.875 \rightarrow 0.813$
(n=8) with Hit@3 still 1.000, i.e. the right node occasionally sits at rank 2
instead of rank 1 — the one measured regression.

`noAnswerFalsePositiveRate` is unchanged at 1.0: nothing yet rejects a weak
match, so all 5 no-answer cases still return something. That is a separate
threshold problem, tracked in `support_kb/.claude/PROJECT_SUMMARY.md`.

### Harness (`support_kb`)

`test/eval/` measures these numbers. Neither file is named `*_test.dart`, so
neither joins the normal suite — they read local user data no other machine has:

```bash
flutter test test/eval/build_golden_set.dart --concurrency=1   # regenerate the set
flutter test test/eval/run_retrieval_eval.dart --concurrency=1 # measure, diff vs baseline
```

Four surfaces are reported separately — `hybrid` (the RRF tab), `local`
(app.db, which feeds Chat AI), `notebook`, and `searchTab`
(`EntryRepository.searchEntries`, which goes through none of the retrieval
services and would otherwise be unmeasured). **P@5** is added to the three
targets above because `AiContextSelector` gives app.db and the Sổ tay five slots
each: precision inside those five is what decides what the model gets to read.

The golden set holds three label families. `syntheticTitle` and
`syntheticDescription` are generated from `app.db`/`notebook.db`;
`chatHistory` holds real questions harvested from `chat_messages`, and its
labels are **whatever retrieval returned at the time**, so they are a regression
flag for a human, never truth — scoring against them measures "reproduces the
old ranking", which would penalise every real improvement. Output lands in
`data/eval/`, which is gitignored: it contains real merchant questions and must
never be committed.

---

## 🚀 6. Next Session Task Checklist for AI Agent

When opening a new session to build/upgrade this retrieval system:
- [x] **Read this file first** to understand the dual-project contract.
- [x] Token-boundary matching, query stopwords and the adjacent-pair bonus are
      implemented on **both** sides, with §2.C pinning the same numbers in each.
      The `đ` normalization bug on the TypeScript side is fixed; both now emit
      `hoa don`.
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
- [x] Split the desktop Tra cứu workspace into `Chat AI` and `Tra cứu RRF`.
      Chat AI retrieves only the synchronized Tech Support SQLite cache and
      calls the selected local provider; it never calls the deployed web
      `/api/chat`. GCLI, OpenRouter, Groq, DeepSeek, and Mistral AI use the
      OpenAI-compatible `/chat/completions` contract. The user can enable any
      combination; enabled services rotate round-robin and fail over to each
      other, while weighted keys rotate independently inside each service.
      GCLI is shown first in the settings dialog and every service has its own
      collapsible, visually distinct setup panel. AI settings are
      entered only in the application; no AI configuration is read from
      `.env`. API keys are stored in the Windows DPAPI-encrypted
      `flutter_secure_storage.dat` file. Google OAuth is temporarily hidden
      while its existing metadata and secure tokens remain retained for
      possible reactivation. Chat also
      provides an additional system prompt, persistent sessions, title-based
      history search, reopen/delete history, model selection, and a provider
      settings dialog. History, provider settings, the additional prompt, and
      non-secret account metadata live in the runtime-only extensible
      `data/user_data.db`; secrets use OS secure storage. Neither is packaged
      as a Flutter asset. AI answers preserve exact Markdown image references,
      source history stores their image list, and both workspaces open notes by
      exact record identity. RRF remains fully local.
