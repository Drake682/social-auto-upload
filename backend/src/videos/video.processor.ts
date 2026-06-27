import { Processor, Process } from "@nestjs/bull";
import { Job } from "bull";
import { Logger, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { VideoJob } from "./entities/video-job.entity";
import { VideoStatus } from "./enums/video-status.enum";

const AI_WORKER_URL = process.env.AI_WORKER_URL || "http://fastapi_worker:8001";

type GenerateVideoJobData = {
  videoJobId: string;
  userId: number;
  tenantId: number;
  horizontalFlip?: boolean;
  speed?: number;
  fps?: number;
};

@Processor("video_factory_queue")
export class VideoProcessor {
  private logger = new Logger(VideoProcessor.name);

  constructor(
    @InjectRepository(VideoJob)
    private videoJobRepo: Repository<VideoJob>,
  ) {}

  @Process("generate_video")
  async handleGenerateVideo(job: Job<GenerateVideoJobData>): Promise<void> {
    const { videoJobId, userId, tenantId, horizontalFlip, speed, fps } = job.data;
    this.logger.log(`Starting video generation for job ${videoJobId}`);

    const videoJob = await this.videoJobRepo.findOne({
      where: { id: videoJobId, user_id: userId, tenant_id: tenantId },
    });
    if (!videoJob) {
      this.logger.error(`VideoJob ${videoJobId} not found`);
      throw new NotFoundException(`VideoJob ${videoJobId} not found`);
    }

    try {
      const response = await fetch(`${AI_WORKER_URL}/video/process`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          job_id: videoJobId,
          topic: videoJob.topic,
          user_id: userId,
          tenant_id: tenantId,
          source_s3_uri: videoJob.source_s3_uri,
          horizontal_flip: horizontalFlip ?? false,
          speed: speed ?? 1.0,
          fps,
        }),
      });

      if (!response.ok) {
        const detail = await response.text();
        throw new Error(`AI Worker rejected job: ${response.status} ${detail}`);
      }

      this.logger.log(`[${videoJobId}] Dispatched to AI Worker`);
    } catch (error) {
      this.logger.error(`[${videoJobId}] Failed: ${error.message}`);
      videoJob.status = VideoStatus.FAILED;
      videoJob.error_log = error.message;
      await this.videoJobRepo.save(videoJob);
      throw error;
    }
  }
}
