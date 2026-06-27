"""
FFmpeg-backed media normalization.

Purpose:
- Strip privacy-sensitive metadata before distribution.
- Normalize video/audio codecs for broad mobile/browser compatibility.
- Apply explicit user-requested creative transforms for owned/authorized media.
"""

import logging
import os
from dataclasses import dataclass

import ffmpeg

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class VideoNormalizationOptions:
    horizontal_flip: bool = False
    speed: float = 1.0
    fps: int | None = None
    crf: int = 23
    preset: str = "medium"


class VideoNormalizer:
    """Normalize user-owned video into privacy-stripped H.264/AAC MP4."""

    def normalize(
        self,
        input_path: str,
        output_path: str,
        *,
        horizontal_flip: bool = False,
        speed: float = 1.0,
        fps: int | None = None,
    ) -> str:
        options = VideoNormalizationOptions(
            horizontal_flip=horizontal_flip,
            speed=self._validate_speed(speed),
            fps=self._validate_fps(fps),
        )
        self._validate_input(input_path)
        os.makedirs(os.path.dirname(output_path), exist_ok=True)

        logger.info(
            "Normalizing video input=%s output=%s hflip=%s speed=%s fps=%s",
            input_path,
            output_path,
            options.horizontal_flip,
            options.speed,
            options.fps,
        )

        try:
            has_audio = self._has_audio_stream(input_path)
            source = ffmpeg.input(input_path)
            video_stream = self._build_video_stream(source.video, options)
            streams = [video_stream]

            if has_audio:
                streams.append(self._build_audio_stream(source.audio, options))

            output_kwargs = {
                "format": "mp4",
                "vcodec": "libx264",
                "pix_fmt": "yuv420p",
                "preset": options.preset,
                "crf": options.crf,
                "movflags": "+faststart",
                "map_metadata": "-1",
            }
            if has_audio:
                output_kwargs.update({"acodec": "aac", "audio_bitrate": "128k"})
            else:
                output_kwargs.update({"an": None})

            (
                ffmpeg
                .output(*streams, output_path, **output_kwargs)
                .overwrite_output()
                .run(capture_stdout=True, capture_stderr=True)
            )
            logger.info("Video normalization complete: %s", output_path)
            return output_path
        except ffmpeg.Error as exc:
            stderr = exc.stderr.decode("utf-8", errors="replace") if exc.stderr else ""
            logger.error("FFmpeg normalization failed: %s", stderr[-4000:], exc_info=True)
            raise RuntimeError(f"FFmpeg normalization failed: {stderr[-1000:]}") from exc

    def strip_metadata(self, input_path: str, output_path: str) -> str:
        return self.normalize(input_path, output_path)

    def hflip(self, input_path: str, output_path: str) -> str:
        return self.normalize(input_path, output_path, horizontal_flip=True)

    def normalize_speed(self, input_path: str, output_path: str, speed: float) -> str:
        return self.normalize(input_path, output_path, speed=speed)

    def _build_video_stream(self, video_stream, options: VideoNormalizationOptions):
        if options.horizontal_flip:
            video_stream = video_stream.hflip()
        if options.speed != 1.0:
            video_stream = video_stream.filter("setpts", f"{1 / options.speed:.8f}*PTS")
        if options.fps:
            video_stream = video_stream.filter("fps", fps=options.fps)
        return video_stream

    def _build_audio_stream(self, audio_stream, options: VideoNormalizationOptions):
        if options.speed == 1.0:
            return audio_stream
        for factor in self._atempo_chain(options.speed):
            audio_stream = audio_stream.filter("atempo", factor)
        return audio_stream

    def _has_audio_stream(self, input_path: str) -> bool:
        try:
            probe = ffmpeg.probe(input_path)
            return any(stream.get("codec_type") == "audio" for stream in probe.get("streams", []))
        except ffmpeg.Error as exc:
            stderr = exc.stderr.decode("utf-8", errors="replace") if exc.stderr else ""
            logger.warning("ffprobe audio detection failed: %s", stderr[-1000:])
            return False

    def _validate_input(self, input_path: str) -> None:
        if not os.path.isfile(input_path):
            raise FileNotFoundError(f"Input video not found: {input_path}")

    def _validate_speed(self, speed: float) -> float:
        try:
            value = float(speed)
        except (TypeError, ValueError) as exc:
            raise ValueError("speed must be numeric") from exc
        if value <= 0:
            raise ValueError("speed must be greater than 0")
        if value < 0.25 or value > 4.0:
            raise ValueError("speed must be between 0.25 and 4.0")
        return value

    def _validate_fps(self, fps: int | None) -> int | None:
        if fps is None:
            return None
        value = int(fps)
        if value < 1 or value > 120:
            raise ValueError("fps must be between 1 and 120")
        return value

    def _atempo_chain(self, speed: float) -> list[float]:
        factors: list[float] = []
        remaining = speed
        while remaining > 2.0:
            factors.append(2.0)
            remaining /= 2.0
        while remaining < 0.5:
            factors.append(0.5)
            remaining /= 0.5
        factors.append(remaining)
        return factors
