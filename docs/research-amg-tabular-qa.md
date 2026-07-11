# Nghiên cứu: Kỹ thuật phù hợp cho chế độ "AMG" trên dữ liệu bảng dengue

**Ngày:** 2026-07-11
**Bối cảnh:** OmniAssist-RAG cần thêm chế độ truy hồi ngoài `pageindex` thuần. Ý định ban đầu là dùng lại AMG-RAG (Agentic Medical Graph-RAG, arXiv:2502.13010) và cho nó hỏi đáp trên dữ liệu trong `Papers/paper1` và `Papers/paper2`.

**Kết luận ngắn:** PageIndex và KG-RAG kiểu AMG-RAG **không phù hợp** với dữ liệu dengue vì đây là **bảng số lâm sàng**, không phải văn bản. Kỹ thuật phù hợp là **NL→truy vấn có ràng buộc + tính toán tất định** (LLM lập kế hoạch, code tính số) cho câu hỏi mô tả/phân tích, và một **kênh mô hình dự đoán** riêng cho câu hỏi tiên lượng. Tạm thời **không ghép AMG với PageIndex**.

---

## 1. Vì sao PageIndex và KG-RAG không hợp dữ liệu dengue

| Giả định của PageIndex / AMG-RAG | Thực tế dữ liệu dengue |
|---|---|
| Tri thức nằm trong **văn bản phân cấp** (title/summary/content) | Tri thức nằm trong **bảng số** (2301 bệnh nhân × ~27 cột; dữ liệu dọc 5 ngày) |
| Truy hồi = tìm đoạn văn liên quan bằng lexical/embedding | Trả lời = **đếm / trung bình / group-by / tương quan** trên hàng |
| Câu trả lời trích dẫn đoạn văn | Câu trả lời là **con số phải tính đúng** (vd 53.1%) |
| KG bắt quan hệ ngữ nghĩa giữa khái niệm | Quan hệ ở đây là **thống kê giữa biến**, không phải multi-hop khái niệm |

Nếu nhét bảng vào RAG văn bản: (a) không thể tổng hợp hàng nghìn hàng trong context window; (b) LLM sẽ **bịa số** thay vì tính — vi phạm nguyên tắc "accuracy > creativity" của dự án. Do đó cần đổi hẳn lớp truy hồi.

## 2. Hai loại câu hỏi trên dữ liệu này

1. **Mô tả / phân tích** — "Tỷ lệ sốc tái phát ở nhóm lactate > 4 mmol/l?", "SVI trung vị theo nhóm sốc?", "Tương quan lactate–AST?". → cần **aggregation/thống kê**.
2. **Tiên lượng / dự đoán** — "Bệnh nhân có các chỉ số X có nguy cơ sốc tái phát không?". → cần **mô hình học máy** (đã có tiền lệ: nhánh `dengue/` của dự án AMG-RAG chạy logistic regression, AUROC 0.798–0.802).

Hai loại này cần hai cơ chế khác nhau; gộp chung một pipeline sẽ rối.

## 3. Khảo sát các kỹ thuật ứng viên

| # | Kỹ thuật | Chính xác số | Hợp Vercel/Next | Grounding | Công sức | Ghi chú |
|---|---|---|---|---|---|---|
| 1 | **NL→truy vấn có ràng buộc + tính tất định** (LLM chọn cột/lọc/phép tính, code tính trên Mongo) | ★★★★★ | ★★★★★ | ★★★★★ | Trung bình | **Khuyến nghị**. Số do code tính, LLM chỉ lập kế hoạch + diễn giải |
| 2 | Text-to-SQL đầy đủ (LLM sinh SQL tự do) | ★★★★☆ | ★★★☆ | ★★★★ | Trung bình | Cần DB SQL; rủi ro SQL sai/độc; Mongo hiện tại không phải SQL |
| 3 | Pandas/code-interpreter agent (LLM viết code chạy sandbox) | ★★★★★ | ★☆ | ★★★★ | Cao | Cần runtime thực thi code — nặng, không hợp Vercel serverless |
| 4 | Row-retrieval RAG (lấy vài hàng làm context) | ★★ | ★★★★ | ★★★ | Thấp | Chỉ hợp tra 1 bản ghi; **hỏng với câu hỏi tổng hợp** |
| 5 | KG hoá bảng + graph reasoning (đúng chất AMG-RAG) | ★★★ | ★★★ | ★★★ | Cao | Overkill cho câu hỏi số; KG chỉ đáng khi có quan hệ multi-hop |
| 6 | Semantic layer / metric có sẵn (LLM chọn tham số) | ★★★★★ | ★★★★★ | ★★★★★ | Thấp–TB | An toàn nhất nhưng **cứng**, chỉ trả lời câu đã định nghĩa trước |

