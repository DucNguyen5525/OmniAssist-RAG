# Kế hoạch — Nâng cấp PageIndex Retrieval theo hướng eval-first

**Ngày:** 2026-07-27  
**Trạng thái:** Hoàn tất Phase 1–5 và Phase 7; Phase 6 không triển khai vì
tree-reasoning không vượt quality/latency gate, production tiếp tục dùng lexical
**Mục tiêu:** Nâng chất lượng retrieval của OmniAssist-RAG, cho phép thay đổi kiến trúc hiện tại nếu phương án mới chứng minh tốt hơn bằng cùng một bộ đánh giá.

---

## 0. Kết luận định hướng

OmniAssist-RAG đã dùng PageIndex ở tầng ingestion và dữ liệu, nhưng runtime hiện flatten cây rồi chấm điểm lexical trên `title`, `path`, `summary` và `content`. Kế hoạch này không mặc định cấu trúc đó phải được giữ nguyên.

Nguyên tắc:

1. Đo lexical retrieval hiện tại làm baseline trước khi sửa.
2. Prototype các phương án trên cùng golden dataset.
3. Chọn kiến trúc theo chất lượng, latency, chi phí và độ vận hành.
4. Cho phép thay schema/storage/service boundary nếu lợi ích đủ lớn.
5. Mọi phương án mới phải có migration, fallback và rollback.
6. Không đổi production mặc định chỉ vì demo “có vẻ tốt hơn”.

Ứng viên ban đầu:

- **A — Incremental:** reasoning theo cây bằng TypeScript trên node MongoDB hiện có.
- **B — Tree-native:** lưu và truy xuất PageIndex tree nguyên bản, flat node chỉ là read model/cache.
- **C — PageIndex service:** dùng SDK/engine chính thức trong Python worker/service riêng.
- **D — Managed PageIndex:** dùng API/cloud retrieval nếu local engine không đạt chất lượng hoặc khó vận hành.

Không thêm embedding/vector DB trong phạm vi kế hoạch này. Nếu sau eval muốn khảo sát hybrid/vector, phải lập ADR/phạm vi riêng vì đó là thay đổi retrieval paradigm, không chỉ thay cấu trúc.

---

## 1. Bối cảnh hiện tại

### Data flow

```text
PDF/Markdown
  -> PageIndex CLI hoặc converter nội bộ
  -> PageIndex JSON tree
  -> flatten
  -> MongoDB pageindex_nodes
  -> lexical + IDF scoring
  -> Gemini grounded answer
  -> citations
```

### File quan trọng

- `apps/web/lib/server/retrieval.ts`
- `apps/web/lib/server/pageindex-flatten.ts`
- `apps/web/lib/server/pageindex-importer.ts`
- `apps/web/lib/server/repository.ts`
- `apps/web/lib/server/gemini.ts`
- `apps/web/app/api/chat/route.ts`
- `apps/web/app/api/chat/retrieve/route.ts`
- `workers/pageindex-ingest/`

### Điểm mạnh cần bảo toàn hoặc thay thế tương đương

- Helpdesk/document scoping bằng tags và `documentSlugs`.
- Citation có document, section path, page range và image.
- MongoDB persistence đơn giản.
- Vercel runtime nhẹ.
- Lexical retrieval nhanh, rẻ và deterministic.
- `amg` là retrieval mode độc lập.

### Giới hạn đã biết

- Runtime không thực hiện PageIndex reasoning/tree search.
- Fully paraphrased Vietnamese query có thể không khớp tài liệu tiếng Anh.
- Flatten tree làm yếu quan hệ cha–con trong quá trình retrieve.
- `getNodesForDocuments` có giới hạn mặc định theo document.
- Chưa có golden retrieval dataset hoặc regression test tự động.
- Worker gọi PageIndex CLI cài riêng, chưa pin/version-integrate chặt.

---

## 2. Phạm vi và ngoài phạm vi

### Trong phạm vi

- Golden dataset và retrieval eval harness.
- Lexical baseline.
- Tree-aware/reasoning retrieval.
- So sánh nhiều kiến trúc.
- Thay schema MongoDB nếu cần.
- Thêm collection/tree artifact nếu cần.
- Tách retrieval thành service riêng nếu kết quả tốt hơn rõ ràng.
- Tích hợp PageIndex SDK/API trong worker/service, không bắt buộc giữ CLI.
- Feature flag, diagnostics, canary và rollback.
- Unit/integration/E2E tests cho đường retrieval được chọn.

