# Project Summary

**Last Updated:** 2026-07-13 +07:00
**Session:** #23 - Admin retrieval debug UI

---

## 1. Project Overview

- **Type:** Full-stack web app MVP for Helpdesk Q&A over preprocessed PageIndex data.
- **Tech Stack:** Next.js 14, React 18, TypeScript, Tailwind CSS, MongoDB Atlas, Cloudflare R2, GCLI Proxy (Key Rotation), PageIndex JSON/tree data.
- **Package Manager:** npm workspaces.
- **i18n:** None. Gemini prompt answers in Vietnamese by default.
- **State Management:** React local state plus browser local storage for retrieval settings.
- **Styling:** Tailwind CSS with McKay Wrigley Chatbot UI design patterns.
- **Deployment:** Vercel for `apps/web`; optional Railway only for `workers/pageindex-ingest` long-running ingestion.

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
apps/web/lib/server/              MongoDB, R2, GCLI/Gemini, Auth, PageIndex import/retrieval, tabular-qa modules
apps/web/lib/server/tabular-qa.ts AMG-mode: LLM schema-linking + deterministic stats over dataset rows
scripts/import-dataset.ts         Local importer for CSV/XLS clinical datasets (datasets/dataset_rows)
scripts/extract-md-images.ts      Extracts base64 images from Google-Docs-exported MD into files + path refs
scripts/md-to-pageindex.ts        Converts cleaned MD (heading tree + large-table row chunks) to PageIndex JSON
scripts/generate-node-summaries.ts Gemini Vietnamese summaries per node (batched, idempotent) into pageindex JSON
scripts/process-doc-images.ts     Enhance (normalize+sharpen) images → WebP into apps/web/public/doc-images + rewrite JSON refs
apps/web/public/doc-images/       Published WebP images per document slug (served statically)
.data/Docs/                       Source documents (Tech Support Manual in md/pdf/txt/html; same content)
docs/                             Research notes + tabular-QA plan + RAG debugging guide (rag-debugging.md)
scripts/debug-retrieval.ts        Retrieval inspector CLI: routing decision + per-node scores + final prompt
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
/api/chat                       Chat Q&A API (supports helpdeskSlug, model, stream:true → NDJSON events)
/api/chat/sessions/[id]         DELETE: remove conversation + its messages
/api/chat/messages/[id]         PATCH: set 👍👎 feedback on an assistant message
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
| PageIndex vectorless retrieval | Completed | `retrieval.ts` | Lexical score over title/path/summary/content; no embeddings. Scoring: content term frequency (capped) + IDF weighting over candidate nodes (rare terms beat generic diacritic-stripped Vietnamese tokens) + IDF-weighted coverage bonus. |
| Vietnamese node summaries | Completed | `scripts/generate-node-summaries.ts` | Gemini (PAGEINDEX_MODEL) writes 1-2 câu tiếng Việt (giữ thuật ngữ Anh) per node into pageindex JSON, batched + idempotent (rerun fills failures); 140/142 tech-support nodes summarized + re-imported. Realistic mixed-language queries now rank target node #1; fully paraphrased VN queries remain a lexical limitation. |
| Markdown answer rendering | Completed | `ChatMessageItem.tsx`, `tailwind.config.ts` | Assistant messages render via react-markdown + remark-gfm with @tailwindcss/typography prose styles; tables wrapped in overflow-x-auto; user messages stay plain text. |
| User-facing UI cleanup | Completed | `ChatHeader/InputBar/MessageItem/EmptyState`, chat page, login page | Tech jargon (PageIndex RAG badge, TopK/Tags row, "Vectorless RAG · Antigravity AI") hidden from chat + login; citations panel renamed "Nguồn tham khảo"; admin/dashboard pages keep technical info. Model dropdown moved from header to above the chat input box. |
| Per-helpdesk document selection | Completed | shared `Helpdesk.documentSlugs`, `repository.ts`, `retrieval.ts`, `/api/chat`, helpdesk routes, dashboard modal | Dashboard create/edit dialog shows checkbox list of imported documents (pageindex mode); explicit `documentSlugs` scoping wins over tags in `listReadyDocuments`; empty selection falls back to tag matching. |
| AI-assisted import (human confirm) | Completed | `import-analyzer.ts`, `POST /api/documents/analyze`, admin documents page | On JSON file select, Gemini compares candidate title+section titles against existing documents and proposes action (new vs update+matchedSlug), title, slug, tags with Vietnamese reason; form is prefilled, human edits and confirms via Import. Verified: same manual → "update tech-support-manual"; marketing doc → "new, tags [marketing]". |
| Images in chat answers | Completed | `scripts/process-doc-images.ts`, `retrieval.ts` (images in SourceReference), `gemini.ts` prompt, `ChatMessageItem.tsx`, `apps/web/public/doc-images/` | sharp: normalize + sharpen + WebP q82 (29.3MB→7.5MB, 561 files); JSON refs rewritten to `/doc-images/<slug>/*.webp` then re-imported; citations show clickable thumbnails; LLM inlines exact image tags when a step is illustrated. `sharp` is a root devDependency (script-only). |
| Delete chat session | Completed | `repository.ts` (deleteConversation), `DELETE /api/chat/sessions/[id]`, `api-client.ts`, `ChatSidebar.tsx`, chat page | Trash icon per sidebar session (hover) + header "Xóa chat" for active session → custom confirmation modal → deletes conversation + messages from MongoDB. Header button on an unsaved chat just resets the view. Browser-verified incl. reload. |
| Per-request AI model selection | Completed | `env.ts`, `gemini.ts`, `/api/models`, `/api/chat`, `ChatHeader.tsx`, chat page, `settings.ts` | `GCLI_MODELS` env lists allowed models; chat header dropdown lets user pick (saved in local storage); priority request model → helpdesk.model → `GCLI_MODEL` default; invalid model silently falls back to default. |
| 2-stage doc routing | Completed | `doc-router.ts`, `pageindex-importer.ts`, `repository.ts` (docSummary), `/api/chat` | Import generates a Vietnamese `docSummary` per document (best-effort, never blocks import); when a chat has >1 candidate documents the LLM routes the question to the relevant slugs first, then lexical retrieval runs inside them. Falls back to all candidates on router failure. E2E verified: warranty question → warranty doc, DEJAVOO question → tech-support-manual. |
| Streaming chat answers | Completed | `gemini.ts` (createChatCompletionStream + generateGroundedAnswerStream), `/api/chat` (stream flag → NDJSON), `api-client.ts` (askStream), chat page | GCLI SSE deltas piped as NDJSON events (`meta` with sources → `delta`s → `done` with messageId; `error` on failure). Assistant message saved to Mongo after the stream completes. AMG mode replies as one delta (numbers computed in TS). Frontend renders deltas incrementally. |
| 👍👎 answer feedback | Completed | shared `MessageFeedback`, `repository.ts` (setMessageFeedback), `PATCH /api/chat/messages/[id]`, `ChatMessageItem.tsx`, chat page | Hover thumbs on assistant messages; toggle persists `feedback: up/down/null` on the message record (optimistic UI). Loaded back with session history. |
| Vitest unit tests | Completed | `apps/web/lib/server/__tests__/*` (14 tests), `scoreCandidates` export in `retrieval.ts` | `npm run test` → flattenPageIndexTree (tree/paths/dedup/fallbacks), retrieval scoring (IDF ranking, phrase bonus, stuffing cap, zero-score) + extractImageUrls, import-analyzer normalizeSuggestion. Tests exposed & fixed a bug: level≤1 bonus no longer lets non-matching nodes pass the score>0 filter. |
| Follow-up question rewriting | Completed | `question-rewriter.ts`, `/api/chat` | Câu follow-up trong hội thoại ("còn máy P8 thì sao?") được LLM viết lại thành câu hỏi độc lập (dựa trên ≤6 message gần nhất) trước khi routing/retrieval/generation; message lưu Mongo vẫn là nguyên văn người dùng. Fallback về câu gốc khi LLM lỗi/trả về quá dài. Server log dòng `Follow-up rewritten for retrieval:` khi có viết lại. E2E verified: "con may P8 thi bi loi nay xu ly the nao?" → "May P8 khong ket noi duoc wifi thi xu ly the nao?". |
| Chat session question cap | Completed | `/api/chat`, `api-client.ts` | Existing sessions accept up to 6 user questions. The 7th question returns HTTP 429 before storing the user message or calling rewrite/retrieval/LLM; frontend maps 429 to a start-new-session message. |
| RAG debugging guide + inspector CLI/Admin UI | Completed | `docs/rag-debugging.md`, `scripts/debug-retrieval.ts`, `/api/chat/debug`, `/admin/debug`, `buildGroundedPrompt` export in `gemini.ts` | Decision tree tùy biến cho pipeline vectorless (route→retrieve→prompt→generate). CLI: `npm run debug:retrieval '--' --helpdesk <slug> "câu hỏi"` prints candidates, routing decision, scored nodes (selected = lọt topK), prompt with `--show-prompt`/`--no-route`/`--top N`; PS 5.1 phải quote `'--'`. Admin `/admin/debug` now selects helpdesk, runs the same scoped routing/scoring flow, and shows candidate docs, routing status, scored node table, node details, and final prompt. |
| Tabular-QA retrieval mode (`amg`) | Completed | `tabular-qa.ts`, `/api/chat`, `import-dataset.ts`, dashboard/settings UI | LLM plans query → code computes count/proportion (categorical equals OR numeric threshold via compare/value)/mean/median/min/max/groupBy/correlation over `dataset_rows`; numbers computed in TS (not LLM). Per-helpdesk `retrievalMode` + `datasetSlug`. Ingest of dengue CSV/XLS is user-run. |
| Shock-risk prediction | Completed | `prediction.ts`, `scripts/train-shock-model.ts`, `/api/predict`, `/predict/[modelSlug]`, repository `prediction_models` | TS logistic regression on paper1 `dengue-baseline` enrolment features (no leakage); 5-fold CV AUROC 0.787; artifact stored in Mongo; `/api/predict` GET model info + POST case→probability + top contributions; `/predict/shock-baseline` case-input form (public route). Research tool only, not clinical. Train via `npm run train:shock`. |
| GCLI Key Rotation LLM layer | Completed | `gemini.ts`, `env.ts`, `/api/chat` | Replaces raw Gemini SDK with SWRR/Weighted Random key rotation, failover, model mapping. |
| PageIndex import API/UI | Completed | `/api/documents/import`, admin documents page | Imports existing PageIndex JSON. |
| Local TS import script | Completed | `scripts/import-pageindex.ts` | `npm run import:pageindex -- --file ...`. |
| MD base64 image extraction | Completed | `scripts/extract-md-images.ts` | Ran on `.data/Docs/Tech Support Manual.md`: 561 images extracted, cleaned MD 41MB → 281KB in `Tech Support Manual-extracted/`. On PowerShell call `npx tsx scripts/extract-md-images.ts --file ...` (npm swallows `--`). |
| MD → PageIndex JSON converter | Completed | `scripts/md-to-pageindex.ts` | Heading tree → node tree; tables with >15 data rows split into child chunk nodes (header repeated). Tech Support Manual: 155 nodes (24 table chunks). |
| Tech Support Manual ingest + E2E test | Completed | MongoDB `tech-support-manual` doc | Imported (155 nodes, tags `helpdesk`,`tech-support`); chat E2E verified: DEJAVOO double-item question (VI + EN) and tip-setup question answered correctly with DEJAVOO ISSUES / Set up Tip citations. |
| Optional Python ingestion worker | Completed | `workers/pageindex-ingest/*` | Not run in Vercel runtime. |
| Authentication | Planning | None | Needed before public use. |

