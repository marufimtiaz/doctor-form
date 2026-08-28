import logging
from functools import lru_cache
from typing import BinaryIO

import boto3
from botocore.client import Config
from botocore.exceptions import ClientError

from app.core.config import get_settings

logger = logging.getLogger(__name__)


def _build_client(endpoint_url: str):
    settings = get_settings()
    return boto3.client(
        "s3",
        endpoint_url=endpoint_url,
        aws_access_key_id=settings.s3_access_key,
        aws_secret_access_key=settings.s3_secret_key,
        region_name=settings.s3_region,
        config=Config(
            signature_version="s3v4",
            s3={"addressing_style": "path" if settings.s3_use_path_style else "virtual"},
            retries={"max_attempts": 3, "mode": "standard"},
            # Fail fast when storage is down so /readyz stays responsive.
            connect_timeout=3,
            read_timeout=10,
        ),
    )


@lru_cache
def get_s3_client():
    """Client for server-side calls, over the internal network."""
    return _build_client(get_settings().s3_endpoint_url)


@lru_cache
def get_presign_client():
    """Client used only to sign URLs the browser will open directly."""
    return _build_client(get_settings().presign_endpoint_url)


def ensure_bucket() -> None:
    """Create the bucket on first boot. Safe to call repeatedly."""
    settings = get_settings()
    client = get_s3_client()
    try:
        client.head_bucket(Bucket=settings.s3_bucket)
    except ClientError as exc:
        code = exc.response.get("Error", {}).get("Code")
        if code not in ("404", "NoSuchBucket", "403"):
            raise
        client.create_bucket(Bucket=settings.s3_bucket)
        logger.info("created bucket %s", settings.s3_bucket)


def upload_fileobj(fileobj: BinaryIO, key: str, content_type: str | None = None) -> str:
    settings = get_settings()
    extra = {"ContentType": content_type} if content_type else {}
    get_s3_client().upload_fileobj(fileobj, settings.s3_bucket, key, ExtraArgs=extra)
    return key


def presigned_get_url(key: str) -> str:
    settings = get_settings()
    return get_presign_client().generate_presigned_url(
        "get_object",
        Params={"Bucket": settings.s3_bucket, "Key": key},
        ExpiresIn=settings.presign_expiry_seconds,
    )


def delete_object(key: str) -> None:
    settings = get_settings()
    get_s3_client().delete_object(Bucket=settings.s3_bucket, Key=key)


def sniff_image_type(data: bytes, fallback: str | None = None) -> str:
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if data.startswith(b"RIFF") and len(data) >= 12 and data[8:12] == b"WEBP":
        return "image/webp"
    if data.startswith(b"GIF87a") or data.startswith(b"GIF89a"):
        return "image/gif"

    if fallback and fallback != "application/octet-stream":
        return fallback
    return "image/jpeg"


def download_object(key: str) -> tuple[bytes, str]:
    """Fetch an object's bytes and its stored content type.

    The OCR runner needs the image itself, not a link: OpenRouter fetches
    images from its own servers, and a presigned URL here points at an
    address only this network can reach.
    """
    settings = get_settings()
    resp = get_s3_client().get_object(Bucket=settings.s3_bucket, Key=key)
    raw_type = resp.get("ContentType") or "application/octet-stream"
    content = resp["Body"].read()
    content_type = sniff_image_type(content, raw_type)
    return content, content_type
