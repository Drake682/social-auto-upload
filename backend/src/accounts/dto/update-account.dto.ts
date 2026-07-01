import { IsEnum, IsObject, IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';
import { Platform } from '../enums/platform.enum';

export class UpdateAccountDto {
  @IsOptional()
  @IsEnum(Platform, { message: 'platform must be one of: facebook, youtube, tiktok_vn, tiktok_us, instagram, shopee (legacy: tiktok)' })
  platform?: Platform;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  account_name?: string;

  @IsOptional()
  @IsObject()
  session_data?: Record<string, any>;

  @IsOptional()
  @IsString()
  @IsUrl({ require_tld: false, require_protocol: true }, { message: 'proxy_url must be a valid URL with protocol' })
  @MaxLength(500)
  proxy_url?: string;
}