### Ngoài phạm vi

- Thay toàn bộ chat UI.
- Thay Gemini answer-generation nếu retrieval chưa được đánh giá riêng.
- LangGraph, web search hoặc multi-agent orchestration.
- Embedding/vector database.
- Knowledge graph.
- Ragas/LLM-as-judge trong CI v1.
- Thay đổi `amg`.

---

## 3. Success metrics

### Golden set tối thiểu

Tạo ít nhất 50 case:

| Nhóm | Số case tối thiểu |
|---|---:|
| Exact terminology | 10 |
| Vietnamese paraphrase | 15 |
| Mixed Vietnamese/English | 8 |
| Multi-section/multi-hop | 7 |
| Image-assisted | 5 |
| No-answer | 5 |

Schema:

```ts
interface RetrievalGoldenCase {
  id: string;
  question: string;
  helpdeskSlug: string;
  relevantNodeIds: string[];
  acceptableAncestorNodeIds?: string[];
  category:
    | "exact"
    | "paraphrase"
    | "mixed"
    | "multi-section"
    | "image"
    | "no-answer";
  notes?: string;
}
```

### Retrieval metrics

- Hit@1, Hit@3
- Recall@6
- MRR
- No-answer false-positive rate
- p50/p95 latency
- LLM calls/query
- Token/cost estimate/query
- Fallback rate
- Error rate

### Cổng chất lượng

Phương án mới chỉ đủ điều kiện rollout khi:

- Paraphrase Hit@3 tăng ít nhất **15 điểm phần trăm**.
- Overall Recall@6 không giảm.
- Exact-query Hit@3 không giảm quá **2 điểm phần trăm**.
- No-answer false-positive không tăng quá **5 điểm phần trăm**.
- Citation scope violations bằng **0**.
- Error có thể fallback đạt **100%** trong fault tests.

### Cổng vận hành

Mục tiêu ban đầu:

- Incremental/tree-native p95 retrieval: dưới **3.5 giây**.
- Service/cloud p95 retrieval: dưới **5 giây**.
- Có health check, timeout và circuit/fallback.
- Rollback không yêu cầu khôi phục dữ liệu thủ công.

Nếu hai phương án có chất lượng gần nhau trong biên 2 điểm phần trăm, ưu tiên phương án:

1. Ít dịch vụ hơn.
2. Chi phí/query thấp hơn.
3. Dễ debug hơn.
4. Ít migration hơn.

---

## 4. Phase 0 — Baseline bắt buộc

### Deliverables

- `evals/pageindex-retrieval-golden.json`
- `scripts/eval-pageindex-retrieval.ts`
- npm script:

  ```json
  "eval:pageindex": "tsx scripts/eval-pageindex-retrieval.ts"
  ```

- JSON result artifact có:
  - timestamp;
  - git commit;
  - strategy/version;
  - model;
  - topK;
  - aggregate metrics;
  - category metrics;
  - per-case result;
  - latency.

### CLI

```bash
npm run eval:pageindex -- \
  --helpdesk tech-support \
  --strategy lexical \
  --top-k 6
```

### Quy tắc baseline

- Không đổi lexical formula trước khi baseline được lưu.
- Relevant node ID phải được human-verified.
- Dùng cùng document scope và topK cho mọi candidate.
- Retrieval eval tách khỏi answer-generation eval.
- No-answer case không được gắn một node “gần đúng”.

**Exit gate:** baseline chạy lặp lại được và tạo cùng metrics trên cùng dữ liệu.

---

## 5. Architecture spike

Mỗi candidate phải implement đủ một vertical slice nhỏ:

- 15 golden cases đại diện;
- cùng tài liệu;
- cùng topK;
- có latency;
- có lỗi/fallback cơ bản;
- chưa cần UI.

### Candidate A — TypeScript tree reasoning trên MongoDB hiện tại

```text
Mongo flat nodes
  -> reconstruct forest
  -> compact outline
  -> LLM selects node IDs
  -> validate
  -> expand selected branches
  -> RetrievedNode[]
```

