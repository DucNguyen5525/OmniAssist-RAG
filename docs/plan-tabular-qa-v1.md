# Plan code — Tabular-QA v1 (chế độ `amg`)

**Ngày:** 2026-07-12
**Tiền đề:** Xem `docs/research-amg-tabular-qa.md`. Kỹ thuật: *NL→truy vấn có ràng buộc + tính toán tất định* (LLM lập kế hoạch, code tính số). Tách khỏi PageIndex.

---

## 0. Phạm vi v1 (đã chốt)

**Trong phạm vi:**
- Chỉ **QA mô tả/phân tích** (không dự đoán/ML).
- Nguồn dữ liệu: **paper1** `baseline.csv` (2301 hàng), `plt.csv` (891 hàng dọc) và **paper2** `pntd.0005740.s005.xls` (102 bệnh nhân).
- Phép tính whitelist: `count`, `proportion` (đếm có lọc → %), `mean`, `median`, `min`, `max`, `groupBy` + (count/proportion/mean), `correlation` (2 cột số).
- Chế độ mới `amg` chạy song song `pageindex`; **`pageindex` giữ nguyên 100%**.
- Con số **do code tính**, LLM chỉ schema-linking + diễn giải.

**Ngoài phạm vi v1 (để sau):**
- Chế độ `amg-pageindex` (gộp text + bảng).
- Kênh mô hình dự đoán/tiên lượng.
- Truy vấn dọc phức tạp trên `plt.csv` (chỉ hỗ trợ thống kê cơ bản ở v1).
- Biểu đồ/trực quan hoá.

**Tiêu chí nghiệm thu:** trên helpdesk `dengue`, hỏi các câu tính được và đối chiếu số:
- "Tỷ lệ bệnh nhân bị shock (baseline)?" → khớp count/proportion cột `shock`.
- "SVI/lactate trung vị theo nhóm sốc?" (paper2) → khớp bảng báo cáo.
- "Tỷ lệ sốc tái phát khi lactate > 4 mmol/l?" (paper2) → 53.1%.

---

## 1. Dữ liệu & codebook

Cột `baseline.csv`: `st_no, age, sex, wt, day_ill, his_tired, his_vomit, ttest, temp, pulse, sys_bp, mucosal_bleed, abdominal_pain, liver, hct_bsl, plt_bsl, serotype2, serology, to_PICU, shock, doi_shock, bleed_hos, minPLT_3to8, dminPLT_3to8, maxHCT_3to8, dmaxHCT_3to8, maxhemo_3to8`. Thiếu = `NA`.

Cột `plt.csv`: `st_no, doi_info, plt, age, sex, day_ill, his_vomit, temp, liver, plt_bsl, status`.

Codebook (kiểu + đơn vị + nhãn) lấy từ `baseline_description.txt`, `plt_description.txt`, và mô tả biến trong `BaoCao_paper2_Dengue_ICU.md`. Lưu kèm dataset để: (a) LLM biết cột nào hợp lệ; (b) engine biết cột số vs phân loại; (c) trả lời có chú giải.

---

## 2. Thay đổi theo file (surgical)

### 2.1. `packages/shared/src/index.ts`
- `export type RetrievalMode = "pageindex" | "amg";`  *(chừa chỗ mở rộng `amg-pageindex`)*
- Thêm `retrievalMode?: RetrievalMode;` vào `interface Helpdesk`.
- Thêm contract mới:
  ```ts
  export interface DatasetColumn { name: string; label: string; type: "number" | "category"; unit?: string; categories?: string[]; }
  export interface DatasetInfo { id: string; slug: string; title: string; source: string; rowCount: number; columns: DatasetColumn[]; }
  ```

### 2.2. `apps/web/lib/server/repository.ts`
- `HelpdeskRecord` + `serializeHelpdesk` + `createHelpdesk` + `updateHelpdesk`: thêm `retrievalMode` (default `"pageindex"`).
- Record types mới: `DatasetRecord` (metadata + `columns` codebook + `datasetSlug`) và `DatasetRowRecord` (`datasetId`, `data: Record<string, string|number|null>`).
- Hàm mới:
  - `getDatasetBySlug(slug)` / `listDatasets()`.
  - `getDatasetRows(datasetId)` — trả toàn bộ hàng (v1 nạp hết vào bộ nhớ; 2301 hàng nhỏ, chấp nhận được).
  - `upsertDatasetWithRows({...})` — dùng cho script ingest (xoá-ghi theo `datasetSlug`, giống `upsertDocumentWithNodes`).

### 2.3. `apps/web/lib/server/mongodb.ts`
- `ensureMongoIndexes`: thêm
  - `datasets.createIndex({ datasetSlug: 1 }, { unique: true })`
  - `dataset_rows.createIndex({ datasetId: 1 })`

### 2.4. `apps/web/lib/server/gemini.ts`
- Export hàm generic để tái dùng client (hiện `getResilientClient` là private):
  ```ts
  export async function generateChatCompletion(
    messages: Array<{ role: string; content: string }>,
    options?: Record<string, unknown>
  ): Promise<string>
  ```
  (bọc `getResilientClient()` + `createChatCompletion`, trả `content.trim()`). `generateGroundedAnswer` giữ nguyên.

### 2.5. `apps/web/lib/server/tabular-qa.ts` *(MỚI — lõi)*
Pipeline `generateTabularAnswer(question, dataset, rows, systemPrompt)`:
1. **schema-linking** — `generateChatCompletion` với prompt kèm codebook, yêu cầu JSON kế hoạch:
   ```json
   {
     "dataset": "baseline",
     "intent": "aggregate|compare|correlation|lookup",
     "metrics": [{ "op": "proportion", "column": "shock", "equals": "Yes" }],
     "filters": [{ "column": "plt_bsl", "op": "lt", "value": 50000 }],
     "groupBy": "serotype2"
   }
   ```
   Có **fallback parsing regex** (`\{[\s\S]*\}`) khi LLM chèn text rác (bài học AMG-RAG).
