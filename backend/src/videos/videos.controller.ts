import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from "@nestjs/common";
import { VideosService } from "./videos.service";
import { CreateVideoDto } from "./dto/create-video.dto";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { StorageService } from "../storage/storage.service";

@Controller("videos")
@UseGuards(JwtAuthGuard)
export class VideosController {
  constructor(
    private readonly videosService: VideosService,
    private readonly storageService: StorageService,
  ) {}

  @Post("presign-upload")
  @HttpCode(HttpStatus.CREATED)
  async presignUpload(
    @CurrentUser() user: any,
    @Body() body: { contentType: string; fileName?: string },
  ) {
    const result = await this.storageService.presignUpload(user.sub, user.tenantId, body.contentType, body.fileName);
    return { code: 201, data: result, msg: "Upload URL created" };
  }

  @Get("presign-download")
  async presignDownload(
    @CurrentUser() user: any,
    @Query("uri") uri: string,
  ) {
    const result = await this.storageService.presignDownload(user.tenantId, uri);
    return { code: 200, data: result, msg: "Download URL created" };
  }

  /**
   * POST /videos/generate — Create a video generation job.
   */
  @Post("generate")
  @HttpCode(HttpStatus.CREATED)
  async generate(
    @CurrentUser() user: any,
    @Body() createDto: CreateVideoDto,
  ) {
    const result = await this.videosService.createVideoJob(createDto, user.sub, user.tenantId);
    return { code: 201, data: result, msg: "Video job created" };
  }

  /**
   * GET /videos/:id/status — Get video job status.
   */
  @Get(":id/status")
  async getStatus(
    @CurrentUser() user: any,
    @Param("id") id: string,
  ) {
    const result = await this.videosService.getJobStatus(id, user.sub, user.tenantId);
    return { code: 200, data: result, msg: "Job status retrieved" };
  }
}
