from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from flatten_pageindex_tree import flatten_pageindex_tree
from pageindex_artifact import build_pageindex_artifact
from run_pageindex_local import run_pageindex


FIXTURE = (
    Path(__file__).resolve().parents[2]
    / "evals"
    / "fixtures"
    / "pageindex-official-minimal.json"
)


class FlattenPageIndexTreeTests(unittest.TestCase):
    def test_official_pageindex_shape(self) -> None:
        index_json = json.loads(FIXTURE.read_text(encoding="utf-8"))
        nodes = flatten_pageindex_tree(index_json)

        self.assertEqual(len(nodes), 4)
        by_id = {node["nodeId"]: node for node in nodes}
        operations = next(node for node in nodes if node["title"] == "Operations")

        self.assertEqual(operations["childrenIds"], ["0001", "0002"])
        self.assertEqual(by_id["0001"]["parentNodeId"], operations["nodeId"])
        self.assertEqual(by_id["0001"]["pageStart"], 1)
        self.assertEqual(by_id["0001"]["pageEnd"], 2)
        self.assertEqual(by_id["0002"]["summary"], "Steps for closing a batch.")
        self.assertEqual(by_id["0003"]["pageStart"], 42)
        self.assertEqual(by_id["0003"]["pageEnd"], 42)

    def test_duplicate_upstream_ids_are_rejected(self) -> None:
        with self.assertRaisesRegex(ValueError, "Duplicate PageIndex node ID"):
            flatten_pageindex_tree(
                {
                    "structure": [
                        {"title": "First", "node_id": "0001", "text": "first"},
                        {"title": "Second", "node_id": "0001", "text": "second"},
                    ]
                }
            )

    def test_artifact_hash_is_stable_across_key_order(self) -> None:
        left = {
            "structure": [{"title": "A", "node_id": "0001", "text": "Evidence"}],
            "doc_name": "doc",
        }
        right = {
            "doc_name": "doc",
            "structure": [{"text": "Evidence", "node_id": "0001", "title": "A"}],
        }
        first = build_pageindex_artifact(left, producer_version="39121c4")
        second = build_pageindex_artifact(right, producer_version="39121c4")

        self.assertEqual(first["contentHash"], second["contentHash"])
        self.assertEqual(first["producer"], "vectify-pageindex")
        self.assertEqual(first["producerVersion"], "39121c4")

    def test_default_worker_command_requests_node_text(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "manual.md"
            source.write_text("# Manual", encoding="utf-8")
            produced = root / "results" / "manual_structure.json"
            produced.parent.mkdir()
            produced.write_text('{"structure":[]}', encoding="utf-8")
            output = root / "output.json"

            with (
                patch("run_pageindex_local.resolve_pageindex_dir", return_value=root),
                patch("run_pageindex_local.subprocess.run") as subprocess_run,
                patch.dict("run_pageindex_local.os.environ", {"PAGEINDEX_MODEL": "test-model"}, clear=True),
            ):
                run_pageindex(str(source), str(output))

            command = subprocess_run.call_args.args[0]
            text_flag = command.index("--if-add-node-text")
            self.assertEqual(command[text_flag + 1], "yes")
            self.assertEqual(json.loads(output.read_text(encoding="utf-8")), {"structure": []})


if __name__ == "__main__":
    unittest.main()
