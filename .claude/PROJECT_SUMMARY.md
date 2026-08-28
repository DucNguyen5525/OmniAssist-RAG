# Project Summary

**Last Updated:** 2026-08-08
**Session:** #26 - Brought `retrieval.ts` into parity with `support_kb` under the shared spec. Scoring moved from raw substring `includes` to token boundaries (whole token full weight, token prefix x0.5, a term inside a token 0), the query now drops ~28 question stopwords (node text never is), consecutive query token pairs earn an adjacent-pair bonus that stands in for Vietnamese word segmentation, and `normalize` maps `đ -> d` explicitly: NFD leaves U+0111 whole, so the punctuation strip was deleting it and `hóa đơn` tokenized as `hoa on`. New `retrieval.test.ts` pins the same numbers the Dart tests pin. 50-case lexical eval: Hit@3 0.76 -> 0.84, Recall@6 0.76 -> 0.83, MRR 0.6773 -> 0.7367, the whole gain coming from the paraphrase and multi-section categories.

**Session:** #25 - Documented that support_kb now runs Chat AI retrieval locally and uses weighted GCLI keys instead of the web chat API.

---

## 1. Project Overview

- **Type:** Full-stack web app MVP for Helpdesk Q&A over preprocessed PageIndex data.
- **Tech Stack:** Next.js 14, React 18, TypeScript, Tailwind CSS, MongoDB Atlas, Cloudflare R2, GCLI Proxy (Key Rotation), PageIndex JSON/tree data.
- **Package Manager:** npm workspaces.
- **i18n:** None. Gemini prompt answers in Vietnamese by default.
- **State Management:** React local state plus browser local storage for retrieval settings.
- **Styling:** Tailwind CSS with McKay Wrigley Chatbot UI design patterns.
- **Deployment:** `apps/web` is deployed at
  `https://omni-assist-rag-web.vercel.app/`; optional Railway is used only for
  `workers/pageindex-ingest` long-running ingestion. Redeploy Vercel after
  changes to the desktop sync route.

---

## 2. File Structure

### Key Directories

```text
apps/web/                         Next.js UI and API runtime
apps/web/app/login/               Auth login page (LittleKai / Duc365bmt)
apps/web/app/dashboard/           Helpdesk management dashboard UI
apps/web/app/chat/[helpdeskSlug]/ Helpdesk-scoped Chat UI
apps/web/app/api/auth/            Auth API routes (login, logout, check)
apps/web/app/api/helpdesks/       Helpdesk CRUD API routes
apps/web/app/api/helpdesks/[slug]/sync/ Read-only scoped PageIndex snapshot API
apps/web/lib/server/              MongoDB, R2, GCLI/Gemini, Auth, PageIndex import/retrieval, tabular-qa modules
apps/web/lib/server/tabular-qa.ts AMG-mode: LLM schema-linking + deterministic stats over dataset rows
scripts/import-dataset.ts         Local importer for CSV/XLS clinical datasets (datasets/dataset_rows)
scripts/eval-pageindex-retrieval.ts 50-case golden retrieval eval and JSON result artifacts
scripts/spike-pageindex-architecture.ts Tree outline/storage/service feasibility measurements
evals/                             PageIndex golden set and reproducible eval artifacts
docs/adr/                          Architecture decisions backed by retrieval metrics
scripts/extract-md-images.ts      Extracts base64 images from Google-Docs-exported MD into files + path refs
scripts/md-to-pageindex.ts        Converts cleaned MD (heading tree + large-table row chunks) to PageIndex JSON
scripts/generate-node-summaries.ts Gemini Vietnamese summaries per node (batched, idempotent) into pageindex JSON
scripts/process-doc-images.ts     Enhance (normalize+sharpen) images → WebP into apps/web/public/doc-images + rewrite JSON refs
apps/web/public/doc-images/       Published WebP images per document slug (served statically)
.data/Docs/                       Source documents (Tech Support Manual in md/pdf/txt/html; same content)
docs/                             Research notes + tabular-QA plan (research-amg-tabular-qa.md, plan-tabular-qa-v1.md)
apps/web/components/chat/         Chatbot UI components (Sidebar, InputBar, MessageItem, Header, EmptyState)
apps/web/app/admin/documents/     PageIndex JSON import and document list UI
apps/web/app/admin/debug/         Vectorless retrieval debug UI
apps/web/app/settings/            Retrieval topK/tag settings UI
packages/shared/                  Shared TypeScript contracts
scripts/import-pageindex.ts       Local TS importer for existing PageIndex JSON
workers/pageindex-ingest/         Optional Python worker/tooling for PageIndex processing
```