#### Ưu điểm

- Ít migration.
- Chạy trong Next.js runtime.
- Tái sử dụng GCLI key rotation, model selection và citations.
- Rollback lexical đơn giản.

#### Nhược điểm

- Phải tự viết tree prompt/traversal.
- LLM outline có thể lớn.
- Runtime request giữ thêm trách nhiệm.
- Không chắc tương đương engine PageIndex chính thức.

#### Spike files

- `apps/web/lib/server/pageindex-tree.ts`
- `apps/web/lib/server/pageindex-reasoning.ts`
- debug route integration

### Candidate B — Tree-native storage/read model

```text
PageIndex JSON
  -> store immutable raw tree artifact
  -> store tree metadata/version
  -> optional flat read model for lexical/debug
  -> native tree traversal for reasoning
```

#### Schema đề xuất

Collection `pageindex_trees`:

```ts
interface PageIndexTreeRecord {
  documentId: ObjectId;
  schemaVersion: number;
  producer: "vectify-pageindex" | "internal-md-converter";
  producerVersion?: string;
  rootNodes: unknown[];
  nodeCount: number;
  contentHash: string;
  createdAt: Date;
  updatedAt: Date;
}
```

`pageindex_nodes` trở thành derived read model, không còn source of truth duy nhất.

#### Ưu điểm

- Không mất cấu trúc/metadata upstream.
- Dễ reprocess flat read model.
- Tương thích tốt hơn với SDK/version mới.
- Tree traversal không cần reconstruct từ flat records.

#### Nhược điểm

- Migration/import changes.
- Phải dual-write hoặc rebuild.
- Raw tree có thể lớn; cần kiểm tra MongoDB 16 MB document limit.

#### Spike cần trả lời

- Raw tree trung bình/lớn nhất bao nhiêu?
- Có vượt Mongo document limit không?
- Một tree/document hay tree nodes riêng?
- Hash/version/idempotency hoạt động thế nào?
- Có cần lưu raw JSON ở R2 và Mongo chỉ giữ manifest không?

### Candidate C — PageIndex SDK/service riêng

```text
Next.js
  -> internal retrieval HTTP API
  -> Python PageIndex service on Railway/container
  -> PageIndex engine/SDK
  -> selected sections
  -> Next.js answer generation
```

#### Boundary

Request:

```json
{
  "query": "...",
  "documentSlugs": ["..."],
  "topK": 6,
  "model": "..."
}
```

Response:

```json
{
  "results": [
    {
      "documentSlug": "...",
      "nodeId": "...",
      "score": 0.91,
      "reason": "...",
      "pageStart": 10,
      "pageEnd": 12
    }
  ],
  "engineVersion": "...",
  "latencyMs": 1234
}
```

#### Ưu điểm

- Gần engine chính thức nhất.
- Python phù hợp PageIndex ecosystem.
- Có thể xử lý task dài ngoài Vercel.
- Cho phép pin SDK và scale độc lập.

#### Nhược điểm

- Thêm deployment, auth, health check và network latency.
- Cần map node ID chính xác giữa service và Mongo.
- Release PageIndex hiện còn development.
- Chi phí vận hành cao hơn.

#### Điều kiện bắt buộc

- Pin exact version/commit.
- Internal authentication.
- Request timeout.
- Health endpoint.
- Lexical fallback trong Next.js.
- Không gửi document ngoài helpdesk scope.

### Candidate D — Managed PageIndex API

Chỉ spike nếu:

- C không đạt chất lượng OCR/tree building cần thiết;
- cần vision/scanned PDF;
- chấp nhận gửi tài liệu/query ra dịch vụ ngoài;
- chi phí và quyền riêng tư được phê duyệt.

Phải đánh giá:

- data retention;
- region;
- API limits;
- cost/query và cost/ingestion;
- node/citation mapping;
- vendor lock-in;
- export/rollback.

---

## 6. Architecture decision gate

Tạo ADR:

`docs/adr/ADR-001-pageindex-retrieval-architecture.md`

ADR phải có bảng:

| Tiêu chí | Trọng số |
|---|---:|
| Retrieval quality | 35% |
| Citation correctness | 15% |
| Latency | 15% |
| Cost | 10% |
| Operational complexity | 10% |
| Migration risk | 10% |
| Vendor/version risk | 5% |

