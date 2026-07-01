import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { InjectQueue } from "@nestjs/bull";
import { IsNull, LessThanOrEqual, Repository } from "typeorm";
import { Queue } from "bull";
import { VideoJob } from "./entities/video-job.entity";
import { CreateVideoDto } from "./dto/create-video.dto";
import { UploaderWebhookDto } from "./dto/uploader-webhook.dto";
import { VideoStatus } from "./enums/video-status.enum";

@Injectable()
export class VideosService {
  private logger = new Logger(VideosService.name);

  constructor(
    @InjectRepository(VideoJob)
    private videoJobRepo: Repository<VideoJob>,
    @InjectQueue("video_factory_queue")
    private videoQueue: Queue,
  ) {}

  async createVideoJob(dto: CreateVideoDto, userId: number, tenantId: number): Promise<VideoJob> {
    const videoJob = this.videoJobRepo.create({
      topic: dto.topic,
      source_s3_uri: dto.source_s3_uri,
      user_id: userId,
      tenant_id: tenantId,
      status: VideoStatus.QUEUED,
      progress: 0,
    });
    const saved = await this.videoJobRepo.save(videoJob);

    await this.videoQueue.add("generate_video", {
      videoJobId: saved.id,
      userId,
      tenantId,
      horizontalFlip: dto.horizontal_flip ?? false,
      speed: dto.speed ?? 1.0,
      fps: dto.fps,
    });
    this.logger.log(`Video job ${saved.id} queued for tenant ${tenantId} user ${userId}`);

    return saved;
  }

  async getJobStatus(id: string, userId: number, tenantId: number): Promise<VideoJob> {
    const videoJob = await this.videoJobRepo.findOne({
      where: { id, user_id: userId, tenant_id: tenantId },
    });
    if (!videoJob) {
      throw new NotFoundException(`VideoJob ${id} not found`);
    }
    return videoJob;
  }

  async findDueDoneVideoJobs(limit = 20): Promise<VideoJob[]> {
    const now = new Date();
    const [scheduledJobs, unscheduledJobs] = await Promise.all([
      this.videoJobRepo.find({
        where: {
          status: VideoStatus.DONE,
          scheduled_at: LessThanOrEqual(now),
        },
        order: { updated_at: "ASC" },
        take: limit,
      }),
      this.videoJobRepo.find({
        where: {
          status: VideoStatus.DONE,
          scheduled_at: IsNull(),
        },
        order: { updated_at: "ASC" },
        take: limit,
      }),
    ]);

    const uniqueJobs = new Map<string, VideoJob>();
    for (const job of [...scheduledJobs, ...unscheduledJobs]) {
      if (uniqueJobs.size >= limit) {
        break;
      }
      uniqueJobs.set(job.id, job);
    }

    const jobs = Array.from(uniqueJobs.values());
    if (jobs.length > 0) {
      this.logger.log(`Found ${jobs.length} due video job(s) ready for uploader dispatch`);
    }
    return jobs;
  }

  async markPublishing(jobId: string): Promise<VideoJob> {
    const videoJob = await this.videoJobRepo.findOne({ where: { id: jobId } });
    if (!videoJob) {
      throw new NotFoundException(`VideoJob ${jobId} not found`);
    }

    videoJob.status = VideoStatus.PUBLISHING;
    videoJob.error_log = null;
    videoJob.progress = 90;
    const saved = await this.videoJobRepo.save(videoJob);
    this.logger.log(`Video job ${jobId} marked publishing`);
    return saved;
  }

  async handleUploaderWebhook(dto: UploaderWebhookDto): Promise<VideoJob> {
    const videoJob = await this.videoJobRepo.findOne({ where: { id: dto.job_id } });
    if (!videoJob) {
      throw new NotFoundException(`VideoJob ${dto.job_id} not found`);
    }

    if (dto.status === "published") {
      videoJob.status = VideoStatus.PUBLISHED;
      videoJob.published_url = dto.published_url || null;
      videoJob.error_log = null;
      videoJob.progress = 100;
      const saved = await this.videoJobRepo.save(videoJob);
      this.logger.log(`Video job ${dto.job_id} published at ${dto.published_url || "unknown url"}`);
      return saved;
    }

    videoJob.status = VideoStatus.FAILED;
    videoJob.published_url = null;
    videoJob.error_log = dto.error_log || "Uploader reported failure without error_log";
    videoJob.progress = 100;
    const saved = await this.videoJobRepo.save(videoJob);
    this.logger.error(`Video job ${dto.job_id} failed during uploader publish: ${videoJob.error_log}`);
    return saved;
  }
}
