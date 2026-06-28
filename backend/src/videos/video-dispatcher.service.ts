import { HttpService } from "@nestjs/axios";
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Cron, CronExpression } from "@nestjs/schedule";
import { firstValueFrom } from "rxjs";
import { VideoJob } from "./entities/video-job.entity";
import { VideosService } from "./videos.service";

interface UploaderDispatchPayload {
  job_id: string;
  tenant_id: number;
  user_id: number;
  platform: string;
  video_url: string;
  caption: string;
  account_cookie: string;
}

const DISPATCH_TIMEOUT_MS = 5000;
const DISPATCH_MAX_ATTEMPTS = 3;
const DISPATCH_BACKOFF_BASE_MS = 500;
const RETRIABLE_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);

@Injectable()
export class VideoDispatcherService {
  private readonly logger = new Logger(VideoDispatcherService.name);
  private readonly uploaderUrl: string;
  private isDispatching = false;

  constructor(
    private readonly videosService: VideosService,
    private readonly httpService: HttpService,
    configService: ConfigService,
  ) {
    this.uploaderUrl = configService.get<string>("FLASK_UPLOADER_URL") || "http://localhost:5409";
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async dispatchDueVideoJobs(): Promise<void> {
    if (this.isDispatching) {
      this.logger.warn("Video dispatcher skipped because previous scan is still running");
      return;
    }

    this.isDispatching = true;
    try {
      const jobs = await this.videosService.findDueDoneVideoJobs();
      if (jobs.length === 0) {
        this.logger.debug("No due video jobs ready for dispatch");
        return;
      }

      for (const job of jobs) {
        await this.dispatchJob(job);
      }
    } catch (error) {
      this.logger.error(`Video dispatcher scan failed: ${error.message}`, error.stack);
    } finally {
      this.isDispatching = false;
    }
  }

  async dispatchJob(job: VideoJob, platform = "facebook"): Promise<void> {
    const payload = this.buildPayload(job, platform);
    const endpoint = `${this.uploaderUrl.replace(/\/$/, "")}/uploader/dispatch`;

    try {
      await this.postDispatchWithRetry(endpoint, payload);
      await this.videosService.markPublishing(job.id);
      this.logger.log(`Video job ${job.id} accepted by Flask uploader and locked as publishing`);
    } catch (error) {
      this.logger.error(`Video job ${job.id} dispatch failed: ${error.message}`, error.stack);
    }
  }

  private async postDispatchWithRetry(endpoint: string, payload: UploaderDispatchPayload): Promise<void> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= DISPATCH_MAX_ATTEMPTS; attempt += 1) {
      try {
        this.logger.log(
          `Dispatching video job ${payload.job_id} to Flask uploader endpoint=${endpoint} attempt=${attempt}/${DISPATCH_MAX_ATTEMPTS}`,
        );
        const response = await firstValueFrom(
          this.httpService.post(endpoint, payload, {
            timeout: DISPATCH_TIMEOUT_MS,
            validateStatus: () => true,
          }),
        );

        if (response.status === 202) {
          return;
        }

        const body = JSON.stringify(response.data);
        const error = new Error(`Flask uploader rejected job ${payload.job_id}: HTTP ${response.status} ${body}`);
        if (!RETRIABLE_STATUS_CODES.has(response.status) || attempt >= DISPATCH_MAX_ATTEMPTS) {
          throw error;
        }

        lastError = error;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (attempt >= DISPATCH_MAX_ATTEMPTS || !this.isRetriableDispatchError(lastError)) {
          throw lastError;
        }
      }

      const delayMs = DISPATCH_BACKOFF_BASE_MS * 2 ** (attempt - 1);
      this.logger.warn(
        `Video job ${payload.job_id} dispatch retry scheduled attempt=${attempt + 1}/${DISPATCH_MAX_ATTEMPTS} delay_ms=${delayMs} reason=${lastError.message}`,
      );
      await this.sleep(delayMs);
    }

    throw lastError || new Error(`Video job ${payload.job_id} dispatch failed without response`);
  }

  private isRetriableDispatchError(error: Error): boolean {
    const statusMatch = error.message.match(/HTTP\s+(\d+)/);
    if (statusMatch) {
      return RETRIABLE_STATUS_CODES.has(Number(statusMatch[1]));
    }
    return true;
  }

  private sleep(delayMs: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  private buildPayload(job: VideoJob, platform: string): UploaderDispatchPayload {
    return {
      job_id: job.id,
      tenant_id: job.tenant_id,
      user_id: job.user_id,
      platform,
      video_url: job.video_url,
      caption: job.topic || "",
      account_cookie: "",
    };
  }
}
