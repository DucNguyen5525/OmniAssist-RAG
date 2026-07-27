from __future__ import annotations

import hashlib
import json
from typing import Any


PAGEINDEX_TREE_SCHEMA_VERSION = 1
MAX_INLINE_PAGEINDEX_TREE_BYTES = 14_000_000


def build_pageindex_artifact(
    index_json: Any,
    *,
    producer: str | None = None,
    producer_version: str | None = None,
    external_artifact_available: bool = False,
) -> dict[str, Any]:
    canonical_json = json.dumps(
        index_json,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    encoded = canonical_json.encode("utf-8")
    byte_size = len(encoded)
    if byte_size > MAX_INLINE_PAGEINDEX_TREE_BYTES and not external_artifact_available:
        raise RuntimeError(
            f"PageIndex JSON is {byte_size} bytes and cannot be stored safely in one "
            "MongoDB document. Upload it to R2 or provide indexFileUrl."
        )
    return {
        "schemaVersion": PAGEINDEX_TREE_SCHEMA_VERSION,
        "producer": producer or detect_pageindex_producer(index_json),
        "producerVersion": producer_version.strip() if producer_version else None,
        "contentHash": hashlib.sha256(encoded).hexdigest(),
        "byteSize": byte_size,
        "rawTree": (
            index_json if byte_size <= MAX_INLINE_PAGEINDEX_TREE_BYTES else None
        ),
    }


def detect_pageindex_producer(value: Any) -> str:
    if _contains_vectify_shape(value):
        return "vectify-pageindex"
    if _contains_internal_shape(value):
        return "internal-md-converter"
    return "unknown"


def _contains_vectify_shape(value: Any) -> bool:
    if isinstance(value, list):
        return any(_contains_vectify_shape(item) for item in value)
    if not isinstance(value, dict):
        return False
    if any(
        name in value
        for name in (
            "structure",
            "node_id",
            "start_index",
            "end_index",
            "line_num",
            "prefix_summary",
        )
    ):
        return True
    children = value.get("nodes") or value.get("children") or value.get("sections") or []
    return isinstance(children, list) and any(
        _contains_vectify_shape(child) for child in children
    )


def _contains_internal_shape(value: Any) -> bool:
    if isinstance(value, list):
        return any(_contains_internal_shape(item) for item in value)
    if not isinstance(value, dict):
        return False
    if any(
        name in value for name in ("nodeId", "children", "root", "tree", "document")
    ):
        return True
    nodes = value.get("nodes")
    return isinstance(nodes, list) and any(
        _contains_internal_shape(child) for child in nodes
    )
