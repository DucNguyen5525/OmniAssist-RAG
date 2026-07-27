from __future__ import annotations

import hashlib
from typing import Any


def flatten_pageindex_tree(index_json: Any) -> list[dict[str, Any]]:
    roots = _root_candidates(index_json)
    nodes: list[dict[str, Any]] = []
    seen: set[str] = set()
    for sibling_index, root in enumerate(roots):
        _walk(root, None, [], 0, sibling_index, nodes, seen)
    return [node for node in nodes if node.get("title") or node.get("summary") or node.get("content")]


def _root_candidates(value: Any) -> list[Any]:
    if isinstance(value, list):
        return value
    if not isinstance(value, dict):
        return []
    if isinstance(value.get("structure"), list):
        return value["structure"]
    if isinstance(value.get("nodes"), list):
        return value["nodes"]
    if isinstance(value.get("children"), list):
        return [value]
    if value.get("root") is not None:
        return [value["root"]]
    if value.get("tree") is not None:
        return [value["tree"]]
    if value.get("document") is not None:
        return _root_candidates(value["document"])
    return [value]


def _walk(
    raw: Any,
    parent_id: str | None,
    inherited_path: list[str],
    level: int,
    sibling_index: int,
    nodes: list[dict[str, Any]],
    seen: set[str],
) -> None:
    if not isinstance(raw, dict):
        return
    title = (
        _string(raw.get("title"))
        or _string(raw.get("node_title"))
        or _string(raw.get("heading"))
        or _string(raw.get("name"))
        or "Untitled section"
    )
    path = _path(raw.get("path"), inherited_path + [title])
    node_id = (
        _string(raw.get("nodeId"))
        or _string(raw.get("node_id"))
        or _string(raw.get("id"))
        or _stable_id(path, sibling_index)
    )
    children = raw.get("children") or raw.get("nodes") or raw.get("sections") or []
    if not isinstance(children, list):
        children = []

    if node_id in seen:
        raise ValueError(f"Duplicate PageIndex node ID '{node_id}'.")
    seen.add(node_id)

    record = {
        "nodeId": node_id,
        "parentNodeId": parent_id,
        "title": title,
        "summary": _string(raw.get("summary")) or _string(raw.get("prefix_summary")) or _string(raw.get("abstract")),
        "content": _string(raw.get("content")) or _string(raw.get("text")) or _string(raw.get("body")) or "",
        "path": path,
        "level": _number(raw.get("level")) if _number(raw.get("level")) is not None else level,
        "pageStart": _first_number(raw, "pageStart", "page_start", "startPage", "start_index", "line_num"),
        "pageEnd": _first_number(raw, "pageEnd", "page_end", "endPage", "end_index", "line_num"),
        "sourceRef": _string(raw.get("sourceRef")) or _string(raw.get("source_ref")) or _string(raw.get("source")),
        "childrenIds": [],
    }
    nodes.append(record)

    for index, child in enumerate(children):
        _walk(child, node_id, path, level + 1, index, nodes, seen)
        if isinstance(child, dict):
            record["childrenIds"].append(_child_id(child, path, index))


def _string(value: Any) -> str | None:
    if isinstance(value, str) and value.strip():
        return value.strip()
    return None


def _number(value: Any) -> int | float | None:
    if isinstance(value, (int, float)):
        return value
    if isinstance(value, str) and value.strip():
        try:
            return int(value)
        except ValueError:
            return None
    return None


def _path(value: Any, fallback: list[str]) -> list[str]:
    if isinstance(value, list):
        return [str(item) for item in value if str(item).strip()]
    if isinstance(value, str) and value.strip():
        return [part.strip() for part in value.replace(">", "/").split("/") if part.strip()]
    return fallback


def _child_id(child: dict[str, Any], path: list[str], index: int) -> str:
    title = (
        _string(child.get("title"))
        or _string(child.get("node_title"))
        or _string(child.get("heading"))
        or _string(child.get("name"))
        or "Untitled section"
    )
    child_path = _path(child.get("path"), path + [title])
    return (
        _string(child.get("nodeId"))
        or _string(child.get("node_id"))
        or _string(child.get("id"))
        or _stable_id(child_path, index)
    )


def _stable_id(path: list[str], index: int) -> str:
    raw = "/".join(path) + f"/{index}"
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()[:16]


def _first_number(record: dict[str, Any], *names: str) -> int | float | None:
    for name in names:
        value = _number(record.get(name))
        if value is not None:
            return value
    return None