Mỗi candidate chấm 1–10, nhân trọng số. Không chọn candidate chỉ dựa trên stars, README benchmark hoặc độ mới.

Quy tắc quyết định:

- Candidate thắng metrics và tổng điểm rõ ràng: chọn.
- Candidate B/C tốt hơn A dưới 5 điểm phần trăm nhưng phức tạp hơn nhiều: chọn A.
- Candidate B/C tốt hơn ít nhất 10 điểm phần trăm ở paraphrase/multi-section và giữ citation: cho phép thay cấu trúc.
- Không candidate nào qua quality gate: giữ lexical và điều tra corpus/query/golden labels.

---

## 7. Thiết kế chung cho mọi candidate

### Strategy contract

```ts
export type PageIndexRetrievalStrategy =
  | "lexical"
  | "tree-reasoning"
  | "pageindex-service";
```

Không thêm các strategy này vào `RetrievalMode`. `RetrievalMode` vẫn phân biệt `pageindex` với `amg`.

### Dispatcher

```ts
interface PageIndexRetriever {
  retrieve(input: RetrievePageIndexInput): Promise<PageIndexRetrievalResult>;
}
```

Implementations:

- `LexicalPageIndexRetriever`
- `TreeReasoningPageIndexRetriever`
- `ServicePageIndexRetriever`

Không cần class nếu factory/function map đơn giản hơn; mục tiêu là giữ contract/fallback rõ ràng.

### Result

```ts
interface PageIndexRetrievalResult {
  nodes: RetrievedNode[];
  diagnostics: {
    requestedStrategy: PageIndexRetrievalStrategy;
    usedStrategy: PageIndexRetrievalStrategy;
    engineVersion?: string;
    selectedNodeIds?: string[];
    fallbackReason?: string;
    latencyMs: number;
    llmCalls: number;
  };
}
```

### Fallback chain

```text
requested candidate
  -> timeout/error/invalid/out-of-scope
  -> lexical
  -> empty result
  -> grounded refusal hiện tại
```

Không fallback giữa nhiều reasoning engines trong v1 vì làm latency/cost khó kiểm soát.

### Scope guard

Node/result từ bất kỳ engine nào đều là untrusted:

1. Resolve allowed documents trong Next.js.
2. Gửi only allowed document identifiers.
3. Nhận result.
4. Map lại qua repository.
5. Loại mọi node không thuộc allowed document IDs.
6. Chỉ sau đó build context/citations.

---

## 8. Tree reasoning algorithm nếu chọn A hoặc B

### Compact outline

Format:

```text
Document: Tech Support Manual
[node-id] Title | pages 10-14 | compact summary
  [child-id] Child title | pages 11-12 | compact summary
```

Rules:

- Không đưa full content vào first-pass outline.
- Luôn giữ node ID nguyên vẹn.
- Có character/token budget.
- Ưu tiên root và upper levels.
- Nếu tree lớn, dùng lexical branch prefilter rồi giữ ancestor + nearby children.

### Structured selection

```json
{
  "selected": [
    {
      "nodeId": "node-id",
      "relevance": 0.92,
      "reason": "short retrieval reason"
    }
  ],
  "insufficientEvidence": false
}
```

Validation:

- Zod.
- Node ID membership.
- Document scope membership.
- Deduplicate.
- Clamp selection count.
- Clamp relevance `[0,1]`.
- `reason` không được đưa vào factual answer context.

### Context expansion

- Selected node có content: lấy node.
- Heading-only node: lấy content-bearing descendants gần nhất.
- Có thể lấy parent summary một cấp.
- Không lấy toàn bộ sibling mặc định.
- Deduplicate.
- Giới hạn topK/context budget.
- Giữ page/path/source/image metadata.

### Failure handling

Fallback lexical khi:

- feature flag off;
- timeout;
- upstream error;
- malformed JSON;
- unknown/out-of-scope node IDs;
- zero valid selection;
- tree corruption/cycle;
- service unhealthy.

---

## 9. Thay đổi file dự kiến

Danh sách cuối phụ thuộc ADR, nhưng các phần chung gồm:

### Shared/runtime

