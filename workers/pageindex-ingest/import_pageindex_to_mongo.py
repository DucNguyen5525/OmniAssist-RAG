from __future__ import annotations

import argparse
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from bson import ObjectId
from dotenv import load_dotenv
from pymongo import MongoClient, ReplaceOne

from flatten_pageindex_tree import flatten_pageindex_tree
from pageindex_artifact import build_pageindex_artifact
from run_pageindex_local import (
    get_pageindex_version,
    resolve_pageindex_dir,
    run_pageindex,
)
from upload_to_r2 import upload_file_to_r2, upload_json_to_r2


def import_pageindex_to_mongo(
    *,
    title: str,
    slug: str,
    tags: list[str],
    index_json: Any,
    source_file_url: str | None = None,
    index_file_url: str | None = None,
    version: str | None = None,
    producer: str | None = None,
    producer_version: str | None = None,
) -> dict[str, Any]:
    nodes = flatten_pageindex_tree(index_json)
    if not nodes:
        raise RuntimeError("No PageIndex nodes found in JSON")
    if not any(str(node.get("content", "")).strip() for node in nodes):
        raise RuntimeError(
            "The PageIndex tree contains no evidence text. "
            "Regenerate it with --if-add-node-text yes."
        )

    artifact = build_pageindex_artifact(
        index_json,
        producer=producer,
        producer_version=producer_version,
        external_artifact_available=bool(index_file_url),
    )
    mongo_uri = _required("MONGODB_URI")
    db_name = os.getenv("MONGODB_DB", "helpdesk_rag")
    client = MongoClient(mongo_uri)
    db = client[db_name]
    now = datetime.now(timezone.utc)

    document = db.documents.find_one({"slug": slug}) or {"createdAt": now}
    document.update({
        "title": title,
        "slug": slug,
        "sourceFileUrl": source_file_url,
        "indexFileUrl": index_file_url,
        "status": "ready",
        "version": version,
        "indexSchemaVersion": artifact["schemaVersion"],
        "producer": artifact["producer"],
        "producerVersion": artifact["producerVersion"],
        "contentHash": artifact["contentHash"],
        "tags": tags,
        "updatedAt": now,
    })
    result = db.documents.replace_one({"slug": slug}, document, upsert=True)
    saved = db.documents.find_one({"slug": slug})
    if saved is None:
        raise RuntimeError("Failed to save document")

    db.pageindex_nodes.delete_many({"documentId": saved["_id"]})
    operations = []
    for node in nodes:
        node_record = {
            **node,
            "documentId": saved["_id"],
            "createdAt": now,
            "updatedAt": now,
        }
        operations.append(ReplaceOne({"documentId": saved["_id"], "nodeId": node["nodeId"]}, node_record, upsert=True))
    if operations:
        db.pageindex_nodes.bulk_write(operations)

    db.pageindex_trees.update_one(
        {
            "documentId": saved["_id"],
            "contentHash": artifact["contentHash"],
        },
        {
            "$setOnInsert": {
                "_id": ObjectId(),
                "documentId": saved["_id"],
                "schemaVersion": artifact["schemaVersion"],
                "producer": artifact["producer"],
                "producerVersion": artifact["producerVersion"],
                "contentHash": artifact["contentHash"],
                "byteSize": artifact["byteSize"],
                "nodeCount": len(nodes),
                "indexFileUrl": index_file_url,
                "rawTree": artifact["rawTree"],
                "createdAt": now,
            }
        },
        upsert=True,
    )

    db.documents.create_index("slug", unique=True)
    db.documents.create_index([("status", 1), ("tags", 1)])
    db.pageindex_nodes.create_index([("documentId", 1), ("nodeId", 1)], unique=True)
    db.pageindex_trees.create_index([("documentId", 1), ("contentHash", 1)], unique=True)
    db.pageindex_trees.create_index([("documentId", 1), ("createdAt", -1)])
    db.messages.create_index([("conversationId", 1), ("createdAt", 1)])

    return {
        "documentId": str(saved["_id"]),
        "nodesImported": len(nodes),
        "matched": result.matched_count,
        "producer": artifact["producer"],
        "producerVersion": artifact["producerVersion"],
        "contentHash": artifact["contentHash"],
        "rawTreeStoredInline": artifact["rawTree"] is not None,
    }


def main() -> None:
    root_env = Path(__file__).resolve().parents[2] / ".env"
    if root_env.exists():
        load_dotenv(root_env)
    else:
        load_dotenv()
    parser = argparse.ArgumentParser(description="Import PageIndex JSON into MongoDB and optionally back it up to R2.")
    parser.add_argument("--source", help="Source PDF/Markdown to process with local PageIndex")
    parser.add_argument("--index-json", help="Existing PageIndex JSON file")
    parser.add_argument("--title", required=True)
    parser.add_argument("--slug", required=True)
    parser.add_argument("--tags", default="")
    parser.add_argument("--version")
    parser.add_argument(
        "--producer",
        choices=["vectify-pageindex", "internal-md-converter", "unknown"],
    )
    parser.add_argument("--producer-version")
    parser.add_argument("--output-dir", default="./output")
    parser.add_argument("--pageindex-dir")
    parser.add_argument("--skip-r2", action="store_true")
    args = parser.parse_args()

    if not args.source and not args.index_json:
        raise RuntimeError("Provide either --source or --index-json")

    source_file_url = None
    producer_version = args.producer_version
    if args.source:
        output_path = Path(args.output_dir) / f"{args.slug}-pageindex.json"
        index_path = run_pageindex(args.source, str(output_path), args.pageindex_dir)
        pageindex_root = resolve_pageindex_dir(args.pageindex_dir)
        producer_version = producer_version or get_pageindex_version(pageindex_root)
        if not args.skip_r2:
            source_file_url = upload_file_to_r2(f"source/{args.slug}/{Path(args.source).name}", args.source)
    else:
        index_path = Path(args.index_json).resolve()

    index_json = json.loads(index_path.read_text(encoding="utf-8"))
    index_file_url = None if args.skip_r2 else upload_json_to_r2(f"pageindex/{args.slug}/{index_path.name}", index_json)
    result = import_pageindex_to_mongo(
        title=args.title,
        slug=args.slug,
        tags=[tag.strip() for tag in args.tags.split(",") if tag.strip()],
        index_json=index_json,
        source_file_url=source_file_url,
        index_file_url=index_file_url,
        version=args.version,
        producer=args.producer,
        producer_version=producer_version,
    )
    print(json.dumps(result, indent=2))


def _required(name: str) -> str:
    value = os.getenv(name)
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


if __name__ == "__main__":
    main()
