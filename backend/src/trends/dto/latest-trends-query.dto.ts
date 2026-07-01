import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class LatestTrendsQueryDto {
  @IsOptional()
  @IsString()
  platform = 'tiktok';

  @IsOptional()
  @IsString()
  region = 'vn';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 10;
}
