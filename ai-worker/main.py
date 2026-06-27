"""
SocialFlow AI Worker — Real-time Trend & Affiliate Data Mining Engine.
FastAPI server + APScheduler for periodic trend data collection.
"""

import asyncio
import logging
import os
import tempfile
from contextlib import asynccontextmanager
from datetime import datetime

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.interval import IntervalTrigger
from fastapi import BackgroundTasks, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from database import engine, SessionLocal
from models import AffiliateProduct, Base, Trend, TrendType, VideoJob, VideoJobStatus
from scrapers import ProductScraperAPI, TrendScraperAPI
from storage import download_s3_uri, upload_file
from video_factory.editor_ffmpeg import FFmpegEditor
from video_factory.generator_script import generate_script
from video_factory.generator_voice import generate_voice

# Environment
TREND_INTERVAL_MINUTES = int(os.getenv("TREND_INTERVAL_MINUTES", "120"))
STOCK_VIDEO = os.getenv("STOCK_VIDEO_PATH", "./assets/stock_background.mp4")
CORS_ORIGINS = [
    origin.strip()
    for origin in os.getenv("CORS_ORIGIN", "http://localhost:5173").split(",")
    if origin.strip()
]

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# --- Database init ---
Base.metadata.create_all(bind=engine)
logger.info("AI Worker tables ensured in database")


# --- Data Mining Engine ---
def _persist_trends(items: list[dict], tenant_id: int | None = None) -> int:
    db = SessionLocal()
    try:
        count = 0
        now = datetime.utcnow()
        for item in items:
            keyword = item.get("keyword")
            platform = item.get("platform")
            if not keyword or not platform:
                continue
            trend_type = item.get("trend_type") or TrendType.VIDEO.value
            if trend_type not in {TrendType.VIDEO.value, TrendType.AUDIO.value}:
                trend_type = TrendType.VIDEO.value
            db.add(
                Trend(
                    tenant_id=tenant_id,
                    platform=str(platform)[:20],
                    keyword=str(keyword)[:200],
                    trend_type=trend_type,
                    volume=item.get("volume"),
                    source_url=item.get("source_url"),
                    extracted_at=now,
                )
            )
            count += 1
        db.commit()
        return count
    except Exception as exc:
        db.rollback()
        logger.error("Trend persist failed: %s", exc, exc_info=True)
        raise
    finally:
        db.close()


async def sync_trends(tenant_id: int | None = None) -> dict[str, int]:
    logger.info("Trend sync starting — tenant=%s", tenant_id or "global")
    scraper = TrendScraperAPI()
    tiktok_items, facebook_items = await asyncio.gather(
        scraper.fetch_tiktok_trends(),
        scraper.fetch_facebook_trends(),
    )
    all_items = [*tiktok_items, *facebook_items]
    inserted = _persist_trends(all_items, tenant_id=tenant_id)
    logger.info(
        "Trend sync complete — inserted=%s tiktok=%s facebook=%s tenant=%s",
        inserted,
        len(tiktok_items),
        len(facebook_items),
        tenant_id or "global",
    )
    return {
        "inserted": inserted,
        "tiktok_count": len(tiktok_items),
        "facebook_count": len(facebook_items),
    }


async def scrape_product(url: str, tenant_id: int, platform: str | None = None) -> dict:
    scraper = ProductScraperAPI()
    resolved_platform = platform or scraper.detect_platform(url)
    if resolved_platform == "shopee":
        product = await scraper.fetch_shopee_product(url)
    elif resolved_platform == "tiktok":
        product = await scraper.fetch_tiktok_product(url)
    else:
        raise ValueError("Unsupported product platform; expected shopee or tiktok")

    if not product:
        raise ValueError("Product scrape returned no data")

    db = SessionLocal()
    try:
        row = AffiliateProduct(
            tenant_id=tenant_id,
            platform=product["platform"],
            product_url=product["product_url"],
            product_name=product["product_name"],
            price=product.get("price"),
            commission_rate=product.get("commission_rate"),
            extracted_at=datetime.utcnow(),
        )
        db.add(row)
        db.commit()
        db.refresh(row)
        return {
            "id": str(row.id),
            "tenant_id": row.tenant_id,
            "platform": row.platform,
            "product_url": row.product_url,
            "product_name": row.product_name,
            "price": row.price,
            "commission_rate": row.commission_rate,
            "extracted_at": row.extracted_at.isoformat(),
        }
    except Exception as exc:
        db.rollback()
        logger.error("Product persist failed: %s", exc, exc_info=True)
        raise
    finally:
        db.close()


