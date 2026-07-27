# Skill: PageIndex Document Ingestion

## Mục đích

Hướng dẫn AI agent cách xử lý tài liệu nguồn (PDF, Markdown, TXT, DOCX, XLSX, PPTX, HTML, CSV, hoặc JSON thủ công) và import vào MongoDB để hệ thống Helpdesk RAG có thể sử dụng trong truy vấn.

## Kiến trúc tổng quan

```
Tài liệu nguồn (PDF / MD / TXT / DOCX / XLSX / PPTX / HTML / CSV)
        │
        ▼ (Nếu là DOCX, XLSX, PPTX, HTML, CSV)
┌─────────────────────────────────┐
│  MarkItDown Pre-processor       │  ← Tự động convert sang Markdown (.md)
└─────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────┐
│  workers/pageindex-ingest/      │  ← Python worker (KHÔNG chạy trong Next.js)
│  run_pageindex_local.py         │  ← Gọi VectifyAI/PageIndex CLI để tạo cây JSON
│  flatten_pageindex_tree.py      │  ← Flatten cây JSON thành danh sách node phẳng
│  import_pageindex_to_mongo.py   │  ← Entry point chính: xử lý + import vào MongoDB
│  upload_to_r2.py                │  ← (Tùy chọn) Backup file lên Cloudflare R2
└─────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────┐
│  MongoDB Atlas                  │
│  Collection: documents          │  ← Metadata tài liệu (title, slug, tags, status)
│  Collection: pageindex_trees    │  ← Raw tree bất biến + producer/hash/version
│  Collection: pageindex_nodes    │  ← Read model đã flatten (dùng cho retrieval)
└─────────────────────────────────┘
```

## Môi trường yêu cầu

### Python environment

- **BẮT BUỘC** dùng virtualenv `.venv-pageindex`, KHÔNG dùng system Python.
- PageIndex/LiteLLM đã pin cần Python `<3.14`; dùng runtime 3.13 trong
  `.python-3.13`.
- Working directory: root repository `OmniAssist-RAG`.

### Cài đặt dependencies

```powershell
py install --target=.python-3.13 -y 3.13
.\.python-3.13\python.exe -m venv .venv-pageindex
.\.venv-pageindex\Scripts\python.exe -m pip install `
  -r workers/pageindex-ingest/requirements.txt `
  -r C:/path/to/PageIndex/requirements.txt
```

Dependencies (`requirements.txt`):
- `pymongo==4.8.0` — kết nối MongoDB
- `boto3==1.34.149` — upload lên Cloudflare R2 (S3-compatible)
- `python-dotenv==1.2.2` — đọc file `.env`
- `requests==2.32.3` — HTTP requests
- `markitdown` — tự động convert Word, Excel, PPT, HTML, CSV sang Markdown

### Biến môi trường (`.env`)

File `.env` đặt tại **root dự án**. Python worker dùng `python-dotenv` để load.

| Biến | Bắt buộc | Mô tả |
|------|----------|-------|
| `MONGODB_URI` | ✅ | Connection string MongoDB Atlas (dạng `mongodb+srv://...`) |
| `MONGODB_DB` | ❌ | Tên database, mặc định `helpdesk_rag` |
| `GCLI_BASE_URL` | ❌ | Base URL GCLI Proxy (mặc định: `https://gcli.ggchan.dev/v1`) |
| `GCLI_API_KEYS` | ❌ | Danh sách API key GCLI Proxy (tự động tách lấy key chạy CLI) |
| `GCLI_MODEL` | ❌ | Model mặc định hệ thống chat (dùng làm fallback) |
| `PAGEINDEX_MODEL` | ❌ | Model riêng cho Python Worker (ghi đè `GCLI_MODEL` khi xử lý PDF) |
| `R2_ACCOUNT_ID` | ❌* | Cloudflare Account ID (chỉ cần nếu backup R2) |
| `R2_ACCESS_KEY_ID` | ❌* | R2 API Token Key ID |
| `R2_SECRET_ACCESS_KEY` | ❌* | R2 API Token Secret |
| `R2_BUCKET_NAME` | ❌* | Tên R2 bucket |
| `R2_PUBLIC_BASE_URL` | ❌ | URL public của bucket (nếu có custom domain) |
| `PAGEINDEX_DIR` | ✅ khi xử lý source | Checkout VectifyAI/PageIndex đúng commit trong `pageindex-reference.lock.json` |
| `PAGEINDEX_EXPECTED_COMMIT` | ❌ | Override commit đã pin; mặc định đọc từ lock file |
| `PAGEINDEX_ALLOW_UNPINNED` | ❌ | Chỉ đặt `true` cho thử nghiệm có chủ đích |
| `PAGEINDEX_COMMAND` | ❌ | Advanced override; mặc định gọi `run_pageindex.py --pdf_path/--md_path` |

