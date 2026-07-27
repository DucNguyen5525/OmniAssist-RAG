from __future__ import annotations

import importlib.util
import math
import tempfile
import unittest
from pathlib import Path


SCRIPT_PATH = Path(__file__).resolve().parents[2] / "scripts" / "eval-ragas-answer-quality.py"
SPEC = importlib.util.spec_from_file_location("eval_ragas_answer_quality", SCRIPT_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError(f"Cannot load evaluator module: {SCRIPT_PATH}")
EVALUATOR = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(EVALUATOR)


class RagasEvaluatorTests(unittest.TestCase):
    def test_metric_score_normalizes_parameterized_ragas_key(self) -> None:
        scores = {"factual_correctness(mode=f1)": 0.75}
        self.assertEqual(EVALUATOR.metric_score(scores, "factual_correctness"), 0.75)

    def test_non_finite_scores_are_rejected(self) -> None:
        self.assertFalse(EVALUATOR.is_valid_number(math.nan))
        self.assertFalse(EVALUATOR.is_valid_number(None))
        self.assertTrue(EVALUATOR.is_valid_number(0.0))

    def test_dataset_rejects_duplicate_ids(self) -> None:
        payload = """{
          "cases": [
            {"id":"same","user_input":"Q1","response":"A1","retrieved_contexts":["C1"]},
            {"id":"same","user_input":"Q2","response":"A2","retrieved_contexts":["C2"]}
          ]
        }"""
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "dataset.json"
            path.write_text(payload, encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "Duplicate case id"):
                EVALUATOR.load_cases(path)


if __name__ == "__main__":
    unittest.main()
