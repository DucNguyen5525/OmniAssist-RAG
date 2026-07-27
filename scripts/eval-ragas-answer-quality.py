from __future__ import annotations

import argparse
import asyncio
import json
import math
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run optional offline Ragas answer-quality evaluation."
    )
    parser.add_argument("--input", required=True, help="Evaluation dataset JSON.")
    parser.add_argument("--output", help="Result JSON path.")
    parser.add_argument("--model", help="OpenAI-compatible evaluator model.")
    parser.add_argument("--base-url", help="OpenAI-compatible base URL.")
    parser.add_argument("--api-key", help="Evaluator key; prefer environment variables.")
    parser.add_argument(
        "--max-tokens",
        type=int,
        help="Maximum structured-output tokens per judge call (default: 4096).",
    )
    parser.add_argument(
        "--validate-only",
        action="store_true",
        help="Validate the dataset without importing Ragas or calling an LLM.",
    )
    return parser.parse_args()


def load_cases(path: Path) -> list[dict[str, Any]]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    cases = payload.get("cases") if isinstance(payload, dict) else payload
    if not isinstance(cases, list) or not cases:
        raise ValueError("Input must be a non-empty JSON array or an object with cases[].")

    normalized: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    for index, item in enumerate(cases):
        if not isinstance(item, dict):
            raise ValueError(f"Case {index} must be an object.")
        case_id = str(item.get("id") or f"case-{index + 1:03d}")
        if case_id in seen_ids:
            raise ValueError(f"Duplicate case id: {case_id}")
        seen_ids.add(case_id)

        user_input = _required_string(item, "user_input", case_id)
        response = _required_string(item, "response", case_id)
        contexts = item.get("retrieved_contexts")
        if not isinstance(contexts, list) or not contexts:
            raise ValueError(f"Case {case_id} requires non-empty retrieved_contexts[].")
        if not all(isinstance(context, str) and context.strip() for context in contexts):
            raise ValueError(f"Case {case_id} contains an empty/non-string context.")

        sample: dict[str, Any] = {
            "id": case_id,
            "user_input": user_input,
            "retrieved_contexts": [context.strip() for context in contexts],
            "response": response,
        }
        reference = item.get("reference")
        if reference is not None:
            if not isinstance(reference, str) or not reference.strip():
                raise ValueError(f"Case {case_id} has an invalid reference.")
            sample["reference"] = reference.strip()
        normalized.append(sample)
    return normalized


def _required_string(item: dict[str, Any], name: str, case_id: str) -> str:
    value = item.get(name)
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"Case {case_id} requires a non-empty {name}.")
    return value.strip()


def resolve_api_key(explicit: str | None) -> str:
    direct = (
        explicit
        or os.getenv("RAGAS_API_KEY")
        or os.getenv("OPENAI_API_KEY")
        or os.getenv("GCLI_API_KEY")
    )
    if direct:
        return direct.strip()
    weighted = os.getenv("GCLI_API_KEYS", "")
    if weighted:
        return weighted.split(",")[0].strip().split(":")[0].strip()
    raise RuntimeError(
        "Missing evaluator key. Set RAGAS_API_KEY, OPENAI_API_KEY, or GCLI_API_KEYS."
    )


async def run_evaluation(
    cases: list[dict[str, Any]],
    *,
    model: str,
    base_url: str | None,
    api_key: str,
    max_tokens: int,
) -> tuple[list[str], list[dict[str, Any]], dict[str, float | None]]:
    try:
        from openai import AsyncOpenAI
        from ragas import EvaluationDataset, aevaluate
        from ragas.llms import llm_factory
        from ragas.metrics import (
            AspectCritic,
            Faithfulness,
            FactualCorrectness,
            LLMContextPrecisionWithoutReference,
            LLMContextRecall,
        )
    except ImportError as error:
        raise RuntimeError(
            "Ragas dependencies are missing. Install evals/ragas/requirements.txt "
            "or install the pinned local clone."
        ) from error

    client = AsyncOpenAI(api_key=api_key, base_url=base_url)
    evaluator_llm = llm_factory(
        model,
        provider="openai",
        client=client,
        max_tokens=max_tokens,
    )
    metrics: list[Any] = [
        Faithfulness(),
        LLMContextPrecisionWithoutReference(),
        AspectCritic(
            name="answer_relevancy",
            definition=(
                "Does the response directly and completely address the user's question "
                "without irrelevant information?"
            ),
            strictness=3,
        ),
    ]
    if all("reference" in case for case in cases):
        metrics.extend([LLMContextRecall(), FactualCorrectness()])

    dataset_rows = [
        {key: value for key, value in case.items() if key != "id"} for case in cases
    ]
    result = await aevaluate(
        dataset=EvaluationDataset.from_list(dataset_rows),
        metrics=metrics,
        llm=evaluator_llm,
        raise_exceptions=False,
        show_progress=True,
    )
    metric_names = [metric.name for metric in metrics]
    per_case = []
    incomplete: list[str] = []
    for case, raw_scores in zip(cases, result.scores):
        scores: dict[str, Any] = {}
        for name in metric_names:
            value = metric_score(raw_scores, name)
            scores[name] = value
            if not is_valid_number(value):
                incomplete.append(f"{case['id']}:{name}")
        per_case.append({"id": case["id"], **scores})

    if incomplete:
        preview = ", ".join(incomplete[:8])
        suffix = "" if len(incomplete) <= 8 else f" (+{len(incomplete) - 8} more)"
        raise RuntimeError(
            "Ragas returned incomplete metric scores: "
            f"{preview}{suffix}. Increase --max-tokens or inspect evaluator compatibility."
        )

    aggregate = {
        name: average_valid([scores.get(name) for scores in per_case])
        for name in metric_names
    }
    return metric_names, per_case, aggregate