### Critical Files

| File | Purpose | Notes |
| --- | --- | --- |
| `package.json` | Root workspace scripts | Builds shared and web only. |
| `.env.example` | MongoDB/R2/GCLI/Auth env template | AUTH_USERNAME, AUTH_PASSWORD, AUTH_SECRET. |
| `apps/web/middleware.ts` | Next.js Edge Auth Middleware | Protects all routes except `/login` and `/api/auth/*`. |
| `apps/web/lib/server/auth.ts` | Server Auth module | Signed HMAC-SHA256 session cookie validation. |
| `apps/web/lib/server/repository.ts` | MongoDB repository | Documents, nodes, conversations, messages, helpdesks. |
| `apps/web/app/login/page.tsx` | Login UI | Authenticates `LittleKai` / `Duc365bmt`. |
| `apps/web/app/dashboard/page.tsx` | Dashboard UI | List, create, and manage isolated helpdesks. |
| `apps/web/app/chat/[helpdeskSlug]/page.tsx` | Scoped Chatbot UI | Helpdesk-specific chat with custom tags, topK, and systemPrompt. |
| `.claude/skills/pageindex-ingestion.md` | PageIndex Ingestion Skill | Added Step 0 for helpdesk type confirmation before upload. |

---

## 3. Architecture & Patterns

### Component Structure

Frontend uses functional React components in Next.js app router pages. Client pages use `"use client"` for state, file inputs, and local storage.

### State Management

State remains page-local. Retrieval settings store `topK` and comma-separated tag filters in local storage.

### Styling Approach

Tailwind utility classes directly in TSX. UI follows McKay Wrigley Chatbot UI design standards.

### API Integration

Frontend calls same-origin Next API routes through `apps/web/lib/api-client.ts`. `NEXT_PUBLIC_API_URL` is no longer used.

### Routing

```text
/login                          Login page
/dashboard                      Dashboard (List/Create helpdesks)
/chat/[helpdeskSlug]            Dynamic chat route per helpdesk
/admin/documents                Document import UI
/admin/debug                    Vectorless retrieval debug
/settings                       Global retrieval defaults
/api/auth/login                 Login API
/api/auth/logout                Logout API
/api/auth/check                 Auth check API
/api/helpdesks                  Helpdesk list/create API
/api/helpdesks/[slug]           Helpdesk get/update/delete API
/api/helpdesks/[slug]/sync      GET versioned snapshot of linked ready PageIndex documents/nodes
/api/chat                       Chat Q&A API (supports helpdeskSlug, model)
/api/chat/sessions/[id]         DELETE: remove conversation + its messages
/api/documents/analyze          POST: AI suggests import action (new/update, slug, tags)
/api/models                     Available AI models list (GCLI_MODELS + default)
```

### Backend Layers

Runtime server logic is under `apps/web/lib/server/`. API route handlers parse/validate HTTP input and call modules for repository, retrieval, import, R2, and Gemini/GCLI.

---

## 4. Active Features & Status

