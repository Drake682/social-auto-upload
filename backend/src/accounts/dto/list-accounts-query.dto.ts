import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { Platform } from '../enums/platform.enum';

export class ListAccountsQueryDto {
  @IsOptional()
  @IsEnum(Platform, { message: 'platform must be one of: facebook, youtube, tiktok_vn, tiktok_us, instagram, shopee (legacy: tiktok)' })
  platform?: Platform;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;
}
