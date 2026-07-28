from __future__ import annotations

import argparse
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from bson import ObjectId, json_util
from dotenv import load_dotenv
from pymongo import MongoClient

from legacy_tree_reconstruction import reconstruct_pageindex_tree
from pageindex_artifact import build_pageindex_artifact
from upload_to_r2 import create_r2_client, upload_json_to_r2


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Backfill raw-tree/provenance metadata for a legacy PageIndex document "
            "without replacing its retrieval nodes."
        )
    )
    parser.add_argument("--slug", required=True)
    parser.add_argument(
        "--producer",
        choices=["internal-md-converter", "vectify-pageindex", "unknown"],
        default="internal-md-converter",
    )
    parser.add_argument("--producer-version")
    parser.add_argument("--version", default="legacy-backfill-v1")
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Create backups and commit the migration. Default is read-only dry-run.",
    )
    parser.add_argument("--report")
    return parser.parse_args()


def main() -> None:
    root = Path(__file__).resolve().parents[2]
    load_dotenv(root / ".env")
    args = parse_args()
    client = MongoClient(required("MONGODB_URI"), serverSelectionTimeoutMS=10_000)
    db = client[os.getenv("MONGODB_DB", "helpdesk_rag")]
    document = db.documents.find_one({"slug": args.slug})
    if document is None:
        raise RuntimeError(f"Legacy document not found: {args.slug}")

    existing_trees = list(db.pageindex_trees.find({"documentId": document["_id"]}))
    if document.get("contentHash") and existing_trees:
        print(
            json.dumps(
                {
                    "ok": True,
                    "mode": "noop",
                    "slug": args.slug,
                    "reason": "Document already has contentHash and raw-tree version.",
                    "contentHash": document["contentHash"],
                    "treeVersions": len(existing_trees),
                },
                indent=2,
            )
        )
        client.close()
        return

    nodes = list(
        db.pageindex_nodes.find({"documentId": document["_id"]}).sort(
            [("level", 1), ("nodeId", 1)]
        )
    )
    original_node_ids = {str(node["nodeId"]) for node in nodes}
    content_node_count = sum(bool(str(node.get("content") or "").strip()) for node in nodes)
    tree = reconstruct_pageindex_tree(document, nodes)
    artifact = build_pageindex_artifact(
        tree,
        producer=args.producer,
        producer_version=args.producer_version,
        external_artifact_available=True,
    )
    plan = {
        "ok": True,
        "mode": "apply" if args.apply else "dry-run",
        "slug": args.slug,
        "documentId": str(document["_id"]),
        "nodesPreserved": len(nodes),
        "contentNodesPreserved": content_node_count,
        "rootNodes": len(tree["document"]["nodes"]),
        "schemaVersion": artifact["schemaVersion"],
        "producer": artifact["producer"],
        "producerVersion": artifact["producerVersion"],
        "contentHash": artifact["contentHash"],
        "byteSize": artifact["byteSize"],
        "rawTreeStoredInline": artifact["rawTree"] is not None,
    }
    if not args.apply:
        print(json.dumps(plan, indent=2))
        client.close()
        return

    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    backup_directory = root / ".backups" / "pageindex-migrations"
    backup_directory.mkdir(parents=True, exist_ok=True)
    backup_path = backup_directory / f"{args.slug}-{timestamp}-pre-migration.json"
    backup_payload = {
        "migration": {
            "slug": args.slug,
            "createdAt": datetime.now(timezone.utc),
            "purpose": "pre-legacy-pageindex-provenance-backfill",
        },
        "document": document,
        "nodes": nodes,
        "trees": existing_trees,
    }
    backup_path.write_text(
        json_util.dumps(backup_payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    portable_backup = json.loads(json_util.dumps(backup_payload))
    backup_key = (
        f"migration-backups/pageindex/{args.slug}/"
        f"{timestamp}-pre-migration.json"
    )
    tree_key = (
        f"pageindex/{args.slug}/"
        f"{timestamp}-reconstructed-from-legacy-nodes.json"
    )
    backup_url = upload_json_to_r2(backup_key, portable_backup)
    tree_url = upload_json_to_r2(tree_key, tree)

    now = datetime.now(timezone.utc)
    tree_record: dict[str, Any] = {
        "_id": ObjectId(),
        "documentId": document["_id"],
        "schemaVersion": artifact["schemaVersion"],
        "producer": artifact["producer"],
        "contentHash": artifact["contentHash"],
        "byteSize": artifact["byteSize"],
        "nodeCount": len(nodes),
        "indexFileUrl": tree_url,
        "rawTree": artifact["rawTree"],
        "createdAt": now,
    }
    document_fields: dict[str, Any] = {
        "indexSchemaVersion": artifact["schemaVersion"],
        "producer": artifact["producer"],
        "contentHash": artifact["contentHash"],
        "indexFileUrl": tree_url,
        "version": args.version,
        "updatedAt": now,
    }
    if artifact["producerVersion"]:
        tree_record["producerVersion"] = artifact["producerVersion"]
        document_fields["producerVersion"] = artifact["producerVersion"]

    with client.start_session() as session:
        with session.start_transaction():
            db.pageindex_trees.update_one(
                {
                    "documentId": document["_id"],
                    "contentHash": artifact["contentHash"],
                },
                {"$setOnInsert": tree_record},
                upsert=True,
                session=session,
            )
            update_result = db.documents.update_one(
                {
                    "_id": document["_id"],
                    "$or": [
                        {"contentHash": {"$exists": False}},
                        {"contentHash": None},
                    ],
                },
                {"$set": document_fields},
                session=session,
            )
            if update_result.matched_count != 1:
                raise RuntimeError(
                    "Legacy document changed concurrently; transaction was aborted."
                )

    migrated_document = db.documents.find_one({"_id": document["_id"]})
    migrated_tree = db.pageindex_trees.find_one(
        {
            "documentId": document["_id"],
            "contentHash": artifact["contentHash"],
        }
    )
    migrated_node_ids = {
        str(row["nodeId"])
        for row in db.pageindex_nodes.find(
            {"documentId": document["_id"]},
            {"nodeId": 1},
        )
    }
    r2 = create_r2_client()
    bucket = required("R2_BUCKET_NAME")
    backup_head = r2.head_object(Bucket=bucket, Key=backup_key)
    tree_head = r2.head_object(Bucket=bucket, Key=tree_key)
    if migrated_document is None or migrated_tree is None:
        raise RuntimeError("Migration commit could not be read back.")
    if migrated_document.get("contentHash") != artifact["contentHash"]:
        raise RuntimeError("Document contentHash verification failed.")
    if migrated_node_ids != original_node_ids:
        raise RuntimeError("Migration changed the legacy retrieval node IDs.")
    if migrated_tree.get("nodeCount") != len(nodes):
        raise RuntimeError("Raw-tree node count verification failed.")

    report = {
        **plan,
        "mode": "applied",
        "version": args.version,
        "localBackup": str(backup_path.relative_to(root)).replace("\\", "/"),
        "r2BackupUrl": backup_url,
        "indexFileUrl": tree_url,
        "r2BackupBytes": backup_head["ContentLength"],
        "r2TreeBytes": tree_head["ContentLength"],
        "nodeIdsUnchanged": True,
        "treeVersions": db.pageindex_trees.count_documents(
            {"documentId": document["_id"]}
        ),
        "verifiedAt": datetime.now(timezone.utc).isoformat(),
    }
    report_path = Path(
        args.report
        or root
        / "evals"
        / "results"
        / f"legacy-pageindex-migration-{args.slug}.json"
    ).resolve()
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(
        json.dumps(report, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(json.dumps({**report, "report": str(report_path)}, indent=2))
    client.close()


def required(name: str) -> str:
    value = os.getenv(name)
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


if __name__ == "__main__":
    main()
