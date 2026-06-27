import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { InjectQueue } from "@nestjs/bull";
import { Repository } from "typeorm";
import { Queue } from "bull";
import { VideoJob } from "./entities/video-job.entity";
import { CreateVideoDto } from "./dto/create-video.dto";
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
}
