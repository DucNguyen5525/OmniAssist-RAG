from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
from typing import Any
from uuid import uuid4

from bson import ObjectId
from botocore.exceptions import ClientError
from dotenv import load_dotenv
from pymongo import MongoClient

from import_pageindex_to_mongo import import_pageindex_to_mongo
from upload_to_r2 import create_r2_client, delete_from_r2, upload_json_to_r2


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Smoke-test PageIndex JSON -> R2 + MongoDB, then clean up."
    )
    parser.add_argument("--index-json", required=True)
    parser.add_argument(
        "--keep",
        action="store_true",
        help="Keep the smoke document and R2 object for manual inspection.",
    )
    return parser.parse_args()


def main() -> None:
    root = Path(__file__).resolve().parents[2]
    load_dotenv(root / ".env")
    args = parse_args()
    index_path = Path(args.index_json).resolve()
    index_json: Any = json.loads(index_path.read_text(encoding="utf-8"))
    slug = f"omniassist-pageindex-smoke-{uuid4().hex[:12]}"
    r2_key = f"pageindex-smoke/{slug}/{index_path.name}"
    mongo_uri = required("MONGODB_URI")
    db_name = os.getenv("MONGODB_DB", "helpdesk_rag")
    client = MongoClient(mongo_uri)
    db = client[db_name]
    document_id: ObjectId | None = None
    uploaded = False
    verification: dict[str, Any] = {}

    try:
        index_file_url = upload_json_to_r2(r2_key, index_json)
        uploaded = True
        result = import_pageindex_to_mongo(
            title="OmniAssist PageIndex ingestion smoke",
            slug=slug,
            tags=["smoke-test", "pageindex"],
            index_json=index_json,
            index_file_url=index_file_url,
            version="smoke-v1",
            producer="vectify-pageindex",
            producer_version="39121c4d3479edeb049fb1e37045f3227bf50355",
        )
        document_id = ObjectId(result["documentId"])
        document = db.documents.find_one({"_id": document_id})
        node_count = db.pageindex_nodes.count_documents({"documentId": document_id})
        content_node_count = db.pageindex_nodes.count_documents(
            {"documentId": document_id, "content": {"$ne": ""}}
        )
        tree = db.pageindex_trees.find_one(
            {"documentId": document_id, "contentHash": result["contentHash"]}
        )
        r2_head = create_r2_client().head_object(
            Bucket=required("R2_BUCKET_NAME"),
            Key=r2_key,
        )

        if document is None or document.get("status") != "ready":
            raise RuntimeError("Smoke document was not persisted as ready.")
        if node_count != result["nodesImported"] or content_node_count == 0:
            raise RuntimeError("Persisted PageIndex nodes failed count/content checks.")
        if tree is None or tree.get("rawTree") is None:
            raise RuntimeError("Immutable raw PageIndex tree was not persisted inline.")
        if not r2_head.get("ContentLength"):
            raise RuntimeError("R2 smoke artifact is empty.")

        verification = {
            "ok": True,
            "slug": slug,
            "documentId": str(document_id),
            "nodesImported": node_count,
            "contentNodes": content_node_count,
            "producer": document.get("producer"),
            "producerVersion": document.get("producerVersion"),
            "contentHash": document.get("contentHash"),
            "rawTreeStoredInline": True,
            "r2Bytes": r2_head["ContentLength"],
            "kept": args.keep,
        }
    finally:
        if not args.keep:
            if document_id is None:
                partial = db.documents.find_one({"slug": slug}, {"_id": 1})
                document_id = partial.get("_id") if partial else None
            if document_id is not None:
                db.pageindex_nodes.delete_many({"documentId": document_id})
                db.pageindex_trees.delete_many({"documentId": document_id})
                db.documents.delete_one({"_id": document_id, "slug": slug})
            if uploaded:
                delete_from_r2(r2_key)
            mongo_removed = db.documents.count_documents({"slug": slug}) == 0
            r2_removed = True
            if uploaded:
                try:
                    create_r2_client().head_object(
                        Bucket=required("R2_BUCKET_NAME"),
                        Key=r2_key,
                    )
                    r2_removed = False
                except ClientError as error:
                    status = error.response.get("ResponseMetadata", {}).get(
                        "HTTPStatusCode"
                    )
                    if status != 404:
                        raise
            if not mongo_removed or not r2_removed:
                raise RuntimeError("Smoke cleanup verification failed.")
            verification["cleanupVerified"] = True
        client.close()

    print(json.dumps(verification, indent=2, default=str))


def required(name: str) -> str:
    value = os.getenv(name)
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


if __name__ == "__main__":
    main()
