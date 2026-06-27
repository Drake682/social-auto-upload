import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'crypto';

const PRESIGN_EXPIRES_SECONDS = 900;

@Injectable()
export class StorageService {
  private readonly bucket: string;
  private readonly client: S3Client;

  constructor(configService: ConfigService) {
    this.bucket = configService.get<string>('S3_BUCKET') || 'socialflow-media';
    this.client = new S3Client({
      endpoint: configService.get<string>('S3_PUBLIC_ENDPOINT') || configService.get<string>('S3_ENDPOINT') || 'http://localhost:9000',
      region: configService.get<string>('S3_REGION') || 'us-east-1',
      credentials: {
        accessKeyId: configService.get<string>('S3_ACCESS_KEY') || 'socialflow',
        secretAccessKey: configService.get<string>('S3_SECRET_KEY') || 'socialflow_minio_dev',
      },
      forcePathStyle: (configService.get<string>('S3_FORCE_PATH_STYLE') || 'true') === 'true',
    });
  }

  async presignUpload(userId: number, tenantId: number, contentType: string, fileName?: string) {
    if (!contentType || (!contentType.startsWith('video/') && !contentType.startsWith('audio/'))) {
      throw new BadRequestException('contentType must be video/* or audio/*');
    }

    const safeName = this.safeFileName(fileName || 'media.bin');
    const key = `tenants/${tenantId}/users/${userId}/uploads/${randomUUID()}-${safeName}`;
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: contentType,
    });

    return {
      key,
      s3Uri: `s3://${this.bucket}/${key}`,
      uploadUrl: await getSignedUrl(this.client, command, { expiresIn: PRESIGN_EXPIRES_SECONDS }),
      expiresIn: PRESIGN_EXPIRES_SECONDS,
    };
  }

  async presignDownload(tenantId: number, s3Uri: string) {
    const { bucket, key } = this.parseS3Uri(s3Uri);
    if (bucket !== this.bucket) {
      throw new BadRequestException('S3 bucket mismatch');
    }
    if (!key.startsWith(`tenants/${tenantId}/`)) {
      throw new ForbiddenException('S3 key outside tenant scope');
    }

    const command = new GetObjectCommand({ Bucket: bucket, Key: key });
    return {
      downloadUrl: await getSignedUrl(this.client, command, { expiresIn: PRESIGN_EXPIRES_SECONDS }),
      expiresIn: PRESIGN_EXPIRES_SECONDS,
    };
  }

  private parseS3Uri(value: string) {
    if (!value?.startsWith('s3://')) {
      throw new BadRequestException('uri must start with s3://');
    }
    const path = value.slice('s3://'.length);
    const slash = path.indexOf('/');
    if (slash <= 0 || slash === path.length - 1) {
      throw new BadRequestException('Invalid S3 URI');
    }
    return {
      bucket: path.slice(0, slash),
      key: path.slice(slash + 1),
    };
  }

  private safeFileName(fileName: string) {
    const safe = fileName.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^_+/, '');
    return safe || 'media.bin';
  }
}
