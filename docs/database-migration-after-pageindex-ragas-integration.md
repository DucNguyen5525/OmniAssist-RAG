# So sánh trước/sau và kế hoạch dữ liệu sau tích hợp PageIndex/Ragas

**Ngày audit:** 2026-07-27  
**Database:** `helpdesk_rag`  
**Phạm vi:** PageIndex ingestion, retrieval, raw-tree persistence và Ragas
offline evaluation.

## Kết luận ngắn

Không có migration bắt buộc để ứng dụng tiếp tục chạy. Production retrieval vẫn
dùng `pageindex_nodes` theo chiến lược lexical, nên dữ liệu hiện tại vẫn tương
thích.

Tuy nhiên, nên thực hiện một lần backfill cho document
`tech-support-manual` để có:

- raw PageIndex tree bất biến;
- canonical SHA-256 content hash;
- schema version;
- producer và producer version;
- bản backup JSON trên R2.

Không cần thay đổi `helpdesks`, `conversations`, `messages`, `datasets`,
`dataset_rows` hoặc `prediction_models`. Ragas là evaluator offline và không
thêm collection production.

## Snapshot database hiện tại

Kết quả kiểm tra read-only tại thời điểm viết tài liệu:

| Thành phần | Giá trị |
| --- | ---: |
| Documents | 1 |
| PageIndex nodes | 155 |
| Nodes có evidence text | 142 |
| Nodes chỉ dùng làm cấu trúc/heading | 13 |
| PageIndex raw trees | 0 |
| Documents thiếu provenance/hash | 1 |
| Documents hoàn toàn không có evidence text | 0 |

Document hiện tại:

| Thuộc tính | Giá trị |
| --- | --- |
| `slug` | `tech-support-manual` |
| `title` | `Tech Support Manual` |
| `status` | `ready` |
| `tags` | `helpdesk`, `tech-support` |
| `version` | Chưa có |
| `sourceFileUrl` | Chưa có |
| `indexFileUrl` | Chưa có |
| `indexSchemaVersion` | Chưa có |
| `producer` | Chưa có |
| `producerVersion` | Chưa có |
| `contentHash` | Chưa có |
| `pageindex_trees` tương ứng | 0 |

Các index mới cho `pageindex_trees` đã tồn tại:

- unique `{ documentId: 1, contentHash: 1 }`;
- `{ documentId: 1, createdAt: -1 }`.

Mười ba node không có `content` không phải lỗi dữ liệu: đây có thể là heading
hoặc node định tuyến. Document vẫn có 142 node evidence và đang phục vụ lexical
retrieval bình thường.

## Khác biệt trước và sau khi thực hiện

| Khu vực | Trước | Sau |
| --- | --- | --- |
| Official PageIndex schema | Các field `structure`, `node_id`, `start_index`, `line_num`, `text` không được normalize đầy đủ; sample chính thức có thể thành một node `Untitled` | Hỗ trợ official schema và internal camelCase; sample upstream normalize đúng 41 node |
| Node ID | Có thể âm thầm va chạm/mất node | Duplicate upstream ID bị từ chối |
| Raw tree | Bị bỏ sau khi flatten | Lưu version bất biến trong `pageindex_trees`, hoặc R2 nếu quá giới hạn inline |
| Provenance | Không biết artifact được tạo bởi code/commit nào | Có `producer`, `producerVersion`, `indexSchemaVersion`, `contentHash` |
| MongoDB role | Chỉ có flattened read model | Raw tree là source artifact; flattened nodes là retrieval read model |
| PageIndex worker | Cách gọi CLI và version không được khóa chặt; upstream mặc định không xuất node text | Pin commit `39121c4…`, gọi đúng entrypoint, ép `--if-add-node-text yes`, từ chối tree không có evidence |
| Artifact lớn | Có nguy cơ vượt MongoDB document limit | Raw tree trên 14 MB phải có external artifact/R2 |
| Admin visibility | Không thấy producer/version | Hiển thị producer và short version |
| Retrieval production | Lexical | Vẫn lexical; không đổi công thức production |
| Retrieval quality | Baseline cũ | Full regression 50 case giữ nguyên Hit@1 `0,60`, Hit@3/Recall@6 `0,76`, MRR `0,6773` |
| Answer evaluation | Chưa có evaluator chuẩn hóa | Có Ragas offline: faithfulness, context precision/recall, answer relevancy và factual correctness |
| Ragas data | Không có | Dataset/result là JSON trong `evals/`; không ghi vào MongoDB |

