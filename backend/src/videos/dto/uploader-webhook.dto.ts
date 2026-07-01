import { IsIn, IsOptional, IsString } from 'class-validator';

export class UploaderWebhookDto {
  @IsString()
  job_id: string;

  @IsIn(['published', 'failed'])
  status: 'published' | 'failed';

  @IsOptional()
  @IsString()
  published_url?: string | null;

  @IsOptional()
  @IsString()
  error_log?: string | null;
}
