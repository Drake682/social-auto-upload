"""
SQLAlchemy models for the AI Worker Trend Engine.
Matches TypeORM entities in NestJS for shared DB access.
"""

from datetime import datetime
from sqlalchemy import Column, DateTime, Float, Integer, String, Text
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import DeclarativeBase
import enum
import uuid


class Base(DeclarativeBase):
    pass


class TrendPlatform(str, enum.Enum):
    TIKTOK = "tiktok"
    FACEBOOK = "facebook"
    YOUTUBE = "youtube"
    SHOPEE = "shopee"


class TrendType(str, enum.Enum):
    VIDEO = "video"
    AUDIO = "audio"


class Trend(Base):
    __tablename__ = "trends"

    id = Column(Integer, primary_key=True, autoincrement=True)
    tenant_id = Column(Integer, nullable=True, comment="Null for global trends")
    platform = Column(String(20), nullable=False)
    keyword = Column(String(200), nullable=False)
    title = Column(String(500), nullable=True)
    trend_type = Column(String(20), nullable=False, default=TrendType.VIDEO.value)
    volume = Column(Float, nullable=True, comment="Legacy trend volume / search count")
    views = Column(Float, nullable=True, comment="View count from trend provider")
    region = Column(String(100), nullable=True, default="global")
    run_id = Column(PG_UUID(as_uuid=False), nullable=True)
    source_url = Column(String(500), nullable=True)
    extracted_at = Column(
        DateTime, nullable=False, default=datetime.utcnow, comment="When data was scraped"
    )
    crawled_at = Column(DateTime, nullable=True)

    def __repr__(self):
        return f"<Trend(platform={self.platform}, keyword={self.keyword}, type={self.trend_type})>"


class AffiliateProduct(Base):
    __tablename__ = "affiliate_products"

    id = Column(PG_UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid.uuid4()))
    tenant_id = Column(Integer, nullable=False)
    platform = Column(String(20), nullable=False)
    product_url = Column(String(1000), nullable=False)
    product_name = Column(String(500), nullable=False)
    price = Column(Float, nullable=True)
    commission_rate = Column(Float, nullable=True)
    extracted_at = Column(DateTime, nullable=False, default=datetime.utcnow)

    def __repr__(self):
        return f"<AffiliateProduct(platform={self.platform}, name={self.product_name})>"


class VideoJobStatus(str, enum.Enum):
    PENDING = "pending"
    GENERATING_SCRIPT = "generating_script"
    GENERATING_VOICE = "generating_voice"
    RENDERING = "rendering"
    DONE = "done"
    FAILED = "failed"


class VideoJob(Base):
    __tablename__ = "video_jobs"

    id = Column(PG_UUID(as_uuid=False), primary_key=True)
    user_id = Column(Integer, nullable=False)
    tenant_id = Column(Integer, nullable=False)
    topic = Column(String(500), nullable=False)
    status = Column(String(30), nullable=False, default=VideoJobStatus.PENDING.value)
    progress = Column(Integer, nullable=True)
    script = Column(Text, nullable=True, comment="Generated narration script")
    source_s3_uri = Column(String(500), nullable=True, comment="Source media S3 URI")
    audio_url = Column(String(500), nullable=True, comment="Path to TTS audio file")
    video_url = Column(String(500), nullable=True, comment="Path to final rendered video")
    error_log = Column(Text, nullable=True, comment="Error details if status=failed")
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(
        DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow,
    )

    def __repr__(self):
        return f"<VideoJob(id={self.id}, status={self.status})>"
