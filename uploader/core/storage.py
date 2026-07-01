import os
import re
import tempfile
from contextlib import contextmanager
from pathlib import Path
from urllib.parse import urlparse

import boto3
from botocore.config import Config

S3_ENDPOINT = os.getenv("S3_ENDPOINT", "http://localhost:9000")
S3_REGION = os.getenv("S3_REGION", "us-east-1")
S3_BUCKET = os.getenv("S3_BUCKET", "socialflow-media")
S3_ACCESS_KEY = os.getenv("S3_ACCESS_KEY", "socialflow")
S3_SECRET_KEY = os.getenv("S3_SECRET_KEY", "socialflow_minio_dev")
S3_FORCE_PATH_STYLE = os.getenv("S3_FORCE_PATH_STYLE", "true").lower() == "true"


def is_s3_uri(value: str | None) -> bool:
    return bool(value and value.startswith("s3://"))


def _client():
    return boto3.client(
        "s3",
        endpoint_url=S3_ENDPOINT,
        region_name=S3_REGION,
        aws_access_key_id=S3_ACCESS_KEY,
        aws_secret_access_key=S3_SECRET_KEY,
        config=Config(s3={"addressing_style": "path" if S3_FORCE_PATH_STYLE else "auto"}),
    )


def _parse_s3_uri(s3_uri: str) -> tuple[str, str]:
    parsed = urlparse(s3_uri)
    if parsed.scheme != "s3" or not parsed.netloc or not parsed.path.strip("/"):
        raise ValueError("Invalid S3 URI")
    return parsed.netloc, parsed.path.lstrip("/")


def _safe_job_id(job_id: str) -> str:
    safe = re.sub(r"[^a-zA-Z0-9_.-]", "_", str(job_id or "job")).strip("._")
    return safe or "job"


def download_s3_uri_to_local(s3_uri: str, job_id: str) -> str:
    """Download an S3/MinIO object to a local temp file and return its absolute path."""
    if not is_s3_uri(s3_uri):
        path = Path(s3_uri).expanduser().resolve()
        if not path.is_file():
            raise FileNotFoundError(f"Local video file not found: {path}")
        return str(path)

    bucket, key = _parse_s3_uri(s3_uri)
    suffix = Path(key).suffix or ".mp4"
    tmp_dir = Path(tempfile.gettempdir()) / "socialflow-uploader"
    tmp_dir.mkdir(parents=True, exist_ok=True)
    tmp_path = tmp_dir / f"{_safe_job_id(job_id)}{suffix}"

    if tmp_path.exists():
        tmp_path.unlink()

    _client().download_file(bucket, key, str(tmp_path))
    return str(tmp_path.resolve())


@contextmanager
def local_video_file(video_url: str, tenant_id: int):
    if not is_s3_uri(video_url):
        yield video_url
        return

    bucket, key = _parse_s3_uri(video_url)
    if bucket != S3_BUCKET:
        raise ValueError("S3 bucket mismatch")
    if not key.startswith(f"tenants/{tenant_id}/"):
        raise ValueError("S3 key outside tenant scope")

    suffix = Path(key).suffix or ".mp4"
    tmp = tempfile.NamedTemporaryFile(prefix="socialflow-upload-", suffix=suffix, delete=False)
    tmp_path = tmp.name
    tmp.close()
    try:
        _client().download_file(bucket, key, tmp_path)
        yield tmp_path
    finally:
        try:
            os.unlink(tmp_path)
        except FileNotFoundError:
            pass