- `packages/shared/src/index.ts`
  - `PageIndexRetrievalStrategy`
  - helpdesk strategy field nếu rollout.
- `apps/web/lib/server/retrieval.ts`
  - tách lexical implementation;
  - không đổi lexical formula trong phase so sánh.
- `apps/web/lib/server/pageindex-retrieval.ts` — dispatcher mới.
- `apps/web/app/api/chat/route.ts`
  - resolve strategy;
  - giữ `amg` độc lập.
- `apps/web/app/api/chat/retrieve/route.ts`
  - strategy input;
  - diagnostics output.
- `apps/web/lib/server/env.ts`
  - flags/timeouts/endpoints.

### Candidate A

- `apps/web/lib/server/pageindex-tree.ts`
- `apps/web/lib/server/pageindex-reasoning.ts`

### Candidate B

- `apps/web/lib/server/pageindex-tree-store.ts`
- `apps/web/lib/server/pageindex-importer.ts`
- `apps/web/lib/server/repository.ts`
- migration/backfill script:
  - `scripts/backfill-pageindex-trees.ts`

### Candidate C

- `workers/pageindex-retrieval/`
  - `README.md`
  - pinned `requirements.txt` hoặc lockfile
  - service entrypoint
  - health/retrieve endpoints
- `apps/web/lib/server/pageindex-service-client.ts`

### Eval/tests

- `evals/pageindex-retrieval-golden.json`
- `scripts/eval-pageindex-retrieval.ts`
- targeted test files.

### Docs

- `.env.example`
- `README.md`
- `.claude/PROJECT_SUMMARY.md`
- ADR.

---

## 10. Environment/config đề xuất

Chỉ thêm biến của candidate được chọn.

Common:

```text
PAGEINDEX_RETRIEVAL_STRATEGY=lexical
PAGEINDEX_REASONING_ENABLED=false
PAGEINDEX_RETRIEVAL_TIMEOUT_MS=12000
```

Candidate A/B:

```text
PAGEINDEX_REASONING_MODEL=
PAGEINDEX_REASONING_MAX_OUTLINE_CHARS=30000
```

Candidate C:

```text
PAGEINDEX_RETRIEVAL_SERVICE_URL=
PAGEINDEX_RETRIEVAL_SERVICE_TOKEN=
PAGEINDEX_RETRIEVAL_SERVICE_VERSION=
```

Config phải:

- có safe default;
- clamp numeric values;
- không log token;
- fail closed về lexical;
- không làm app cũ mất khả năng khởi động.

---

## 11. Testing

### Pure/unit

- Forest bình thường.
- Orphan node.
- Duplicate node ID.
- Cycle.
- Empty-content heading.
- Outline budget.
- Structured output hợp lệ/không hợp lệ.
- Unknown node ID.
- Out-of-scope node.
- Context expansion.
- Fallback.

### Integration

- Mongo document scope.
- Tags và `documentSlugs`.
- Same node mapping across raw tree/flat tree/service.
- Helpdesk strategy default.
- `amg` không gọi PageIndex retriever.
- LLM/service timeout.
- Health failure.

### E2E

| Case | Kỳ vọng |
|---|---|
| Exact English term | Không kém lexical |
| Vietnamese paraphrase | Chọn đúng section |
| Mixed VI/EN | Citation đúng |
| Multi-section | Lấy đủ evidence |
| No-answer | Grounded refusal |
| Image-assisted | Giữ đúng image URL |
| Engine error | Lexical fallback |
| Scoped helpdesk | Không rò document |
| Feature flag off | Lexical only |

### Verification commands

```bash
npm run eval:pageindex -- --helpdesk tech-support --strategy lexical --top-k 6
npm run typecheck
npm run build
```

Thêm targeted test command sau khi chọn test runner.

---

## 12. Observability và an toàn

Structured log:

```ts
{
  event: "pageindex_retrieval",
  strategyRequested,
  strategyUsed,
  engineVersion,
  helpdeskSlug,
  documentCount,
  candidateNodeCount,
  selectedNodeCount,
  latencyMs,
  llmCalls,
  fallbackReason
}
```

Không log:

- API key/service token;
- full document content;
- full tree outline;
- raw prompt/response chứa tài liệu;
- dữ liệu ngoài document scope.