## Thay đổi schema MongoDB

### `documents`

Các field mới đều additive và optional:

```javascript
{
  indexSchemaVersion: 1,
  producer: "vectify-pageindex" | "internal-md-converter" | "unknown",
  producerVersion: "<git commit hoặc version>",
  contentHash: "<canonical sha256>",
  indexFileUrl: "<R2/public/r2 URL nếu có>"
}
```

Document legacy không có các field này vẫn được đọc bình thường. Mỗi lần import
mới hoặc re-import qua code hiện tại sẽ tự ghi các field.

### `pageindex_trees`

Collection mới lưu mỗi version raw artifact:

```javascript
{
  documentId: ObjectId,
  schemaVersion: 1,
  producer: "internal-md-converter",
  producerVersion: "<version nếu biết chính xác>",
  contentHash: "<canonical sha256>",
  byteSize: 123456,
  nodeCount: 155,
  indexFileUrl: "<R2 URL>",
  rawTree: { /* original PageIndex JSON nếu <= 14 MB */ },
  createdAt: ISODate()
}
```

Unique key là `documentId + contentHash`, vì vậy import lại đúng cùng artifact
không tạo version trùng.

### `pageindex_nodes`

Không thay đổi schema bắt buộc. Đây vẫn là read model dùng cho retrieval:

- `documentId`;
- `nodeId`, `parentNodeId`, `childrenIds`;
- `title`, `summary`, `content`;
- `path`, `level`;
- `pageStart`, `pageEnd`, `sourceRef`.

Re-import cùng `slug` giữ nguyên document `_id`, nhưng xóa rồi tạo lại node
records. Mongo `_id` của từng node sẽ đổi; `nodeId` chỉ ổn định nếu dùng lại đúng
artifact hoặc generator tạo cùng ID.

## Database có cần thay đổi ngay không?

### Không cần nếu mục tiêu chỉ là giữ ứng dụng đang chạy

Document hiện tại có đủ evidence và lexical regression không giảm. Có thể deploy
code mới trước mà chưa backfill. Các field optional giúp code mới đọc được dữ
liệu cũ.

### Nên thay đổi nếu cần provenance, rollback và tái lập ingestion

`tech-support-manual` hiện thiếu raw tree và provenance. Hệ quả:

- không chứng minh được flattened nodes đến từ artifact/commit nào;
- không thể so hash để phát hiện drift;
- không có raw version trong MongoDB để audit/rollback;
- không có `indexFileUrl` để phục hồi từ R2.

Vì vậy, đây là migration được khuyến nghị trước khi coi phần ingestion là hoàn
chỉnh ở mức production.

## Phương án migration khuyến nghị

### 1. Sao lưu trước khi re-import

Tạo Atlas snapshot hoặc export tối thiểu:

- document có slug `tech-support-manual`;
- 155 records trong `pageindex_nodes` của document;
- các helpdesk/messages đang tham chiếu document hoặc node IDs.

Importer hiện thay thế node read model theo kiểu delete rồi insert, không phải
MongoDB transaction. Chỉ re-import sau khi backup hoàn tất và nên thực hiện
trong thời gian ít traffic.

### 2. Khôi phục đúng final PageIndex JSON

Ưu tiên dùng đúng file JSON cuối đã tạo ra 155 node, sau khi:

- thêm Vietnamese summaries;
- rewrite 561 image references;
- chia table chunks;
- hoàn tất các chỉnh sửa thủ công trước đây.

Không nên chạy lại PageIndex từ source rồi import ngay nếu chưa so sánh node
IDs, summaries và image references. Regenerate có thể làm citation cũ trong
`messages` trỏ đến node ID không còn tồn tại.

Hiện repository không còn tìm thấy final JSON này trong workspace và document
không có `indexFileUrl`. Cần tìm trong backup cũ, máy tạo artifact hoặc R2 object
nếu trước đây đã upload nhưng chưa ghi URL vào document.

### 3. Re-import cùng slug

Vì Tech Support Manual được tạo bởi converter nội bộ, producer hợp lý là
`internal-md-converter`, không phải `vectify-pageindex`. Chỉ điền
`producerVersion` khi biết chính xác commit/version đã tạo artifact; không nên
bịa version.

