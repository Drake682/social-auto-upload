import { IsOptional, IsString, MaxLength } from 'class-validator';

export class ActivateLicenseDto {
  @IsString()
  @MaxLength(255)
  key: string;

  @IsString()
  @MaxLength(255)
  deviceFingerprint: string;

  @IsString()
  @MaxLength(255)
  hwId: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  deviceName?: string;
}