| Feature | Status | Files Involved | Notes |
| --- | --- | --- | --- |
| Next.js runtime consolidation | Completed | `package.json`, `apps/web/app/api/*` | Main API deploys with Vercel. |
| Authentication System | Completed | `apps/web/middleware.ts`, `auth.ts`, `/login` | Cookie-based auth for `LittleKai` / `Duc365bmt`. |
| Multi-Helpdesk System | Completed | `/dashboard`, `/chat/[helpdeskSlug]`, `/api/helpdesks` | Isolated helpdesks with custom tags, topK, systemPrompt. |
| Chatbot UI Upgrade (McKay Wrigley) | Completed | `apps/web/app/chat/[helpdeskSlug]/page.tsx`, `components/chat/*` | Session history sidebar, prompt starters, markdown formatting, PageIndex citations drawer. |
| PageIndex Ingestion Skill Update | Completed | `.claude/skills/pageindex-ingestion.md` | Step 0 added for helpdesk selection prompt before upload. |
| Dify removal | Completed | Full repo scan | No Dify code/env/routes found in current source. |
| Supabase/pgvector removal from runtime | Completed | `package.json`, `.env.example`, `README.md`, `LEGACY_DISABLED.md` | Old dirs remain OS-locked but disabled and ignored. |
| MongoDB data layer | Completed | `mongodb.ts`, `repository.ts` | Connection caching and collection indexes. |
| Cloudflare R2 layer | Completed | `r2.ts`, importer modules | Used for optional PageIndex JSON backup. |
| PageIndex vectorless retrieval | Completed | `retrieval.ts`, `retrieval.test.ts` | Lexical score over title/path/summary/content; no embeddings. Scoring: token-boundary matching (whole token x1, token prefix x0.5, inside a token 0) + content token frequency (capped) + IDF weighting over candidate nodes + adjacent-pair bonus + IDF-weighted coverage bonus. Query-side stopwords only. Governed by `docs/shared_retrieval_spec/SHARED_RETRIEVAL_ARCHITECTURE.md` — any change here must be mirrored in `support_kb` and re-benchmarked on both sides. |
| PageIndex retrieval evolution | Completed (no production rollout) | `evals/*`, `pageindex-{tree,reasoning,retrieval}.ts`, `ADR-001` | 50-case lexical baseline is reproducible. Follow-up v5-v8 added a 401/403 key circuit breaker and optional compact node refs (38,439 -> 30,627 chars, full coverage). Best quality config still had p95 12.86s; fastest reliable config failed quality/no-answer gates. No full tree eval/canary was allowed. Lexical remains default. |
| Reference integration hardening | Completed | `pageindex-{flatten,artifact}.ts`, Python ingestion worker, `evals/ragas/*` | Official VectifyAI schema now imports correctly (upstream sample: 1 bogus node before -> 41 valid nodes after). Raw trees are versioned with producer/hash metadata, PageIndex and Ragas commits are pinned. Live smoke tests passed for the pinned PageIndex worker, R2 + Mongo persistence/cleanup, and all five Ragas metrics through GCLI. Production retrieval remains lexical. |
| Legacy PageIndex data migration | Completed | `migrate_legacy_pageindex.py`, `legacy_tree_reconstruction.py`, MongoDB/R2 | `tech-support-manual` was backed up locally and to R2, reconstructed from its 155 production nodes, and backfilled with schema/provenance/hash plus one raw-tree version. All 155 node IDs and 142 evidence nodes were preserved; full 50-case lexical metrics remained identical. |
| Vietnamese node summaries | Completed | `scripts/generate-node-summaries.ts` | Gemini (PAGEINDEX_MODEL) writes 1-2 câu tiếng Việt (giữ thuật ngữ Anh) per node into pageindex JSON, batched + idempotent (rerun fills failures); 140/142 tech-support nodes summarized + re-imported. Realistic mixed-language queries now rank target node #1. Fully paraphrased VN queries were the remaining lexical weakness and are the category the Session-#26 scoring change fixed most: paraphrase Hit@3 0.533 -> 0.800, MRR 0.469 -> 0.622. |
| Markdown answer rendering | Completed | `ChatMessageItem.tsx`, `tailwind.config.ts` | Assistant messages render via react-markdown + remark-gfm with @tailwindcss/typography prose styles; tables wrapped in overflow-x-auto; user messages stay plain text. |
| User-facing UI cleanup | Completed | `ChatHeader/InputBar/MessageItem/EmptyState`, chat page, login page | Tech jargon (PageIndex RAG badge, TopK/Tags row, "Vectorless RAG · Antigravity AI") hidden from chat + login; citations panel renamed "Nguồn tham khảo"; admin/dashboard pages keep technical info. Model dropdown moved from header to above the chat input box. |
| Per-helpdesk document selection | Completed | shared `Helpdesk.documentSlugs`, `repository.ts`, `retrieval.ts`, `/api/chat`, helpdesk routes, dashboard modal | Dashboard create/edit dialog shows checkbox list of imported documents (pageindex mode); explicit `documentSlugs` scoping wins over tags in `listReadyDocuments`; empty selection falls back to tag matching. |
| Scoped support_kb cache snapshot | Completed | shared `HelpdeskSyncSnapshot`, `helpdesk-sync.ts`, `repository.ts`, `/api/helpdesks/[slug]/sync` | Exports only ready documents explicitly named by the helpdesk's `documentSlugs` and only their nodes. Empty selection returns an empty snapshot rather than querying all MongoDB data. Stable SHA-256 version supports no-op client syncs. |
| AI-assisted import (human confirm) | Completed | `import-analyzer.ts`, `POST /api/documents/analyze`, admin documents page | On JSON file select, Gemini compares candidate title+section titles against existing documents and proposes action (new vs update+matchedSlug), title, slug, tags with Vietnamese reason; form is prefilled, human edits and confirms via Import. Verified: same manual → "update tech-support-manual"; marketing doc → "new, tags [marketing]". |
| Images in chat answers | Completed | `scripts/process-doc-images.ts`, `retrieval.ts` (images in SourceReference), `gemini.ts` prompt, `ChatMessageItem.tsx`, `apps/web/public/doc-images/` | sharp: normalize + sharpen + WebP q82 (29.3MB→7.5MB, 561 files); JSON refs rewritten to `/doc-images/<slug>/*.webp` then re-imported; citations show clickable thumbnails; LLM inlines exact image tags when a step is illustrated. `sharp` is a root devDependency (script-only). |
| Delete chat session | Completed | `repository.ts` (deleteConversation), `DELETE /api/chat/sessions/[id]`, `api-client.ts`, `ChatSidebar.tsx`, chat page | Trash icon per sidebar session (hover) + header "Xóa chat" for active session → custom confirmation modal → deletes conversation + messages from MongoDB. Header button on an unsaved chat just resets the view. Browser-verified incl. reload. |
| Per-request AI model selection | Completed | `env.ts`, `gemini.ts`, `/api/models`, `/api/chat`, `ChatHeader.tsx`, chat page, `settings.ts` | `GCLI_MODELS` env lists allowed models; chat header dropdown lets user pick (saved in local storage); priority request model → helpdesk.model → `GCLI_MODEL` default; invalid model silently falls back to default. |
| Tabular-QA retrieval mode (`amg`) | Completed | `tabular-qa.ts`, `/api/chat`, `import-dataset.ts`, dashboard/settings UI | LLM plans query → code computes count/proportion (categorical equals OR numeric threshold via compare/value)/mean/median/min/max/groupBy/correlation over `dataset_rows`; numbers computed in TS (not LLM). Per-helpdesk `retrievalMode` + `datasetSlug`. Ingest of dengue CSV/XLS is user-run. |
| Shock-risk prediction | Completed | `prediction.ts`, `scripts/train-shock-model.ts`, `/api/predict`, `/predict/[modelSlug]`, repository `prediction_models` | TS logistic regression on paper1 `dengue-baseline` enrolment features (no leakage); 5-fold CV AUROC 0.787; artifact stored in Mongo; `/api/predict` GET model info + POST case→probability + top contributions; `/predict/shock-baseline` case-input form (public route). Research tool only, not clinical. Train via `npm run train:shock`. |
| GCLI Key Rotation LLM layer | Completed | `gemini.ts`, `env.ts`, `/api/chat` | Replaces raw Gemini SDK with SWRR/Weighted Random key rotation, failover, model mapping. |
| PageIndex import API/UI | Completed | `/api/documents/import`, admin documents page | Imports official `structure/node_id/start_index/end_index` and internal camelCase JSON; stores the raw artifact plus producer/hash metadata and a flattened retrieval read model. |
| Local TS import script | Completed | `scripts/import-pageindex.ts` | `npm run import:pageindex -- --file ...`. |
| MD base64 image extraction | Completed | `scripts/extract-md-images.ts` | Ran on `.data/Docs/Tech Support Manual.md`: 561 images extracted, cleaned MD 41MB → 281KB in `Tech Support Manual-extracted/`. On PowerShell call `npx tsx scripts/extract-md-images.ts --file ...` (npm swallows `--`). |
| MD → PageIndex JSON converter | Completed | `scripts/md-to-pageindex.ts` | Heading tree → node tree; tables with >15 data rows split into child chunk nodes (header repeated). Tech Support Manual: 155 nodes (24 table chunks). |
| Tech Support Manual ingest + E2E test | Completed | MongoDB `tech-support-manual` doc | Imported (155 nodes, tags `helpdesk`,`tech-support`); chat E2E verified: DEJAVOO double-item question (VI + EN) and tip-setup question answered correctly with DEJAVOO ISSUES / Set up Tip citations. |
| Optional Python ingestion worker | Completed | `workers/pageindex-ingest/*` | Uses pinned PageIndex commit `39121c4`, Python 3.13 in `.venv-pageindex`, calls the real upstream entrypoint, validates evidence text, and records producer version. `smoke:pageindex-ingestion` verifies R2 + Mongo then cleans up exact smoke artifacts. Not run in Vercel runtime. |
| Authentication | Planning | None | Needed before public use. |
| Automated tests | In Progress | `gemini.test.ts`, `helpdesk-sync.test.ts`, `pageindex-{artifact,flatten,tree,reasoning}.test.ts`, Python worker/Ragas tests | 18 TypeScript, 4 PageIndex Python, and 3 Ragas Python tests pass; route/import/scoring coverage remains to be added. |