2. **validate** — chỉ chấp nhận cột có trong codebook, `op` trong whitelist; loại kế hoạch không hợp lệ → trả câu "chưa đủ dữ kiện/không hỗ trợ".
3. **compute** (tất định, không LLM) — engine chạy trên `rows`:
   - lọc theo `filters` (bỏ `NA`/null khỏi mẫu tính);
   - `count/proportion/mean/median/min/max`; `groupBy` → bảng; `correlation` (Pearson + Spearman) cho 2 cột số;
   - kèm `n` thực tế + số bản ghi thiếu.
4. **confidence** — hàm đơn giản theo `n` và tỉ lệ thiếu (vd `min(1, n/50) * (1 - missingRate)`).
5. **CoT diễn giải** — `generateChatCompletion` nhận **bảng kết quả đã tính** + codebook, sinh câu trả lời tiếng Việt, **cấm bịa số ngoài bảng**, trích dẫn `dataset + cột + n`.
- Trả `{ answer, sources }` với `sources` ánh xạ về `SourceReference` (documentTitle = tên dataset, nodeTitle = mô tả phép tính) để UI hiện nguồn như hiện tại.

### 2.6. `apps/web/app/api/chat/route.ts`
- `chatSchema`: thêm `retrievalMode: z.enum(["pageindex","amg"]).optional()`.
- Sau khi resolve helpdesk: `const mode = input.retrievalMode ?? helpdesk?.retrievalMode ?? "pageindex";`
- Nhánh:
  - `pageindex` → luồng hiện tại (không đổi).
  - `amg` → lấy dataset theo helpdesk (quy ước: `datasetSlug = helpdeskSlug` hoặc field cấu hình), gọi `generateTabularAnswer`. Nếu helpdesk chưa gắn dataset → trả thông báo rõ ràng.
- Lưu message + sources như cũ.

### 2.7. Zod ở route helpdesk
- `apps/web/app/api/helpdesks/route.ts` và `[slug]/route.ts`: thêm `retrievalMode: z.enum(["pageindex","amg"]).optional()`.

### 2.8. `scripts/import-dataset.ts` *(MỚI — ingest, chạy local)*
- CLI giống `import-pageindex.ts`: `--file`, `--slug`, `--title`, `--format csv|xls`, `--desc <path>`.
- CSV: parser thủ công (đã có quote/NA) hoặc thêm devDep `csv-parse`. XLS: devDep `xlsx` (**chỉ devDependencies**, không vào bundle Vercel).
- Suy luận `type` cột (number/category) từ dữ liệu + ghi đè bằng codebook description.
- Gọi `upsertDatasetWithRows`.
- Thêm script `package.json`: `"import:dataset": "tsx scripts/import-dataset.ts"`.

### 2.9. UI
- `apps/web/lib/settings.ts`: thêm `retrievalMode` default `"pageindex"` vào `RagSettings`.
- `apps/web/app/dashboard/page.tsx`: thêm `<select>` "Chế độ truy hồi" (pageindex/amg) vào `HelpdeskFormData` + form tạo/sửa.
- `apps/web/app/settings/page.tsx`: thêm select mặc định global.
- `apps/web/lib/api-client.ts`: thêm `retrievalMode` vào `ask`, `createHelpdesk`, `updateHelpdesk`.
- `apps/web/app/chat/[helpdeskSlug]/page.tsx`: truyền `retrievalMode: helpdesk?.retrievalMode ?? settings.retrievalMode` vào `apiClient.ask`.

### 2.10. Docs / env
- `.env.example`: không cần biến mới (dùng GCLI/Mongo sẵn có).
- Cập nhật `.claude/PROJECT_SUMMARY.md` (feature + timestamp/session, thêm `tabular-qa.ts`, `import-dataset.ts`, collections mới).
- Nếu phát sinh bug đáng lưu → `.claude/IMPORTANT_FIXED_BUGS.md`.

---

## 3. Thứ tự thực hiện (mỗi bước verify được)

1. **Contract + schema** (2.1–2.3, 2.7) → `npm run typecheck`.
2. **Ingest** (2.8) → chạy `import:dataset` cho baseline.csv, plt.csv, xls → kiểm tra Mongo có `datasets`/`dataset_rows`.
3. **Engine + LLM helper** (2.4–2.5) → viết vài unit-check nhỏ cho hàm compute (proportion/median/correlation) bằng dữ liệu tay.
4. **Route** (2.6) → test API `amg` bằng curl/`retrieve` với câu hỏi mẫu, đối chiếu số.
5. **UI** (2.9) → thao tác end-to-end trên helpdesk `dengue`.
6. **Docs** (2.10).

## 4. Rủi ro & quyết định mở
- **Gắn dataset vào helpdesk thế nào?** v1 dùng quy ước `datasetSlug == helpdeskSlug`; nếu cần linh hoạt hơn thì thêm field `datasetSlug` vào helpdesk (đề xuất làm luôn ở 2.2 cho gọn).
- **`xlsx` devDep**: chỉ dùng trong script ingest; nếu muốn tránh hẳn dep, có thể xuất XLS→CSV thủ công một lần rồi ingest CSV.
- **Nạp toàn bộ hàng vào bộ nhớ**: ổn với ≤2301 hàng; nếu sau này dataset lớn cần chuyển sang aggregation pipeline của Mongo.
- **LLM sinh kế hoạch sai cột**: chặn bằng validate + fallback trả lời "không hỗ trợ", không đoán bừa.
