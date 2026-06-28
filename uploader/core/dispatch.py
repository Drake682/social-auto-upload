import logging
import os
import threading
import time
from threading import BoundedSemaphore
from typing import Any, Dict, List, Optional, Tuple

import requests
from flask import Blueprint, jsonify, request

from uploader.core.browser_manager import redact_sensitive, reset_browser_log_context, set_browser_log_context
from uploader.core.storage import download_s3_uri_to_local, is_s3_uri
from uploader.platforms.facebook import FacebookPlaywrightUploader, FacebookUploadError

logger = logging.getLogger(__name__)

uploader_dispatch_bp = Blueprint("uploader_dispatch", __name__, url_prefix="/uploader")

REQUIRED_FIELDS = ("job_id", "tenant_id", "platform", "video_url")
DEFAULT_WEBHOOK_URL = "http://localhost:3000/v1/webhooks/uploader"
REQUEST_TIMEOUT_SECONDS = 10
MAX_DISPATCH_THREADS = int(os.getenv("UPLOADER_MAX_DISPATCH_THREADS", "3"))
_dispatch_semaphore = BoundedSemaphore(MAX_DISPATCH_THREADS)
_active_jobs: set[str] = set()
_active_jobs_lock = threading.Lock()


def _get_webhook_url() -> str:
    return os.getenv("NESTJS_WEBHOOK_URL", DEFAULT_WEBHOOK_URL).strip()


def _validate_dispatch_payload(payload: Any) -> Tuple[Optional[Dict[str, Any]], List[str]]:
    if not isinstance(payload, dict):
        return None, ["JSON body must be an object"]

    errors: List[str] = []
    for field in REQUIRED_FIELDS:
        value = payload.get(field)
        if value is None or value == "":
            errors.append(f"{field} is required")

    job_id = payload.get("job_id")
    platform = payload.get("platform")
    video_url = payload.get("video_url")
    tenant_id = payload.get("tenant_id")
    user_id = payload.get("user_id")

    if job_id is not None and not isinstance(job_id, str):
        errors.append("job_id must be a string")
    if platform is not None and not isinstance(platform, str):
        errors.append("platform must be a string")
    if video_url is not None and not isinstance(video_url, str):
        errors.append("video_url must be a string")
    if tenant_id is not None and not isinstance(tenant_id, int):
        errors.append("tenant_id must be an integer")
    if user_id is not None and user_id != "" and not isinstance(user_id, int):
        errors.append("user_id must be an integer")

    if errors:
        return None, errors

    normalized = {
        "job_id": job_id.strip(),
        "tenant_id": tenant_id,
        "user_id": user_id,
        "platform": platform.strip().lower(),
        "video_url": video_url.strip(),
        "caption": payload.get("caption") or "",
        "proxy": payload.get("proxy") or "",
        "account_cookie": payload.get("account_cookie") or "",
        "page_url": payload.get("page_url") or os.getenv("FACEBOOK_UPLOAD_URL") or "",
    }
    return normalized, []


def _post_webhook(callback_payload: Dict[str, Any]) -> None:
    webhook_url = _get_webhook_url()
    job_id = callback_payload.get("job_id")

    if not webhook_url:
        logger.warning("Uploader webhook skipped job_id=%s reason=missing_url", job_id)
        return

    try:
        logger.info(
            "Posting uploader webhook job_id=%s url=%s status=%s",
            job_id,
            webhook_url,
            callback_payload.get("status"),
        )
        response = requests.post(webhook_url, json=callback_payload, timeout=REQUEST_TIMEOUT_SECONDS)
        if 200 <= response.status_code < 300:
            logger.info("Uploader webhook acknowledged job_id=%s status_code=%s", job_id, response.status_code)
            return

        logger.warning(
            "Uploader webhook returned non-2xx job_id=%s status_code=%s body=%s",
            job_id,
            response.status_code,
            redact_sensitive(response.text[:1000]),
        )
    except requests.exceptions.RequestException as exc:
        logger.warning("Uploader webhook request failed job_id=%s error=%s", job_id, redact_sensitive(exc), exc_info=True)
    except Exception as exc:
        logger.warning("Uploader webhook unexpected failure job_id=%s error=%s", job_id, redact_sensitive(exc), exc_info=True)


def _execute_facebook_dispatch(payload: Dict[str, Any], local_video_path: str) -> Dict[str, Any]:
    job_id = payload["job_id"]
    uploader = FacebookPlaywrightUploader(
        account_cookie=payload.get("account_cookie"),
        proxy_url=payload.get("proxy") or None,
        account_id=f"tenant_{payload.get('tenant_id')}_user_{payload.get('user_id')}_job_{job_id}",
        page_url=payload.get("page_url") or None,
        tenant_id=payload.get("tenant_id"),
        platform=payload.get("platform") or "facebook",
    )
    result = uploader.publish_video(
        video_path=local_video_path,
        caption=payload.get("caption") or "",
        job_id=job_id,
    )
    return {
        "job_id": job_id,
        "status": result.status,
        "published_url": result.published_url,
        "error_log": None,
    }