**Legend:** Planning / In Progress / Completed

---

## 5. Known Issues & TODOs

### High Priority

- [x] Run `npm install` to update dependencies.
- [ ] Refresh or regenerate `package-lock.json` if needed.
- [x] Verify MongoDB Atlas and R2 credentials in a real environment (write/read/delete smoke passed with cleanup verification).
- [ ] Add authentication/admin gate before public deployment.

### Medium Priority

- [ ] Ingest dengue datasets into MongoDB, e.g. `npm run import:dataset -- --file "D:/Dev/4.research-pj/Papers/paper1/pntd.0005498.s003/baseline.csv" --slug dengue-baseline --title "Dengue baseline" --source paper1` (repeat for `plt.csv` and paper2 `.xls`), then create an `amg` helpdesk pointing at the dataset slug.
- [x] Create a `pageindex` helpdesk for `tech-support-manual` (slug `tech-support`, tags `tech-support`, topK 6) — scoped chat verified via API (Batch Reject QD question answered with correct section citation).
- [x] Validate chat + model dropdown in the browser UI at `/chat/tech-support` — verified via Chrome automation: dashboard card, model dropdown switch to `gemini-3.5-flash` (server log confirmed model used), grounded answer with correct `Update Auto Batch Time or Set up Tax` citation and PageIndex citations drawer.
- [x] Generate per-node Vietnamese `summary` with Gemini (`scripts/generate-node-summaries.ts`) and re-import — done for tech-support-manual (140/142 nodes).
- [x] Images in chat answers: 561 images enhanced (normalize+sharpen) → WebP (29.3MB→7.5MB) in `apps/web/public/doc-images/tech-support-manual/`; node refs rewritten to `/doc-images/...webp`; sources carry `images[]` (thumbnails in citations drawer); Gemini instructed to inline relevant image tags (verified: Clerk ID answer embedded image453 at the right step). R2 hosting can replace public/ later if credentials are configured.
- [ ] End-to-end test `amg` mode against a real dataset (e.g. verify proportion queries match the paper reports).
- [x] Re-run `npm run typecheck` and `npm run build` after dependencies install.
- [x] Add official-schema and artifact tests for `flattenPageIndexTree` in TypeScript and Python.
- [x] Retrieval scoring tests: `retrieval.test.ts` covers normalization (including `đ`), stopword filtering, token-boundary strength, the adjacent-pair bonus and the exact IDF/phrase/level totals, and runs in `npm run test:pageindex`.
- [ ] Add tests for the import route and the chat route with mocked Gemini.
- [x] Execute `docs/plan-pageindex-retrieval-evolution.md`: 50-case golden set, reproducible baseline/regression, A/B/C spike, ADR, guarded dispatcher, tests, docs, typecheck, and build completed. Production rollout correctly stopped at the failed tree-reasoning latency gate.
- [x] Prevent repeated invalid GCLI key usage: HTTP 401/403 now disables that key for the process; tested across consecutive requests.
- [ ] Tree reasoning still fails the combined quality + p95 gate after v5-v8 ablations. Do not run full tree eval/canary until the upstream model route can meet both; production must remain `lexical`.
- [ ] Physically delete `apps/api/` and `supabase/` on a machine where Windows filesystem permits deletion.

