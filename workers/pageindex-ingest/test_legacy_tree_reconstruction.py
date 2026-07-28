from __future__ import annotations

import unittest

from legacy_tree_reconstruction import reconstruct_pageindex_tree


class LegacyTreeReconstructionTests(unittest.TestCase):
    def test_reconstructs_without_changing_flat_nodes(self) -> None:
        nodes = [
            {
                "nodeId": "root",
                "title": "Root",
                "summary": "Routing summary",
                "content": "",
                "path": ["Root"],
                "level": 0,
                "childrenIds": ["child"],
            },
            {
                "nodeId": "child",
                "parentNodeId": "root",
                "title": "Child",
                "content": "Evidence",
                "path": ["Root", "Child"],
                "level": 1,
                "pageStart": 2,
                "pageEnd": 3,
                "sourceRef": "manual.md",
                "childrenIds": [],
            },
        ]
        tree = reconstruct_pageindex_tree(
            {"_id": "doc-1", "title": "Manual", "slug": "manual"},
            nodes,
        )

        self.assertEqual(tree["_meta"]["origin"], "reconstructed-from-pageindex-nodes")
        self.assertEqual(tree["document"]["nodes"][0]["nodeId"], "root")
        self.assertEqual(
            tree["document"]["nodes"][0]["children"][0]["nodeId"],
            "child",
        )

    def test_rejects_inconsistent_children(self) -> None:
        with self.assertRaisesRegex(ValueError, "inconsistent childrenIds"):
            reconstruct_pageindex_tree(
                {"_id": "doc-1", "title": "Manual", "slug": "manual"},
                [
                    {
                        "nodeId": "root",
                        "title": "Root",
                        "content": "",
                        "path": ["Root"],
                        "level": 0,
                        "childrenIds": [],
                    },
                    {
                        "nodeId": "child",
                        "parentNodeId": "root",
                        "title": "Child",
                        "content": "Evidence",
                        "path": ["Root", "Child"],
                        "level": 1,
                        "childrenIds": [],
                    },
                ],
            )


if __name__ == "__main__":
    unittest.main()
