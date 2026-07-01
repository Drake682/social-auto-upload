import { Module } from "@nestjs/common";
import { HttpModule } from "@nestjs/axios";
import { TypeOrmModule } from "@nestjs/typeorm";
import { BullModule } from "@nestjs/bull";
import { VideoJob } from "./entities/video-job.entity";
import { VideosService } from "./videos.service";
import { VideosController } from "./videos.controller";
import { VideoDispatcherService } from "./video-dispatcher.service";
import { VideoProcessor } from "./video.processor";
import { StorageModule } from "../storage/storage.module";

@Module({
  imports: [
    TypeOrmModule.forFeature([VideoJob]),
    BullModule.registerQueue({ name: "video_factory_queue" }),
    HttpModule,
    StorageModule,
  ],
  controllers: [VideosController],
  providers: [VideosService, VideoProcessor, VideoDispatcherService],
  exports: [VideosService],
})
export class VideosModule {}