### Low Priority / Nice to Have

- [x] Normalize the audited official PageIndex schema and preserve its raw artifact/producer metadata.
- [ ] Add streaming Gemini responses.
- [ ] Add feedback UI and API route for `feedback` collection.

---

## 6. Dependencies & External Resources

### Key Dependencies

- `next` - UI and API runtime.
- `react`, `react-dom` - UI runtime.
- `tailwindcss` - Styling.
- `lucide-react` - Icons.
- `mongodb` - MongoDB Atlas client for Next.js API routes.
- `@aws-sdk/client-s3` - S3-compatible Cloudflare R2 client.
- `zod` - API validation.
- `tsx` - Local TypeScript import script runner.
- `xlsx` (devDependency) - Parses CSV/XLS in `scripts/import-dataset.ts`; not in Vercel runtime bundle.

### External APIs / Services

- MongoDB Atlas - Documents, PageIndex nodes, conversations, messages, feedback.
- support_kb desktop - Its Chat AI retrieves from the scoped SQLite cache
  locally and calls GCLI with a weighted key pool from its own ignored `.env`;
  it does not call the web `/api/chat`. It pulls the scoped `tech-support`
  snapshot only when its user presses Sync via
  `GET https://omni-assist-rag-web.vercel.app/api/helpdesks/tech-support/sync`.
