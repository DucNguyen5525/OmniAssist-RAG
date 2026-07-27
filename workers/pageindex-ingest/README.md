# PageIndex ingestion worker

Optional tooling for processing source files with a pinned
VectifyAI/PageIndex checkout outside the Vercel runtime.

Normal chat runtime does not require this worker. Deploy it to Railway only for
long-running or scheduled document ingestion.

## Install

```powershell
git clone https://github.com/VectifyAI/PageIndex.git C:/path/to/PageIndex
git -C C:/path/to/PageIndex checkout 39121c4d3479edeb049fb1e37045f3227bf50355

py install --target=.python-3.13 -y 3.13
.\.python-3.13\python.exe -m venv .venv-pageindex
.\.venv-pageindex\Scripts\python.exe -m pip install \
  -r workers/pageindex-ingest/requirements.txt \
  -r C:/path/to/PageIndex/requirements.txt
```

PageIndex pins `litellm==1.84.0`, which requires Python `<3.14`; the isolated
worker environment therefore uses Python 3.13 even when the system default is
3.14.

The expected repository and commit are recorded in
`pageindex-reference.lock.json`. The worker rejects another commit unless
`PAGEINDEX_ALLOW_UNPINNED=true` is explicitly set for a one-off experiment.

## Modes

Process a source file with the pinned PageIndex checkout, optionally upload
source/tree artifacts to R2, and import into MongoDB:

```bash
python import_pageindex_to_mongo.py \
  --source ./data/warranty.pdf \
  --pageindex-dir C:/path/to/PageIndex \
  --title "Warranty Policy" \
  --slug warranty-policy \
  --tags helpdesk,warranty
```

Import existing PageIndex JSON:

```bash
python import_pageindex_to_mongo.py \
  --index-json ./output/warranty-pageindex.json \
  --producer vectify-pageindex \
  --producer-version 39121c4d3479edeb049fb1e37045f3227bf50355 \
  --title "Warranty Policy" \
  --slug warranty-policy \
  --tags helpdesk,warranty
```

## Environment

```text
MONGODB_URI=
MONGODB_DB=helpdesk_rag
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET_NAME=
R2_PUBLIC_BASE_URL=
GCLI_BASE_URL=https://gcli.ggchan.dev/v1
GCLI_API_KEYS=key1:10,key2:20
GCLI_MODEL=gemini-3-flash-preview
PAGEINDEX_MODEL=gemini-3-flash-preview
PAGEINDEX_DIR=C:/path/to/PageIndex
PAGEINDEX_EXPECTED_COMMIT=39121c4d3479edeb049fb1e37045f3227bf50355
PAGEINDEX_ALLOW_UNPINNED=false
```

`PAGEINDEX_COMMAND` is an advanced override only. It may use `{source}`,
`{output}`, `{pageindex_dir}`, and `{model}` placeholders. Without it, the
worker calls the upstream `run_pageindex.py --pdf_path/--md_path` entrypoint and
copies its validated JSON output to the requested worker path. The default
command explicitly enables `--if-add-node-text yes`: upstream PageIndex leaves
node text disabled by default, while OmniAssist needs that text as answer
evidence. A custom `PAGEINDEX_COMMAND` is responsible for enabling equivalent
output. Existing JSON that contains no evidence text is rejected during import.

## Persistence

- `documents`: active document metadata and latest content hash.
- `pageindex_nodes`: flattened retrieval read model.
- `pageindex_trees`: immutable raw tree versions and producer metadata.
- R2: optional external source/tree backup.

Raw trees up to 14 MB are stored inline. Larger trees require an external
artifact URL, normally created by leaving R2 backup enabled.

## Supported source formats

- `.pdf`, `.md`, `.markdown`: passed to PageIndex.
- `.txt`: converted to a simple Markdown document.
- `.docx`, `.xlsx`, `.pptx`, `.html`, `.csv`: converted with MarkItDown.

## Verify

From the repository root:

```bash
npm run test:pageindex-python

npm run smoke:pageindex-ingestion -- \
  --index-json evals/fixtures/pageindex-worker-smoke.json
```

The smoke command writes a unique document, flattened nodes, an immutable raw
tree, and an R2 object; verifies them; then removes only those exact smoke
artifacts. Pass `--keep` only when manual inspection is required.

Do not call this worker from Next.js route handlers. It is an ingestion
boundary, not the production chat retrieval service.