Theo dõi:

- success/error/fallback rate;
- p50/p95;
- cost/query;
- zero-result rate;
- user feedback nếu sau này nối collection `feedback`.

---

## 13. Migration và rollback

### Nếu chọn A

- Không data migration.
- Rollback bằng strategy/feature flag.

### Nếu chọn B

1. Dual-write raw tree + flat nodes.
2. Backfill existing documents.
3. Verify hash/node count.
4. Shadow-read tree-native.
5. Cut over retrieval.
6. Giữ flat nodes ít nhất một release để rollback.

Không xóa `pageindex_nodes` trong v1.

### Nếu chọn C

1. Deploy service.
2. Health check.
3. Shadow traffic không ảnh hưởng answer.
4. Compare results.
5. Canary một helpdesk.
6. Rollback endpoint/strategy về lexical.

MongoDB/citations vẫn là authority trong Next.js để service không thể trả node ngoài scope.

---

## 14. Thứ tự thực hiện trong session sau

### Phase 1 — Eval foundation

- [x] Tạo golden dataset 50 case.
- [x] Human-verify node IDs.
- [x] Viết eval script.
- [x] Lưu lexical baseline.

**Không bắt đầu reasoning trước khi phase này hoàn tất.**

### Phase 2 — Architecture spike

- [x] Spike A trên 15 case.
- [x] Đo raw-tree size và feasibility cho B.
- [x] Kiểm tra SDK/service API thực tế cho C và pin version khả dụng.
- [x] Không spike D vì chưa có nhu cầu managed/vision.
- [x] Ghi metrics, latency, cost và complexity.

### Phase 3 — ADR

- [x] Viết ADR weighted score.
- [x] Chọn candidate.
- [x] Chốt migration/rollback.
- [x] Chốt file-level implementation.

### Phase 4 — Implementation

- [x] Implement retriever contract/dispatcher.
- [x] Implement candidate thắng ở chế độ experimental.
- [x] Scope validation.
- [x] Diagnostics/fallback.
- [x] Tests.

### Phase 5 — Full eval

- [x] Chạy toàn bộ 50 case.
- [x] Phân tích theo category.
- [x] Điều tra failure cases.
- [x] Thay một biến mỗi lần.
- [x] Ghi pass/fail quality gate.

### Phase 6 — Rollout nếu pass

- [x] Feature flag mặc định false.
- [x] Không shadow/canary vì candidate không vượt gate.
- [x] Manual E2E không áp dụng cho production rollout bị chặn.
- [x] Metrics latency/fallback/citation đã được lưu trong eval artifacts.
- [x] Giữ/rollback về lexical theo ADR-001.

### Phase 7 — Handoff

- [x] Typecheck.
- [x] Targeted tests.
- [x] Production build.
- [x] README/env/docs.
- [x] Cập nhật `PROJECT_SUMMARY.md`.

---

## 15. Definition of Done

- Golden dataset có ít nhất 50 case.
- Lexical baseline artifact tái lập được.
- Ít nhất A/B/C được đánh giá bằng cùng bộ case đại diện.
- ADR giải thích vì sao giữ hoặc thay cấu trúc hiện tại.
- Candidate được chọn qua quality và operational gate.
- Node/document scope violations bằng 0.
- Fallback/rollback được test.
- Không regression `amg`, citations hoặc images.
- Typecheck, targeted tests và build pass.
- Production chỉ đổi mặc định sau canary thành công.

---

## 16. Prompt mở đầu cho session triển khai

```text
Đọc đầy đủ CLAUDE.md, .claude/PROJECT_SUMMARY.md,
.claude/CONVENTIONS.md và docs/plan-pageindex-retrieval-evolution.md.

Bắt đầu Phase 1: tạo golden retrieval dataset và lexical baseline.
Sau đó làm architecture spike A/B/C và viết ADR trước khi chọn kiến trúc.
Bạn được phép thay cấu trúc hiện tại nếu cùng golden set chứng minh chất
lượng tốt hơn đủ lớn và có migration/rollback rõ ràng.

Không đổi lexical formula trước baseline. Không thêm embedding/vector DB
trong scope này. Không làm ảnh hưởng mode amg. Cập nhật PROJECT_SUMMARY.md
sau session.
```