> (*) Chỉ bắt buộc khi muốn backup file lên R2. Nếu không cần, dùng flag `--skip-r2`.

## Bước 0: Xác nhận loại Helpdesk trước khi xử lý

> **BẮT BUỘC**: Trước khi thực hiện bất kỳ thao tác import nào, agent PHẢI xác nhận loại helpdesk mà tài liệu sẽ được gán vào.

### Quy trình xác nhận

1. **Nếu người dùng đã chỉ rõ loại helpdesk** (ví dụ: "import vào helpdesk bảo hành", hoặc cung cấp `--tags` rõ ràng) → **Bỏ qua bước này**, tiến hành import trực tiếp.

2. **Nếu người dùng KHÔNG chỉ rõ loại helpdesk** → Agent PHẢI:

   a. Truy vấn danh sách các helpdesk đang tồn tại trong hệ thống bằng cách gọi API:
   ```bash
   curl http://localhost:3000/api/helpdesks
   ```
   Hoặc truy vấn trực tiếp MongoDB collection `helpdesks`.

   b. Hiển thị danh sách cho người dùng dưới dạng bảng:
   ```
   Hiện tại hệ thống có các loại Helpdesk sau:

   | # | Tên Helpdesk           | Slug                | Tags               |
   |---|------------------------|---------------------|---------------------|
   | 1 | Bảo hành sản phẩm     | bao-hanh            | helpdesk,warranty   |
   | 2 | Hướng dẫn kỹ thuật    | huong-dan-ky-thuat  | helpdesk,technical  |
   | 3 | Chính sách công ty    | chinh-sach          | policy,internal     |

   Bạn muốn import tài liệu này vào helpdesk nào? (Nhập số thứ tự hoặc tên)
   Hoặc bạn có muốn tạo một helpdesk mới không?
   ```

   c. Chờ người dùng xác nhận trước khi tiếp tục.

   d. Sau khi xác nhận, sử dụng `tags` của helpdesk đã chọn làm giá trị `--tags` cho lệnh import.

3. **Nếu chưa có helpdesk nào trong hệ thống** → Thông báo cho người dùng và hỏi:
   - Tên helpdesk mới cần tạo
   - Mô tả ngắn (tùy chọn)
   - Tags phân loại

   Sau đó tạo helpdesk mới qua API trước khi tiến hành import.

### Ví dụ tương tác

```
Người dùng: Import file warranty-policy.pdf vào hệ thống
Agent: Bạn chưa chỉ rõ loại helpdesk. Để tôi kiểm tra danh sách helpdesk hiện có...
       [Truy vấn API /api/helpdesks]
       Hiện tại có 2 helpdesk:
       1. Bảo hành sản phẩm (bao-hanh) — tags: helpdesk,warranty
       2. Hướng dẫn kỹ thuật (huong-dan-ky-thuat) — tags: helpdesk,technical
       Bạn muốn import vào helpdesk nào?
Người dùng: 1
Agent: Đã xác nhận. Tiến hành import vào helpdesk "Bảo hành sản phẩm" với tags: helpdesk,warranty...
```

---

## Cách sử dụng

### Mode A: Import từ file PageIndex JSON có sẵn (Phổ biến nhất)

Khi bạn **đã có file PageIndex JSON** (tạo thủ công hoặc từ nguồn khác):

```powershell
.\.venv-pageindex\Scripts\python.exe workers/pageindex-ingest/import_pageindex_to_mongo.py `
  --index-json "./data/my-document-pageindex.json" `
  --title "Tên tài liệu hiển thị" `
  --slug "ten-tai-lieu-url-safe" `
  --tags "tag1,tag2,tag3" `
  --skip-r2
```

### Mode B: Xử lý file nguồn (PDF, MD, TXT, DOCX, XLSX, PPTX, HTML, CSV) rồi import

Khi bạn có **file nguồn gốc** (PDF, Markdown, TXT, Word `.docx`, Excel `.xlsx`, PowerPoint `.pptx`, HTML, CSV) và đã cài đặt VectifyAI/PageIndex locally. Các định dạng ngoài PDF/MD sẽ được tự động chuyển đổi sang Markdown bằng MarkItDown trước khi phân tích:

```powershell
# Nhận trực tiếp bất kỳ định dạng file nào:
.\.venv-pageindex\Scripts\python.exe workers/pageindex-ingest/import_pageindex_to_mongo.py `
  --source "./data/my-document.docx" `
  --title "Tên tài liệu" `
  --slug "ten-tai-lieu" `
  --tags "helpdesk,faq" `
  --output-dir "./output" `
  --skip-r2
