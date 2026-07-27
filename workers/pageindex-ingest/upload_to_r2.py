from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

import boto3


def create_r2_client():
    return boto3.client(
        "s3",
        endpoint_url=f"https://{_required('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com",
        aws_access_key_id=_required("R2_ACCESS_KEY_ID"),
        aws_secret_access_key=_required("R2_SECRET_ACCESS_KEY"),
        region_name="auto",
    )


def upload_json_to_r2(key: str, payload: Any) -> str:
    bucket = _required("R2_BUCKET_NAME")
    public_base_url = os.getenv("R2_PUBLIC_BASE_URL")

    client = create_r2_client()
    body = json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")
    client.put_object(Bucket=bucket, Key=key, Body=body, ContentType="application/json")

    if public_base_url:
        return f"{public_base_url.rstrip('/')}/{key}"
    return f"r2://{bucket}/{key}"


def upload_file_to_r2(key: str, file_path: str, content_type: str = "application/octet-stream") -> str:
    bucket = _required("R2_BUCKET_NAME")
    public_base_url = os.getenv("R2_PUBLIC_BASE_URL")
    client = create_r2_client()
    client.upload_file(str(Path(file_path).resolve()), bucket, key, ExtraArgs={"ContentType": content_type})
    if public_base_url:
        return f"{public_base_url.rstrip('/')}/{key}"
    return f"r2://{bucket}/{key}"


def delete_from_r2(key: str) -> None:
    create_r2_client().delete_object(Bucket=_required("R2_BUCKET_NAME"), Key=key)


def _required(name: str) -> str:
    value = os.getenv(name)
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value
