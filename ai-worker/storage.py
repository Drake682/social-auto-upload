import os
from urllib.parse import urlparse

import boto3
from botocore.config import Config


S3_ENDPOINT = os.getenv("S3_ENDPOINT", "http://localhost:9000")
S3_REGION = os.getenv("S3_REGION", "us-east-1")
S3_BUCKET = os.getenv("S3_BUCKET", "socialflow-media")
S3_ACCESS_KEY = os.getenv("S3_ACCESS_KEY", "socialflow")
S3_SECRET_KEY = os.getenv("S3_SECRET_KEY", "socialflow_minio_dev")
S3_FORCE_PATH_STYLE = os.getenv("S3_FORCE_PATH_STYLE", "true").lower() == "true"


def _client():
    return boto3.client(
        "s3",
        endpoint_url=S3_ENDPOINT,
        region_name=S3_REGION,
        aws_access_key_id=S3_ACCESS_KEY,
        aws_secret_access_key=S3_SECRET_KEY,
        config=Config(s3={"addressing_style": "path" if S3_FORCE_PATH_STYLE else "auto"}),
    )


def parse_s3_uri(s3_uri: str) -> tuple[str, str]:
    parsed = urlparse(s3_uri)
    if parsed.scheme != "s3" or not parsed.netloc or not parsed.path.strip("/"):
        raise ValueError("Invalid S3 URI")
    return parsed.netloc, parsed.path.lstrip("/")


def assert_tenant_key(s3_uri: str, tenant_id: int) -> tuple[str, str]:
    bucket, key = parse_s3_uri(s3_uri)
    if bucket != S3_BUCKET:
        raise ValueError("S3 bucket mismatch")
    if not key.startswith(f"tenants/{tenant_id}/"):
        raise ValueError("S3 key outside tenant scope")
    return bucket, key


def download_s3_uri(s3_uri: str, tenant_id: int, destination: str) -> None:
    bucket, key = assert_tenant_key(s3_uri, tenant_id)
    _client().download_file(bucket, key, destination)


def upload_file(source: str, key: str, content_type: str) -> str:
    _client().upload_file(
        source,
        S3_BUCKET,
        key,
        ExtraArgs={"ContentType": content_type},
    )
    return f"s3://{S3_BUCKET}/{key}"