def metric_score(scores: dict[str, Any], name: str) -> Any:
    if name in scores:
        return scores[name]
    return next(
        (value for key, value in scores.items() if key.startswith(f"{name}(")),
        None,
    )


def is_valid_number(value: Any) -> bool:
    return (
        isinstance(value, (int, float))
        and not isinstance(value, bool)
        and math.isfinite(float(value))
    )


def average_valid(values: list[Any]) -> float | None:
    numeric = [
        float(value)
        for value in values
        if isinstance(value, (int, float)) and not math.isnan(float(value))
    ]
    return sum(numeric) / len(numeric) if numeric else None


async def main() -> None:
    try:
        from dotenv import load_dotenv

        root_env = Path(__file__).resolve().parents[1] / ".env"
        load_dotenv(root_env if root_env.exists() else None)
    except ImportError:
        # --validate-only intentionally works without optional evaluator packages.
        pass

    args = parse_args()
    input_path = Path(args.input).resolve()
    cases = load_cases(input_path)
    references_complete = all("reference" in case for case in cases)
    if args.validate_only:
        print(
            json.dumps(
                {
                    "valid": True,
                    "cases": len(cases),
                    "referencesComplete": references_complete,
                    "metricsWithReferences": [
                        "faithfulness",
                        "llm_context_precision_without_reference",
                        "answer_relevancy",
                        "context_recall",
                        "factual_correctness",
                    ],
                    "metricsWithoutReferences": [
                        "faithfulness",
                        "llm_context_precision_without_reference",
                        "answer_relevancy",
                    ],
                },
                indent=2,
            )
        )
        return

    model = (
        args.model
        or os.getenv("RAGAS_EVALUATOR_MODEL")
        or os.getenv("GCLI_MODEL")
        or "gemini-2.5-flash"
    )
    max_tokens = args.max_tokens or int(os.getenv("RAGAS_MAX_TOKENS", "4096"))
    if max_tokens < 256:
        raise ValueError("--max-tokens/RAGAS_MAX_TOKENS must be at least 256.")
    base_url = (
        args.base_url
        or os.getenv("RAGAS_BASE_URL")
        or os.getenv("OPENAI_BASE_URL")
        or os.getenv("GCLI_BASE_URL")
    )
    metric_names, per_case, aggregate = await run_evaluation(
        cases,
        model=model,
        base_url=base_url,
        api_key=resolve_api_key(args.api_key),
        max_tokens=max_tokens,
    )
    output_path = Path(
        args.output
        or (
            "evals/results/ragas-answer-"
            + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
            + ".json"
        )
    ).resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "input": display_path(input_path),
        "model": model,
        "maxTokens": max_tokens,
        "baseUrlConfigured": bool(base_url),
        "caseCount": len(cases),
        "referencesComplete": references_complete,
        "metrics": metric_names,
        "aggregate": aggregate,
        "cases": per_case,
    }
    output_path.write_text(
        json.dumps(output, ensure_ascii=False, indent=2, allow_nan=False),
        encoding="utf-8",
    )
    print(json.dumps({"output": str(output_path), "aggregate": aggregate}, indent=2))


def display_path(path: Path) -> str:
    try:
        return path.relative_to(Path.cwd().resolve()).as_posix()
    except ValueError:
        return str(path)


if __name__ == "__main__":
    asyncio.run(main())