```

### Tham số dòng lệnh

| Tham số | Bắt buộc | Mô tả |
|---------|----------|-------|
| `--source` | ❌† | Đường dẫn file nguồn (PDF, MD, TXT, DOCX, XLSX, PPTX, HTML, CSV). Các định dạng Word/Excel/PPT sẽ tự động chuyển đổi sang Markdown qua MarkItDown |
| `--index-json` | ❌† | Đường dẫn file PageIndex JSON đã có sẵn |
| `--title` | ✅ | Tiêu đề tài liệu (hiển thị trong hệ thống) |
| `--slug` | ✅ | Định danh URL-safe, dùng làm unique key trong MongoDB |
| `--tags` | ❌ | Danh sách tag phân loại, cách nhau bởi dấu phẩy |
| `--output-dir` | ❌ | Thư mục lưu file JSON output (mặc định `./output`) |
| `--pageindex-dir` | ❌ | Thư mục chứa PageIndex CLI (nếu cài ở nơi khác) |
| `--skip-r2` | ❌ | Bỏ qua bước upload backup lên Cloudflare R2 |

> (†) Phải cung cấp ít nhất một trong hai: `--source` hoặc `--index-json`.

---

## Cấu trúc PageIndex JSON

File PageIndex JSON là một **cây phân cấp** theo mục/chương/đoạn. Đây là schema mà hệ thống flatten sẽ xử lý:

```json
{
  "title": "Tên tài liệu gốc",
  "children": [
    {
      "title": "Chương 1: Giới thiệu",
      "level": 1,
      "path": ["Tên tài liệu gốc", "Chương 1: Giới thiệu"],
      "summary": "Tóm tắt ngắn nội dung chương",
      "content": "Nội dung chi tiết đầy đủ của phần này...",
      "pageStart": 1,
      "pageEnd": 3,
      "children": [
        {
          "title": "1.1 Mục đích",
          "level": 2,
          "path": ["Tên tài liệu gốc", "Chương 1: Giới thiệu", "1.1 Mục đích"],
          "content": "Nội dung chi tiết mục 1.1..."
        }
      ]
    }
  ]
}
```

### Các trường của mỗi node

| Trường | Kiểu | Bắt buộc | Mô tả |
|--------|------|----------|-------|
| `title` / `heading` / `name` | string | ✅ | Tiêu đề section (fallback: `"Untitled section"`) |
| `content` / `text` / `body` | string | ✅* | Nội dung chi tiết (dùng cho retrieval) |
| `summary` / `abstract` | string | ❌ | Tóm tắt ngắn gọn |
| `path` | string[] hoặc string | ❌ | Đường dẫn cây (VD: `["Doc", "Chương 1", "Mục 1.1"]`) |
| `level` | number | ❌ | Cấp phân cấp (0 = root, 1 = chương, 2 = mục...) |
| `nodeId` / `id` | string | ❌ | ID duy nhất (tự sinh nếu không có) |
| `pageStart` / `page_start` | number | ❌ | Trang bắt đầu trong tài liệu gốc |
| `pageEnd` / `page_end` | number | ❌ | Trang kết thúc |
| `sourceRef` / `source_ref` | string | ❌ | Tham chiếu nguồn gốc |
| `children` / `nodes` / `sections` | array | ❌ | Các node con (tạo cây phân cấp) |

> (*) Ít nhất một trong `title`, `summary`, hoặc `content` phải có giá trị. Node trống sẽ bị loại bỏ.

### Các format root được hỗ trợ

Hệ thống flatten linh hoạt, nhận diện nhiều format JSON khác nhau:

```json
// Format 1: children trực tiếp
{ "title": "...", "children": [...] }

// Format 2: mảng nodes
{ "nodes": [...] }

// Format 3: root wrapper
{ "root": { "title": "...", "children": [...] } }

// Format 4: tree wrapper
{ "tree": { "title": "...", "children": [...] } }

// Format 5: document wrapper
{ "document": { "title": "...", "children": [...] } }
```

---

## Quy trình xử lý bên trong

### 1. Flatten cây → danh sách phẳng (`flatten_pageindex_tree.py`)

Script này duyệt đệ quy cây JSON và tạo danh sách phẳng các node:

- Mỗi node được gán `nodeId` (dùng SHA1 hash nếu không có sẵn)
- Thiết lập quan hệ `parentNodeId` và `childrenIds`
- Chuẩn hóa `path` từ cây kế thừa
- Loại bỏ node trống (không có title, summary, lẫn content)

### 2. Lưu vào MongoDB (`import_pageindex_to_mongo.py`)

**Collection `documents`:**
- Upsert theo `slug` (unique key)
- Lưu metadata: `title`, `slug`, `tags`, `status: "ready"`, `sourceFileUrl`, `indexFileUrl`
- Tạo index: `slug` (unique), compound `(status, tags)`

**Collection `pageindex_nodes`:**
- Xóa toàn bộ node cũ của document trước khi import mới (theo `documentId`)
- Bulk upsert theo cặp `(documentId, nodeId)`
- Mỗi node lưu: `nodeId`, `parentNodeId`, `title`, `summary`, `content`, `path`, `level`, `pageStart`, `pageEnd`, `sourceRef`, `childrenIds`
- Tạo index: compound `(documentId, nodeId)` (unique)

### 3. (Tùy chọn) Backup lên R2 (`upload_to_r2.py`)

- Upload file nguồn gốc: `source/{slug}/{filename}`
- Upload file PageIndex JSON: `pageindex/{slug}/{filename}`
- Dùng S3-compatible API qua `boto3`

---

## Ví dụ thực tế

### Ví dụ 1: Tạo file JSON thủ công và import

```powershell
# 1. Tạo file JSON tại workers/pageindex-ingest/data/
#    (Xem cấu trúc JSON ở phần trên)