**Legend:** Planning / In Progress / Completed

---

## 5. Known Issues & TODOs

### High Priority

- [x] Run `npm install` to update dependencies.
- [ ] Refresh or regenerate `package-lock.json` if needed.
- [ ] Verify MongoDB Atlas and R2 credentials in a real environment.
- [ ] Add authentication/admin gate before public deployment.

### Medium Priority

- [ ] Ingest dengue datasets into MongoDB, e.g. `npm run import:dataset -- --file "D:/Dev/4.research-pj/Papers/paper1/pntd.0005498.s003/baseline.csv" --slug dengue-baseline --title "Dengue baseline" --source paper1` (repeat for `plt.csv` and paper2 `.xls`), then create an `amg` helpdesk pointing at the dataset slug.
- [x] Create a `pageindex` helpdesk for `tech-support-manual` (slug `tech-support`, tags `tech-support`, topK 6) — scoped chat verified via API (Batch Reject QD question answered with correct section citation).
- [x] Validate chat + model dropdown in the browser UI at `/chat/tech-support` — verified via Chrome automation: dashboard card, model dropdown switch to `gemini-3.5-flash` (server log confirmed model used), grounded answer with correct `Update Auto Batch Time or Set up Tax` citation and PageIndex citations drawer.
- [x] Generate per-node Vietnamese `summary` with Gemini (`scripts/generate-node-summaries.ts`) and re-import — done for tech-support-manual (140/142 nodes).
- [x] Images in chat answers: 561 images enhanced (normalize+sharpen) → WebP (29.3MB→7.5MB) in `apps/web/public/doc-images/tech-support-manual/`; node refs rewritten to `/doc-images/...webp`; sources carry `images[]` (thumbnails in citations drawer); Gemini instructed to inline relevant image tags (verified: Clerk ID answer embedded image453 at the right step). R2 hosting can replace public/ later if credentials are configured.
- [ ] End-to-end test `amg` mode against a real dataset (e.g. verify proportion queries match the paper reports).
- [x] Re-run `npm run typecheck` and `npm run build` after dependencies install.
- [x] Add tests for `flattenPageIndexTree`, retrieval scoring, and import-analyzer normalization (vitest, 14 tests; chat route with mocked Gemini still open).
- [ ] Physically delete `apps/api/` and `supabase/` on a machine where Windows filesystem permits deletion.

