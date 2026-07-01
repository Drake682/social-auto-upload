import { Body, Controller, HttpCode, HttpStatus, Logger, Post } from "@nestjs/common";
import { Public } from "../common/decorators/public.decorator";
import { UploaderWebhookDto } from "../videos/dto/uploader-webhook.dto";
import { VideosService } from "../videos/videos.service";

@Controller("v1/webhooks")
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);

  constructor(private readonly videosService: VideosService) {}

  @Public()
  @Post("uploader")
  @HttpCode(HttpStatus.OK)
  async handleUploaderWebhook(@Body() body: UploaderWebhookDto) {
    this.logger.log(`Received uploader webhook job_id=${body.job_id} status=${body.status}`);
    const job = await this.videosService.handleUploaderWebhook(body);
    return {
      status: "ok",
      job_id: job.id,
      video_status: job.status,
    };
  }
}