# 2. Import vào MongoDB
.\.venv-pageindex\Scripts\python.exe workers/pageindex-ingest/import_pageindex_to_mongo.py `
  --index-json "./data/huong-dan-bao-hanh.json" `
  --title "Hướng dẫn bảo hành sản phẩm" `
  --slug "huong-dan-bao-hanh" `
  --tags "helpdesk,warranty,faq" `
  --skip-r2
```

Output thành công:
```json
{
  "documentId": "668e1a2b3c4d5e6f7a8b9c0d",
  "nodesImported": 15,
  "matched": 0
}
```

### Ví dụ 2: Import lại (cập nhật) tài liệu đã tồn tại

Dùng cùng `--slug` để cập nhật. Hệ thống sẽ:
1. Tìm document cũ theo slug
2. Cập nhật metadata
3. Xóa toàn bộ node cũ
4. Import lại node mới

```powershell
.\.venv-pageindex\Scripts\python.exe workers/pageindex-ingest/import_pageindex_to_mongo.py `
  --index-json "./data/huong-dan-bao-hanh-v2.json" `
  --title "Hướng dẫn bảo hành sản phẩm (Cập nhật)" `
  --slug "huong-dan-bao-hanh" `
  --tags "helpdesk,warranty,faq,updated" `
  --skip-r2
```

### Ví dụ 3: Xử lý PDF gốc (cần cài VectifyAI/PageIndex)

```powershell
# Cần cài đặt PageIndex CLI trước
# Clone đúng commit trong pageindex-reference.lock.json

.\.venv-pageindex\Scripts\python.exe workers/pageindex-ingest/import_pageindex_to_mongo.py `
  --source "./data/policy-document.pdf" `
  --title "Chính sách công ty" `
  --slug "chinh-sach-cong-ty" `
  --tags "policy,internal" `
  --output-dir "./output" `
  --skip-r2
```

---

## Troubleshooting

### Lỗi kết nối MongoDB (`ECONNREFUSED` / DNS resolution)

- MongoDB Atlas dùng SRV record. Nếu DNS mặc định không resolve được:
  - Đổi DNS máy tính sang `8.8.8.8` / `1.1.1.1`
  - Hoặc thử dùng connection string dạng `mongodb://` thay vì `mongodb+srv://`
- Kiểm tra `MONGODB_URI` trong file `.env` tại root dự án

### Lỗi `Missing required environment variable`

- Đảm bảo file `.env` tồn tại tại root repository
- Worker dùng `python-dotenv` để load `.env` từ working directory. Nếu chạy từ thư mục khác, copy hoặc symlink file `.env`

### Lỗi `No PageIndex nodes found in JSON`

- File JSON rỗng hoặc sai format
- Kiểm tra file JSON có đúng cấu trúc cây (xem phần "Cấu trúc PageIndex JSON")
- Đảm bảo ít nhất 1 node có `title`, `summary`, hoặc `content` không rỗng

### Lỗi `ModuleNotFoundError`

```powershell
.\.venv-pageindex\Scripts\python.exe -m pip install `
  -r workers/pageindex-ingest/requirements.txt `
  -r C:/path/to/PageIndex/requirements.txt
```

---

## Lưu ý quan trọng

1. **KHÔNG** chạy worker này từ trong Next.js runtime hoặc API route
2. **KHÔNG** dùng embeddings hoặc pgvector — hệ thống dùng keyword scoring (vectorless)
3. **KHÔNG** dùng system Python — luôn dùng `.venv-pageindex`
4. **Slug là unique key** — dùng cùng slug sẽ cập nhật (upsert) document đã tồn tại
5. **Dữ liệu cũ bị xóa khi re-import** — toàn bộ node cũ của document bị xóa trước khi import node mới
6. Sau khi import, hệ thống chat RAG tự động sử dụng dữ liệu mới mà không cần restart