### Low Priority / Nice to Have

- [ ] Add richer PageIndex schema normalization if real PageIndex JSON differs from supported shapes.
- [x] Add streaming Gemini responses (NDJSON stream via /api/chat).
- [x] Add feedback UI and API route (stored on the message record, not a separate collection).
- [ ] Add tests for the chat route with mocked Gemini.

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
- `vitest` (devDependency in apps/web) - Unit tests for flatten/retrieval/import-analyzer.
- `xlsx` (devDependency) - Parses CSV/XLS in `scripts/import-dataset.ts`; not in Vercel runtime bundle.

### External APIs / Services

- MongoDB Atlas - Documents, PageIndex nodes, conversations, messages, feedback.
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
- **Storage:** Use R2 only through `apps/web/lib/server/r2.ts` or worker tooling.
- **PageIndex processing:** Keep it in `workers/pageindex-ingest/` or local scripts, not Vercel runtime.
- **Legacy dirs:** Treat `apps/api/` and `supabase/` as disabled legacy artifacts unless explicitly cleaning filesystem locks.

### Testing checklist:

- [ ] `npm install`
- [ ] `npm run build --workspace @helpdesk/shared`
- [ ] `npm run typecheck`
- [ ] `npm run build`
- [ ] Import PageIndex JSON against real MongoDB/R2.
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
npm run test
npm run build
npm run import:pageindex -- --file ./data/warranty-index.json --title "Warranty Policy" --slug warranty-policy --tags helpdesk,warranty
npm run debug:retrieval '--' --helpdesk tech-support "câu hỏi cần debug"   # PS 5.1: phải quote '--'
```

Python worker commands must be run only inside the approved Conda environment for this workspace.

---

**Critical:** Read this entire file before making any changes to the project.
