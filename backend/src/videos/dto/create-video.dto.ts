import { IsBoolean, IsNotEmpty, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

export class CreateVideoDto {
  @IsString()
  @IsNotEmpty()
  topic: string;

  @IsOptional()
  @IsString()
  source_s3_uri?: string;

  @IsOptional()
  @IsBoolean()
  horizontal_flip?: boolean;

  @IsOptional()
  @IsNumber()
  @Min(0.25)
  @Max(4)
  speed?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(120)
  fps?: number;
}