def crawl_trends_job():
    try:
        asyncio.run(sync_trends())
    except Exception as exc:
        logger.error("Scheduled trend sync failed: %s", exc, exc_info=True)


# --- Scheduler ---
scheduler = BackgroundScheduler(daemon=True)


def start_scheduler():
    trigger = IntervalTrigger(minutes=TREND_INTERVAL_MINUTES)
    scheduler.add_job(
        crawl_trends_job,
        trigger=trigger,
        id="trend_sync_job",
        name="Trend Sync",
        replace_existing=True,
        max_instances=1,
    )
    scheduler.start()
    logger.info("Scheduler started — interval=%smin", TREND_INTERVAL_MINUTES)


def stop_scheduler():
    if scheduler.running:
        scheduler.shutdown(wait=False)
        logger.info("Scheduler stopped")


# --- FastAPI App ---
@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("AI Worker starting — Data Mining Engine Initializing")
    start_scheduler()
    await sync_trends()
    yield
    stop_scheduler()
    logger.info("AI Worker shutting down")


app = FastAPI(title="SocialFlow AI Worker — Data Mining Engine", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class ProductScrapeRequest(BaseModel):
    tenant_id: int
    url: str
    platform: str | None = None


@app.get("/health")
async def health_check():
    return {
        "status": "ok",
        "service": "ai-worker",
        "scheduler_running": scheduler.running,
        "trend_interval_min": TREND_INTERVAL_MINUTES,
        "engine": "real-time-data-mining",
        "timestamp": datetime.utcnow().isoformat(),
    }


@app.get("/")
async def root():
    return {"message": "SocialFlow AI Worker API — Data Mining Engine + Video Factory"}


@app.get("/trends/sync")
async def trigger_trend_sync(tenant_id: int | None = Query(default=None)):
    try:
        result = await sync_trends(tenant_id=tenant_id)
        return {"status": "ok", **result}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/products/scrape")
async def trigger_product_scrape(req: ProductScrapeRequest):
    try:
        product = await scrape_product(req.url, tenant_id=req.tenant_id, platform=req.platform)
        return {"status": "ok", "product": product}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


# --- Video Factory (Phase 4 Part 2) ---

class VideoProcessRequest(BaseModel):
    job_id: str
    topic: str
    user_id: int
    tenant_id: int
    source_s3_uri: str | None = None


def _update_job_status(
    job_id: str,
    user_id: int,
    tenant_id: int,
    status: VideoJobStatus,
    **extra_fields,
) -> None:
    """Update an existing NestJS-owned VideoJob row by UUID within tenant scope."""
    db = SessionLocal()
    try:
        job = (
            db.query(VideoJob)
            .filter(
                VideoJob.id == job_id,
                VideoJob.user_id == user_id,
                VideoJob.tenant_id == tenant_id,
            )
            .first()
        )
        if not job:
            raise ValueError(f"VideoJob {job_id} not found")
        job.status = status.value
        for field, value in extra_fields.items():
            setattr(job, field, value)
        job.updated_at = datetime.utcnow()
        db.commit()
        logger.info("Job %s status -> %s", job_id, status.value)
    except Exception as exc:
        db.rollback()
        logger.error("DB update failed for job %s: %s", job_id, exc)
        raise
    finally:
        db.close()


def _process_video(
    job_id: str,
    topic: str,
    user_id: int,
    tenant_id: int,
    source_s3_uri: str | None,
) -> None:
    """Background task: render in temp storage, then upload final media to S3."""
    logger.info("Pipeline start — job=%s tenant=%s topic=%s", job_id, tenant_id, topic)

    try:
        with tempfile.TemporaryDirectory(prefix=f"video-{job_id}-") as job_dir:
            # --- Step 1: Generate Script ---
            _update_job_status(job_id, user_id, tenant_id, VideoJobStatus.GENERATING_SCRIPT, topic=topic)
            script_text = generate_script(topic)
            logger.info("Script ready (%d chars): %.80s...", len(script_text), script_text)

            # --- Step 2: Text-to-Speech ---
            _update_job_status(job_id, user_id, tenant_id, VideoJobStatus.GENERATING_VOICE, script=script_text)
            audio_path = os.path.join(job_dir, "narration.mp3")
            asyncio.run(generate_voice(script_text, audio_path))
            logger.info("TTS audio saved: %s", audio_path)

            # --- Step 3: Render — merge audio onto source video ---
            audio_key = f"tenants/{tenant_id}/users/{user_id}/video-jobs/{job_id}/narration.mp3"
            audio_s3_uri = upload_file(audio_path, audio_key, "audio/mpeg")
            _update_job_status(job_id, user_id, tenant_id, VideoJobStatus.RENDERING, audio_url=audio_s3_uri)

            source_path = STOCK_VIDEO
            if source_s3_uri:
                source_path = os.path.join(job_dir, "source.mp4")
                download_s3_uri(source_s3_uri, tenant_id, source_path)

            output_path = os.path.join(job_dir, "final.mp4")
            if os.path.isfile(source_path):
                FFmpegEditor.merge_audio_video(source_path, audio_path, output_path)
                logger.info("Render complete: %s", output_path)
            else:
                logger.warning(
                    "Source video not found at %s — uploading audio-only fallback",
                    source_path,
                )
                output_path = audio_path

            # --- Step 4: Done ---
            content_type = "video/mp4" if output_path.endswith(".mp4") else "audio/mpeg"
            media_key = f"tenants/{tenant_id}/users/{user_id}/video-jobs/{job_id}/final.{ 'mp4' if content_type == 'video/mp4' else 'mp3' }"
            media_s3_uri = upload_file(output_path, media_key, content_type)
            _update_job_status(
                job_id,
                user_id,
                tenant_id,
                VideoJobStatus.DONE,
                video_url=media_s3_uri,
            )
            logger.info("Pipeline complete — job=%s output=%s", job_id, media_s3_uri)

    except Exception as exc:
        logger.error("Pipeline failed — job=%s: %s", job_id, exc, exc_info=True)
        _update_job_status(
            job_id,
            user_id,
            tenant_id,
            VideoJobStatus.FAILED,
            error_log=str(exc),
        )


@app.post("/video/process")
async def process_video(req: VideoProcessRequest, background_tasks: BackgroundTasks):
    logger.info("Received job %s for tenant %s topic %s", req.job_id, req.tenant_id, req.topic)

    try:
        _update_job_status(
            req.job_id,
            req.user_id,
            req.tenant_id,
            VideoJobStatus.PENDING,
            topic=req.topic,
            source_s3_uri=req.source_s3_uri,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    background_tasks.add_task(
        _process_video,
        req.job_id,
        req.topic,
        req.user_id,
        req.tenant_id,
        req.source_s3_uri,
    )
    return {"job_id": req.job_id, "status": "accepted"}


@app.get("/video/status/{job_id}")
async def get_job_status(job_id: str):
    """Check the current status of a video processing job."""
    db = SessionLocal()
    try:
        job = db.query(VideoJob).filter(VideoJob.id == job_id).first()
        if not job:
            return {"error": "Job not found", "job_id": job_id}
        return {
            "job_id": job.id,
            "topic": job.topic,
            "status": job.status,
            "video_url": job.video_url,
            "error_log": job.error_log,
            "created_at": job.created_at.isoformat() if job.created_at else None,
            "updated_at": job.updated_at.isoformat() if job.updated_at else None,
        }
    finally:
        db.close()


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8001, log_level="info")
