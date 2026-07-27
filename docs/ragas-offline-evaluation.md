# Ragas offline answer-quality evaluation

## Purpose

`eval:pageindex` measures deterministic retrieval quality and latency. It does
not measure whether the generated answer is faithful, relevant, or factually
correct. `eval:ragas` adds that second layer without putting an LLM judge in the
production request path or mandatory CI.

The audited reference is pinned in:

- `evals/ragas/reference.lock.json`
- `evals/ragas/requirements.txt`

## Dataset contract

The input is a JSON array or an object with `cases[]`:

```json
{
  "cases": [
    {
      "id": "stable-case-id",
      "user_input": "Question shown to the application",
      "retrieved_contexts": ["Exact context sent to answer generation"],
      "response": "Application answer",
      "reference": "Human-verified expected answer"
    }
  ]
}
```

`reference` is optional. When every case has one, the evaluator also runs
context recall and factual correctness. Without references it runs:

- faithfulness;
- LLM context precision without reference;
- an LLM-based Ragas `AspectCritic` named `answer_relevancy`.

The binary answer-relevancy judge uses three votes. It avoids requiring an
embedding endpoint from the OpenAI-compatible proxy.

## Install

Create the isolated evaluator environment:

```powershell
py -3.14 -m venv .venv-ragas
.\.venv-ragas\Scripts\python.exe -m pip install -r evals/ragas/requirements.txt
```

When `C:\.dev\.ref\.rag\ragas` is available, an equivalent local editable
installation avoids downloading the repository again:

```powershell
.\.venv-ragas\Scripts\python.exe -m pip install C:\.dev\.ref\.rag\ragas
.\.venv-ragas\Scripts\python.exe -m pip install python-dotenv==1.2.2
```

`npm run eval:ragas` uses `.venv-ragas` explicitly and loads the repository
`.env` without copying credentials into output artifacts.

The requirements also pin `langchain-community==0.4.1`. The audited Ragas
commit imports `langchain_community.chat_models.vertexai`; version `0.4.2`
removed that module and cannot import Ragas successfully.

## Validate and run

```bash
npm run eval:ragas -- \
  --input evals/ragas-answer-eval.example.json \
  --validate-only

npm run eval:ragas -- \
  --input evals/ragas-answer-eval.json \
  --output evals/results/ragas-answer-production-candidate.json
```

Configuration priority:

1. CLI `--api-key`, `--base-url`, `--model`;
2. `RAGAS_API_KEY`, `RAGAS_BASE_URL`, `RAGAS_EVALUATOR_MODEL`;
3. existing `OPENAI_*` or `GCLI_*` values.

The script never writes API keys to result artifacts. Result JSON contains
aggregate and per-case scores. Structured judge calls default to 4096 output
tokens (`RAGAS_MAX_TOKENS` or `--max-tokens`); the command fails instead of
writing a misleading artifact when any metric is missing or non-finite.

## Quality interpretation

Initial targets:

| Metric | Target |
| --- | ---: |
| Faithfulness | `> 0.85` |
| Context precision | `> 0.80` |
| Answer relevancy | `> 0.80` |
| Context recall, when references exist | `> 0.75` |

These metrics complement, but never replace, retrieval Hit@3/Recall@6,
scope-safety checks, latency gates, and manual citation review. Calibrate the
judge against a small human-scored Vietnamese/English set before enforcing it
in CI.