- Cloudflare R2 - Original files and PageIndex JSON backups.
- GCLI Proxy Upstream - OpenAI-compatible endpoint for Gemini models with key rotation.
- Vercel - Main app/runtime deployment.
- Railway - Optional worker deployment only.

---

## 7. Important Notes for Claude

### When making changes to:

- **Retrieval:** Do not add embeddings, vector search, pgvector, or vector DB calls.
- **Runtime APIs:** Add Next.js API routes in `apps/web/app/api`, not Express routes.
- **Persistence:** Use `apps/web/lib/server/repository.ts` and MongoDB.
- **Desktop sync:** Never export all documents as a fallback. Resolve
  `Helpdesk.documentSlugs`, keep only ready linked PageIndex documents, then
  load nodes for those document IDs.
- **Storage:** Use R2 only through `apps/web/lib/server/r2.ts` or worker tooling.
- **PageIndex processing:** Keep it in `workers/pageindex-ingest/` or local scripts, not Vercel runtime.
- **Legacy dirs:** Treat `apps/api/` and `supabase/` as disabled legacy artifacts unless explicitly cleaning filesystem locks.

### Testing checklist:

- [ ] `npm install`
- [x] `npm run build --workspace @helpdesk/shared`
- [x] `npm run typecheck`
- [x] `npm run build`
- [x] `npm run test:pageindex` (18 passing)
- [x] Import PageIndex JSON against real MongoDB/R2.
- [ ] Ask a chat question and verify sources.

### Do not forget to:

- Update this file's timestamp and session number after changes.
- Follow `.claude/CONVENTIONS.md`.
- Keep `.claude/IMPORTANT_FIXED_BUGS.md` only for important recurring-risk bugs.

---

## 8. Quick Commands

```bash
npm install
npm run dev --workspace @helpdesk/web
npm run typecheck
npm run build
npm run test:pageindex
npm run test:pageindex-python
npm run test:ragas-python
npm run eval:pageindex -- --helpdesk tech-support --strategy lexical --top-k 6
npm run eval:ragas -- --input evals/ragas-answer-eval.example.json --validate-only
npm run smoke:pageindex-ingestion -- --index-json evals/fixtures/pageindex-worker-smoke.json
npm run spike:pageindex
npm run import:pageindex -- --file ./data/warranty-index.json --title "Warranty Policy" --slug warranty-policy --tags helpdesk,warranty
```

PageIndex worker commands use `.venv-pageindex` (Python 3.13); Ragas commands
use `.venv-ragas` (Python 3.14). Both environments are local and git-ignored.

---

**Critical:** Read this entire file before making any changes to the project.