## 4. Khuyến nghị

### 4.1. Câu hỏi mô tả/phân tích → Kỹ thuật #1 (NL→truy vấn ràng buộc + tính tất định)
Giữ đúng tinh thần "agentic" của AMG-RAG nhưng đổi nguồn bằng chứng:

```
Câu hỏi
  → (LLM) schema-linking: chọn cột liên quan + điều kiện lọc + phép tính, trả JSON có ràng buộc
  → (Code TS) thực thi trên dataset_rows (Mongo): count / mean / median / group-by / corr
  → (Code) đóng gói bảng kết quả + confidence theo n & tỉ lệ missing
  → (LLM) CoT diễn giải, trả lời tiếng Việt, trích dẫn "dataset + cột"
```
- **Số 100% do code tính** → không ảo giác số liệu.
- Có **fallback parsing JSON bằng regex** (bài học từ AMG-RAG) để pipeline không sập.
- Whitelist cột + phép tính cho phép → chặn "truy vấn" bậy, an toàn hơn Text-to-SQL tự do.

### 4.2. Câu hỏi tiên lượng → kênh mô hình riêng
- Huấn luyện offline (script trong `workers/` hoặc conda) một model nhẹ (logistic/GBM) cho endpoint như "sốc tái phát", "suy hô hấp".
- Lưu hệ số/model artifact; runtime chỉ **nạp và suy luận** trên input người dùng nhập.
- Tách hẳn khỏi luồng QA mô tả.

### 4.3. Ranh giới với PageIndex
- **Tạm thời không ghép AMG với PageIndex.** Chế độ `pageindex` giữ nguyên cho tài liệu văn bản; chế độ `amg` (tabular) là hệ độc lập trên dataset dengue.
- Chỉ nên khôi phục ý tưởng "AMG + KG văn bản" **nếu sau này có nguồn văn bản y khoa thật** (vd các báo cáo `bao_cao_paper*.md`, guideline). Khi đó KG-RAG mới có đất dùng.

## 5. Kiến trúc đề xuất cho OmniAssist (khi triển khai)

- **Ingest (ngoài Vercel):** `scripts/import-dataset.ts` đọc `baseline.csv`, `plt.csv`, `pntd.0005740.s005.xls` + file `*_description.txt` (codebook) → collection Mongo `datasets` (metadata + codebook) và `dataset_rows` (từng hàng).
- **Lõi:** `apps/web/lib/server/tabular-qa.ts` — schema-linking (dùng `gemini.ts`/GCLI sẵn có) + engine tính toán tất định + CoT.
- **Định tuyến:** `/api/chat` đọc `retrievalMode`; `pageindex` giữ nguyên, `amg` gọi tabular-qa.
- **UI:** chọn chế độ per-helpdesk ở Dashboard; mặc định global ở Settings.
- **Không thêm** embeddings / vector DB — nhất quán ràng buộc dự án.

## 6. Bước tiếp theo đề xuất (chưa code)
1. Chốt phạm vi v1: chỉ **QA mô tả** (mục 4.1), gác dự đoán (4.2) sang sau.
2. Xác nhận helpdesk đích (vd tạo helpdesk `dengue`) và tập câu hỏi mẫu để nghiệm thu (vd tái tạo đúng 53.1% sốc tái phát ở nhóm lactate > 4).
3. Nếu duyệt → triển khai theo mục 5, verify bằng `npm run typecheck` + test từng chế độ.

---

**Tóm lại:** dữ liệu dengue là bài toán *tabular QA*, không phải *document RAG*. Kỹ thuật đáng áp dụng là **NL→truy vấn có ràng buộc + tính toán tất định** (giữ tính agentic của AMG-RAG, bỏ embeddings/KG/PubMed), cộng một kênh mô hình dự đoán riêng khi cần. Tách khỏi PageIndex cho tới khi có nguồn văn bản phù hợp.
