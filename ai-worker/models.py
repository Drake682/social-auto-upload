"""
SQLAlchemy models for the AI Worker Trend Engine.
Matches the eventual TypeORM entity in NestJS for shared DB access.
"""

from datetime import datetime
from sqlalchemy import Column, Integer, String, Float, Text, DateTime
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import DeclarativeBase
import enum


class Base(DeclarativeBase):
    pass


class TrendPlatform(str, enum.Enum):
    TIKTOK = "tiktok"
    FACEBOOK = "facebook"
    YOUTUBE = "youtube"


class Trend(Base):
    __tablename__ = "trends"

    id = Column(Integer, primary_key=True, autoincrement=True)
    platform = Column(String(20), nullable=False)
    keyword = Column(String(200), nullable=False)
    volume = Column(Float, nullable=True, comment="Trend volume / search count")
    extracted_at = Column(
        DateTime, nullable=False, default=datetime.utcnow, comment="When data was scraped"
    )

    def __repr__(self):
        return f"<Trend(platform={self.platform}, keyword={self.keyword}, volume={self.volume})>"


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
