# Personal Helpdesk PageIndex RAG

Lightweight Helpdesk Q&A app using vectorless PageIndex retrieval. The runtime is a Next.js app deployed to Vercel, backed by MongoDB Atlas and Cloudflare R2.

This project does not require Dify, Supabase, pgvector, embeddings, or vector similarity search.

## Architecture

```text
apps/web                    Next.js UI and API routes (Vercel)
apps/web/lib/server         MongoDB, R2, retrieval/import runtime
packages/shared             Shared TypeScript contracts
workers/pageindex-ingest    Python worker for document processing & import
.claude/skills              AI skill files (hướng dẫn AI agent thao tác dự án)
```

Data flow:

1. Source files (PDF/Markdown) are processed by the Python worker into PageIndex JSON.
2. The immutable raw tree plus producer/hash metadata is stored in
   `pageindex_trees`; flattened nodes are stored in `pageindex_nodes` as a
   derived retrieval read model.
3. Chat requests use the configured PageIndex strategy. Production defaults to lexical
   keyword/title/path/summary/content ranking; experimental tree reasoning falls back
   to lexical on any failure.
4. Retrieved context is sent to Gemini with a grounded-answer prompt.
5. Answers return source references with document title, section path, and page range.

## Runtime API

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/documents` | List imported PageIndex documents |
| `POST` | `/api/documents/import` | Import PageIndex JSON into MongoDB |
| `POST` | `/api/chat` | Ask a question using PageIndex retrieval |
| `POST` | `/api/chat/retrieve` | Debug retrieval results |
| `GET` | `/api/chat/sessions` | List conversations |
| `GET` | `/api/chat/sessions/:id/messages` | List messages for one conversation |

## MongoDB Collections

- `documents`
- `pageindex_nodes`
- `pageindex_trees`
- `conversations`
- `messages`
- `feedback`

The app creates indexes lazily when API/import code touches MongoDB.

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment variables

Copy `.env.example` → `.env` and fill in values. See [ENV_SETUP_GUIDE.md](./ENV_SETUP_GUIDE.md) for detailed instructions on obtaining each key.

PageIndex retrieval defaults are intentionally safe:

```env
PAGEINDEX_RETRIEVAL_STRATEGY=lexical
PAGEINDEX_REASONING_ENABLED=false
PAGEINDEX_RETRIEVAL_TIMEOUT_MS=12000
PAGEINDEX_REASONING_MODEL=gemini-3-flash-preview
PAGEINDEX_REASONING_MAX_OUTLINE_CHARS=50000
PAGEINDEX_REASONING_COMPACT_REFS=false
```

Do not enable tree reasoning in production until it passes the gates in
[`ADR-001`](./docs/adr/ADR-001-pageindex-retrieval-architecture.md).

### 3. Run locally

```bash
npm run dev
```

Open `http://localhost:3000`.

## Adding Documents

There are 3 ways to import documents into the system:

### Option A: Admin UI (simplest)

1. Open `http://localhost:3000/admin/documents`
2. Select a PageIndex JSON file, enter title/slug/tags, and click Import

### Option B: TypeScript CLI

```bash
npm run import:pageindex -- --file ./data/warranty-index.json --title "Warranty Policy" --slug warranty-policy --tags helpdesk,warranty
```

The importer accepts both the official VectifyAI/PageIndex
`structure/node_id/start_index/end_index` schema and the internal camelCase
schema. Use `--producer-version <commit>` when the JSON came from a known
PageIndex checkout.

### Option C: Python Worker (process PDF/Markdown → MongoDB)

Use `workers/pageindex-ingest/` to process source PDFs/Markdown into PageIndex JSON and import into MongoDB.

```powershell
# Clone and pin the PageIndex producer used by this project
git clone https://github.com/VectifyAI/PageIndex.git C:/path/to/PageIndex
git -C C:/path/to/PageIndex checkout 39121c4d3479edeb049fb1e37045f3227bf50355

# PageIndex's pinned LiteLLM requires Python <3.14
py install --target=.python-3.13 -y 3.13
.\.python-3.13\python.exe -m venv .venv-pageindex
.\.venv-pageindex\Scripts\python.exe -m pip install `
  -r workers/pageindex-ingest/requirements.txt `
  -r C:/path/to/PageIndex/requirements.txt
$env:PAGEINDEX_DIR='C:/path/to/PageIndex'

# From existing PageIndex JSON
.\.venv-pageindex\Scripts\python.exe workers/pageindex-ingest/import_pageindex_to_mongo.py --index-json ./data/warranty-pageindex.json --title "Warranty Policy" --slug warranty-policy --tags helpdesk,warranty --skip-r2

# From source PDF using the pinned checkout
.\.venv-pageindex\Scripts\python.exe workers/pageindex-ingest/import_pageindex_to_mongo.py --source ./data/warranty.pdf --title "Warranty Policy" --slug warranty-policy --tags helpdesk,warranty --skip-r2
```