```powershell
npm run import:pageindex -- `
  --file "C:/path/to/final-tech-support-manual-pageindex.json" `
  --title "Tech Support Manual" `
  --slug "tech-support-manual" `
  --tags "helpdesk,tech-support" `
  --version "content-v1" `
  --producer "internal-md-converter" `
  --backup-to-r2
```

Lệnh dùng cùng slug nên giữ document `_id`, do đó helpdesk đang scope theo
`documentSlugs` không cần sửa.

### 4. Kiểm tra sau migration

Điều kiện tối thiểu:

- document vẫn `ready`;
- `pageindex_nodes` vẫn có 155 node, hoặc chênh lệch đã được review;
- có ít nhất 142 content-bearing nodes, hoặc chênh lệch đã được review;
- `indexSchemaVersion = 1`;
- `producer = internal-md-converter`;
- `contentHash` có giá trị;
- có đúng một `pageindex_trees` record cho hash vừa import;
- raw tree được lưu inline, hoặc có `indexFileUrl` hợp lệ;
- R2 object đọc được;
- các node IDs quan trọng trong golden set vẫn tồn tại.

Sau đó chạy:

```powershell
npm run eval:pageindex -- `
  --helpdesk tech-support `
  --strategy lexical `
  --top-k 6 `
  --output evals/results/post-database-backfill-lexical.json
```

Không chấp nhận migration nếu kết quả thấp hơn baseline hiện tại:

- Hit@1: `0,60`;
- Hit@3: `0,76`;
- Recall@6: `0,76`;
- MRR: `0,6773`.

### 5. Rollback

Nếu node count, citations hoặc eval regression sai:

1. khôi phục document và 155 node từ backup;
2. giữ production strategy là lexical;
3. không xóa raw tree version mới ngay—đánh dấu/ghi chú artifact bị từ chối để
   phục vụ điều tra;
4. sửa artifact ở ngoài production rồi chạy lại cùng eval gate.

## Nếu không tìm được original JSON

Có hai lựa chọn, theo thứ tự ưu tiên:

### A. Backfill provenance dạng reconstructed artifact

Tạo tree từ 155 node hiện có mà không thay `pageindex_nodes`, sau đó ghi:

- `producer = unknown` hoặc `internal-md-converter`;
- không ghi `producerVersion` nếu không chứng minh được;
- content hash của reconstructed artifact;
- ghi rõ trong migration report rằng raw tree được tái dựng từ
  `pageindex_nodes` (nếu muốn lưu cờ này trong MongoDB thì phải mở rộng schema
  có chủ đích trước).

Cần viết migration script riêng và review trước khi chạy. Không được gắn commit
VectifyAI vào artifact tái dựng vì dữ liệu hiện tại được tạo bởi pipeline nội
bộ.

Ưu điểm: không làm đổi retrieval/node IDs.  
Nhược điểm: raw tree chỉ là bản tái dựng, không phải original source artifact.

### B. Regenerate hoàn toàn rồi re-import

Chỉ dùng khi có source Markdown/PDF và có thể tái tạo summaries/image references.
Phải so node IDs, chạy full 50-case eval và review citations trước khi cutover.

## Những dữ liệu không cần migration

- `helpdesks`: đang tham chiếu `tech-support-manual` bằng slug.
- `conversations` và `messages`: không đổi schema.
- `feedback`: không đổi.
- `datasets` và `dataset_rows`: thuộc AMG/tabular QA, độc lập PageIndex.
- `prediction_models`: độc lập.
- Ragas datasets/results: lưu trong `evals/`, không đưa vào production DB.

## Definition of Done cho database backfill

- [ ] Có backup MongoDB trước migration.
- [ ] Tìm được original final JSON hoặc quyết định rõ dùng reconstructed artifact.
- [ ] Document có schema/provenance/hash metadata.
- [ ] Có raw tree version và R2 backup.
- [ ] Node count/content count đã đối chiếu.
- [ ] Golden node IDs/citations không bị drift ngoài dự kiến.
- [ ] Full lexical regression đạt hoặc vượt baseline.
- [ ] Chat E2E trả đúng sources/images.
- [ ] Rollback đã được kiểm tra hoặc có export khôi phục được.