def _run_dispatch_job(payload: Dict[str, Any]) -> None:
    job_id = str(payload.get("job_id") or "unknown")
    tenant_id = payload.get("tenant_id")
    platform = str(payload.get("platform") or "").lower()
    log_token = set_browser_log_context(job_id=job_id, tenant_id=tenant_id, platform=platform or "-")
    local_video_path: str | None = None
    remove_local_video = False
    callback_payload: Dict[str, Any]

    try:
        if platform != "facebook":
            raise ValueError(f"Unsupported dispatch platform: {platform}")

        video_url = payload.get("video_url")
        if not isinstance(video_url, str) or not video_url.strip():
            raise ValueError("video_url is required")

        remove_local_video = is_s3_uri(video_url)
        logger.info("Downloading dispatch video job_id=%s video_url=%s", job_id, video_url)
        local_video_path = download_s3_uri_to_local(video_url, job_id)
        logger.info("Dispatch video ready job_id=%s local_video_path=%s", job_id, local_video_path)

        callback_payload = _execute_facebook_dispatch(payload, local_video_path)
    except FacebookUploadError as exc:
        logger.error("Facebook upload failed job_id=%s error=%s", job_id, redact_sensitive(exc), exc_info=True)
        callback_payload = {
            "job_id": job_id,
            "status": "failed",
            "published_url": None,
            "error_log": redact_sensitive(exc),
        }
    except Exception as exc:
        logger.error("Uploader worker failed job_id=%s error=%s", job_id, redact_sensitive(exc), exc_info=True)
        callback_payload = {
            "job_id": job_id,
            "status": "failed",
            "published_url": None,
            "error_log": redact_sensitive(exc),
        }
    finally:
        try:
            if remove_local_video and local_video_path and os.path.exists(local_video_path):
                os.remove(local_video_path)
                logger.info("Removed temporary dispatch video job_id=%s path=%s", job_id, local_video_path)
        except Exception as cleanup_exc:
            logger.warning(
                "Temporary video cleanup failed job_id=%s path=%s error=%s",
                job_id,
                local_video_path,
                redact_sensitive(cleanup_exc),
            )

    try:
        _post_webhook(callback_payload)
    except Exception as exc:
        logger.warning("Webhook wrapper failed but worker will continue job_id=%s error=%s", job_id, redact_sensitive(exc), exc_info=True)
    finally:
        reset_browser_log_context(log_token)


def _thread_entry(payload: Dict[str, Any]) -> None:
    try:
        _run_dispatch_job(payload)
    except Exception as exc:
        logger.error("Dispatch thread crashed unexpectedly error=%s payload_job_id=%s", redact_sensitive(exc), payload.get("job_id"), exc_info=True)
        try:
            _post_webhook({
                "job_id": str(payload.get("job_id") or "unknown"),
                "status": "failed",
                "published_url": None,
                "error_log": f"Dispatch thread crashed unexpectedly: {redact_sensitive(exc)}",
            })
        except Exception:
            logger.warning("Failed to post crash webhook", exc_info=True)
    finally:
        job_id = str(payload.get("job_id") or "unknown")
        with _active_jobs_lock:
            _active_jobs.discard(job_id)
        try:
            _dispatch_semaphore.release()
        except ValueError:
            logger.warning("Dispatch semaphore release skipped because it was not acquired")


@uploader_dispatch_bp.route("/dispatch", methods=["POST"])
def dispatch_upload_job():
    started_at = time.perf_counter()
    try:
        if not request.is_json:
            return jsonify({
                "status": "failed",
                "error": "Request must be JSON",
                "job_id": None,
            }), 400

        payload_raw = request.get_json(silent=True)
        if payload_raw is None:
            return jsonify({
                "status": "failed",
                "error": "Invalid or empty JSON body",
                "job_id": None,
            }), 400

        payload, errors = _validate_dispatch_payload(payload_raw)
        if errors:
            logger.warning("Rejected uploader dispatch payload errors=%s", errors)
            return jsonify({
                "status": "rejected",
                "errors": errors,
                "job_id": payload_raw.get("job_id") if isinstance(payload_raw, dict) else None,
            }), 400

        assert payload is not None
        job_id = payload["job_id"]

        with _active_jobs_lock:
            if job_id in _active_jobs:
                logger.warning("Duplicate dispatch rejected job_id=%s", job_id)
                return jsonify({
                    "status": "conflict",
                    "job_id": job_id,
                    "error": "Job is already being processed",
                }), 409
            _active_jobs.add(job_id)

        if not _dispatch_semaphore.acquire(blocking=False):
            with _active_jobs_lock:
                _active_jobs.discard(job_id)
            logger.warning("Dispatch queue saturated job_id=%s max_threads=%s", job_id, MAX_DISPATCH_THREADS)
            return jsonify({
                "status": "busy",
                "job_id": job_id,
                "error": "Uploader is at capacity; retry later",
                "max_threads": MAX_DISPATCH_THREADS,
            }), 429

        try:
            thread = threading.Thread(target=_thread_entry, args=(payload,), daemon=True, name=f"uploader-dispatch-{job_id}")
            thread.start()
        except Exception as thread_exc:
            with _active_jobs_lock:
                _active_jobs.discard(job_id)
            try:
                _dispatch_semaphore.release()
            except ValueError:
                pass
            logger.error("Failed to start dispatch thread job_id=%s error=%s", job_id, redact_sensitive(thread_exc), exc_info=True)
            return jsonify({
                "status": "failed",
                "job_id": job_id,
                "error": f"Failed to start dispatch worker: {redact_sensitive(thread_exc)}",
            }), 500

        elapsed_ms = round((time.perf_counter() - started_at) * 1000, 2)
        logger.info("Queued uploader dispatch job_id=%s elapsed_ms=%s", job_id, elapsed_ms)
        return jsonify({
            "status": "queued",
            "job_id": job_id,
            "elapsed_ms": elapsed_ms,
        }), 202
    except Exception as exc:
        logger.error("Unhandled dispatch endpoint error=%s", redact_sensitive(exc), exc_info=True)
        return jsonify({
            "status": "failed",
            "job_id": None,
            "error": redact_sensitive(exc),
        }), 500
