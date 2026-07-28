from __future__ import annotations

from typing import Any

from flatten_pageindex_tree import flatten_pageindex_tree


def reconstruct_pageindex_tree(
    document: dict[str, Any],
    nodes: list[dict[str, Any]],
) -> dict[str, Any]:
    """Rebuild a deterministic internal PageIndex tree without changing node IDs."""
    if not nodes:
        raise ValueError("Cannot reconstruct a PageIndex tree without nodes.")

    by_id: dict[str, dict[str, Any]] = {}
    for node in nodes:
        node_id = str(node.get("nodeId") or "").strip()
        if not node_id:
            raise ValueError("Legacy PageIndex node is missing nodeId.")
        if node_id in by_id:
            raise ValueError(f"Duplicate legacy PageIndex node ID '{node_id}'.")
        by_id[node_id] = node

    children_by_parent: dict[str, list[str]] = {node_id: [] for node_id in by_id}
    roots: list[str] = []
    for node_id, node in by_id.items():
        parent_id = _optional_string(node.get("parentNodeId"))
        if parent_id is None:
            roots.append(node_id)
            continue
        if parent_id not in by_id:
            raise ValueError(
                f"Legacy PageIndex node '{node_id}' references missing parent '{parent_id}'."
            )
        children_by_parent[parent_id].append(node_id)

    for parent_id, children in children_by_parent.items():
        declared = [
            str(child_id)
            for child_id in (by_id[parent_id].get("childrenIds") or [])
        ]
        missing = [child_id for child_id in declared if child_id not in by_id]
        if missing:
            raise ValueError(
                f"Legacy PageIndex node '{parent_id}' references missing children: "
                + ", ".join(missing)
            )
        actual = set(children)
        if set(declared) != actual:
            raise ValueError(
                f"Legacy PageIndex node '{parent_id}' has inconsistent childrenIds."
            )
        declared_position = {child_id: index for index, child_id in enumerate(declared)}
        children.sort(key=lambda child_id: (declared_position[child_id], child_id))

    roots.sort(key=lambda node_id: (_number(by_id[node_id].get("level")) or 0, node_id))
    state: dict[str, int] = {}

    def build(node_id: str) -> dict[str, Any]:
        visit_state = state.get(node_id, 0)
        if visit_state == 1:
            raise ValueError(f"Cycle detected at legacy PageIndex node '{node_id}'.")
        if visit_state == 2:
            raise ValueError(
                f"Legacy PageIndex node '{node_id}' is reachable from multiple parents."
            )
        state[node_id] = 1
        node = by_id[node_id]
        output: dict[str, Any] = {
            "nodeId": node_id,
            "title": str(node.get("title") or "Untitled section"),
            "content": str(node.get("content") or ""),
            "path": [str(part) for part in (node.get("path") or [])],
            "level": _number(node.get("level")) or 0,
        }
        _copy_optional(output, "summary", node.get("summary"))
        _copy_optional(output, "pageStart", node.get("pageStart"))
        _copy_optional(output, "pageEnd", node.get("pageEnd"))
        _copy_optional(output, "sourceRef", node.get("sourceRef"))
        children = [build(child_id) for child_id in children_by_parent[node_id]]
        if children:
            output["children"] = children
        state[node_id] = 2
        return output

    tree = {
        "_meta": {
            "origin": "reconstructed-from-pageindex-nodes",
            "reconstructionVersion": 1,
            "sourceDocumentId": str(document.get("_id") or ""),
            "originalNodeCount": len(nodes),
        },
        "document": {
            "title": str(document.get("title") or ""),
            "slug": str(document.get("slug") or ""),
            "nodes": [build(node_id) for node_id in roots],
        },
    }

    if len(state) != len(by_id):
        unreachable = sorted(set(by_id) - set(state))
        # With a single-parent graph, nodes not reachable from a root imply a cycle.
        build(unreachable[0])

    assert_round_trip(nodes, tree)
    return tree


def assert_round_trip(
    original_nodes: list[dict[str, Any]],
    reconstructed_tree: dict[str, Any],
) -> None:
    flattened = flatten_pageindex_tree(reconstructed_tree)
    original = {_normalized_node(node)["nodeId"]: _normalized_node(node) for node in original_nodes}
    rebuilt = {_normalized_node(node)["nodeId"]: _normalized_node(node) for node in flattened}
    if original.keys() != rebuilt.keys():
        missing = sorted(original.keys() - rebuilt.keys())
        extra = sorted(rebuilt.keys() - original.keys())
        raise ValueError(
            f"Reconstructed tree node IDs differ; missing={missing[:5]}, extra={extra[:5]}."
        )
    for node_id in original:
        if original[node_id] != rebuilt[node_id]:
            changed = [
                key
                for key in original[node_id]
                if original[node_id][key] != rebuilt[node_id][key]
            ]
            raise ValueError(
                f"Reconstructed PageIndex node '{node_id}' changed fields: "
                + ", ".join(changed)
            )


def _normalized_node(node: dict[str, Any]) -> dict[str, Any]:
    return {
        "nodeId": str(node.get("nodeId") or ""),
        "parentNodeId": _optional_string(node.get("parentNodeId")),
        "title": str(node.get("title") or "").strip(),
        "summary": _optional_string(node.get("summary")),
        "content": str(node.get("content") or "").strip(),
        "path": [str(part) for part in (node.get("path") or [])],
        "level": _number(node.get("level")) or 0,
        "pageStart": _number(node.get("pageStart")),
        "pageEnd": _number(node.get("pageEnd")),
        "sourceRef": _optional_string(node.get("sourceRef")),
        "childrenIds": [str(child_id) for child_id in (node.get("childrenIds") or [])],
    }


def _copy_optional(output: dict[str, Any], key: str, value: Any) -> None:
    if value is not None and value != "":
        output[key] = value


def _optional_string(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _number(value: Any) -> int | float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return value
    if isinstance(value, str) and value.strip():
        try:
            number = float(value)
            return int(number) if number.is_integer() else number
        except ValueError:
            return None
    return None