The worker verifies the checkout against
`workers/pageindex-ingest/pageindex-reference.lock.json`, calls the real
`run_pageindex.py --pdf_path/--md_path` entrypoint, and records the commit as
`producerVersion`.

## Offline answer-quality evaluation

Deterministic retrieval evaluation remains the deployment gate. Ragas is an
optional, offline second layer for answer faithfulness, context precision,
answer relevancy, context recall, and factual correctness.

```powershell
# Install the exact audited Ragas reference
py -3.14 -m venv .venv-ragas
.\.venv-ragas\Scripts\python.exe -m pip install -r evals/ragas/requirements.txt

# Validate a collected dataset without an LLM call
npm run eval:ragas -- --input evals/ragas-answer-eval.example.json --validate-only

# Run the paid/non-deterministic judge offline
npm run eval:ragas -- --input evals/ragas-answer-eval.json
```

See [`docs/ragas-offline-evaluation.md`](./docs/ragas-offline-evaluation.md).
Ragas results do not enable tree reasoning automatically.

> **📘 Full guide**: See [`.claude/skills/pageindex-ingestion.md`](./.claude/skills/pageindex-ingestion.md) for complete documentation including JSON schema, troubleshooting, and examples.

## AI Skill Files

This project includes skill files in `.claude/skills/` that AI coding assistants (Claude, Gemini, etc.) can read to understand how to perform project-specific tasks.

### Available Skills

| File | Purpose |
| --- | --- |
| [`pageindex-ingestion.md`](./.claude/skills/pageindex-ingestion.md) | Full guide for document processing & import using the Python worker |

### How to use

When working with an AI assistant on this project, you can prompt it to read the skill file:

```
Đọc file .claude/skills/pageindex-ingestion.md rồi giúp tôi import tài liệu [tên file] vào MongoDB
```

Or more specific:

```
Đọc skill pageindex-ingestion rồi tạo file PageIndex JSON cho tài liệu hướng dẫn sử dụng sản phẩm X, sau đó import vào MongoDB
```

The AI will:
1. Read the skill file to understand the full workflow
2. Prepare the PageIndex JSON (manually or from source file)
3. Run the Python worker to import into MongoDB
4. Verify the import result

## Deploy

### Vercel

1. Import this repo into Vercel.
2. Set root directory to `apps/web`.
3. Set environment variables (see `.env.example`).
4. Deploy with the default Next.js build.

Production deployment:

```text
https://omni-assist-rag-web.vercel.app/
```

The `support_kb` desktop client uses this deployment only for scoped cache
synchronization:

```text
GET  https://omni-assist-rag-web.vercel.app/api/helpdesks/tech-support/sync
```

Its Chat AI performs retrieval from that synchronized SQLite cache locally and
calls GCLI directly using its own ignored `.env`; it does not call this
project's `/api/chat`.

Redeploy this Vercel project after adding or modifying the sync route. A `404`
from that URL means the deployed build does not yet include the route.

### MongoDB Atlas

1. Create a MongoDB Atlas cluster.
2. Create a database such as `helpdesk_rag`.
3. Put the connection string in `MONGODB_URI`.
4. Allow Vercel outbound IP access as appropriate for your Atlas networking mode.

### Cloudflare R2 (optional)

1. Create an R2 bucket.
2. Create access keys.
3. Set `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, and `R2_BUCKET_NAME`.

### Railway (optional)

Railway is optional. Use it only for long-running PageIndex processing or scheduled ingestion jobs. The chat runtime works without Railway.

## Verification

```bash
npm run test:pageindex
npm run test:pageindex-python
npm run test:ragas-python
npm run eval:pageindex -- --helpdesk tech-support --strategy lexical --top-k 6
npm run eval:ragas -- --input evals/ragas-answer-eval.example.json --validate-only
npm run smoke:pageindex-ingestion -- --index-json evals/fixtures/pageindex-worker-smoke.json
npm run spike:pageindex
npm run typecheck
npm run build
```

Manual runtime checks:

1. Import a PageIndex JSON file through `/admin/documents` or `npm run import:pageindex`.
2. Use `/admin/debug` to verify node retrieval.
3. Ask a question in `/chat` and confirm sources are returned.

## MVP Limits

- No authentication yet; add auth before public use.
- Retrieval remains vectorless. Lexical is the production strategy; tree reasoning is
  experimental and disabled by default.
- PageIndex processing is external to the app runtime.
- R2 backup is optional for trees below the safe MongoDB inline limit. Larger
  raw trees require `indexFileUrl` or R2 backup.
