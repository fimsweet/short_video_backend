import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import * as fs from 'fs';
import * as path from 'path';

export interface UploadResult {
  key: string;
  url: string;
  bucket: string;
}

@Injectable()
export class StorageService implements OnModuleInit {
  private s3Client: S3Client | null = null;
  private isS3Enabled = false;
  private bucket: string;
  private region: string;
  private cloudfrontUrl: string;

  constructor(private configService: ConfigService) {}

  async onModuleInit() {
    const accessKeyId = this.configService.get<string>('AWS_ACCESS_KEY_ID');
    const secretAccessKey = this.configService.get<string>('AWS_SECRET_ACCESS_KEY');
    this.bucket = this.configService.get<string>('AWS_S3_BUCKET') || '';
    this.region = this.configService.get<string>('AWS_REGION') || 'ap-southeast-1';
    this.cloudfrontUrl = this.configService.get<string>('CLOUDFRONT_URL') || '';

    if (accessKeyId && secretAccessKey && this.bucket) {
      this.s3Client = new S3Client({
        region: this.region,
        credentials: {
          accessKeyId,
          secretAccessKey,
        },
      });
      this.isS3Enabled = true;
      console.log('✅ [Worker] AWS S3 Storage enabled');
      console.log(`   Bucket: ${this.bucket}`);
      console.log(`   Region: ${this.region}`);
    } else {
      console.log('⚠️ [Worker] AWS S3 not configured, using local file storage');
    }
  }

  isEnabled(): boolean {
    return this.isS3Enabled;
  }

  /**
   * Upload a file to S3
   */
  async uploadFile(
    filePath: string,
    s3Key: string,
    contentType?: string,
  ): Promise<UploadResult> {
    if (!this.isS3Enabled || !this.s3Client) {
      // Local storage fallback
      return {
        key: s3Key,
        url: `/uploads/processed_videos/${s3Key}`,
        bucket: 'local',
      };
    }

    const fileStream = fs.createReadStream(filePath);
    const fileSize = fs.statSync(filePath).size;

    // Use multipart upload for large files (> 5MB)
    if (fileSize > 5 * 1024 * 1024) {
      const upload = new Upload({
        client: this.s3Client,
        params: {
          Bucket: this.bucket,
          Key: s3Key,
          Body: fileStream,
          ContentType: contentType || this.getContentType(filePath),
        },
        queueSize: 4,
        partSize: 5 * 1024 * 1024,
      });

      upload.on('httpUploadProgress', (progress) => {
        const percent = ((progress.loaded || 0) / (progress.total || 1) * 100).toFixed(2);
        console.log(`📤 [Worker] Uploading ${s3Key}: ${percent}%`);
      });

      await upload.done();
    } else {
      const fileBuffer = fs.readFileSync(filePath);
      await this.s3Client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: s3Key,
          Body: fileBuffer,
          ContentType: contentType || this.getContentType(filePath),
        }),
      );
    }

    const url = this.getPublicUrl(s3Key);
    console.log(`✅ [Worker] Uploaded to S3: ${s3Key}`);

    return {
      key: s3Key,
      url,
      bucket: this.bucket,
    };
  }

  /**
   * Upload entire processed video directory to S3
   */
  async uploadProcessedVideo(
    localDir: string,
    videoId: string,
  ): Promise<{ hlsUrl: string; thumbnailUrl: string }> {
    const files = fs.readdirSync(localDir);
    const s3Prefix = `videos/${videoId}`;

    let hlsUrl = '';
    let thumbnailUrl = '';

    for (const file of files) {
      const filePath = path.join(localDir, file);
      const stats = fs.statSync(filePath);

      if (stats.isFile()) {
        const s3Key = `${s3Prefix}/${file}`;
        const result = await this.uploadFile(filePath, s3Key);

        if (file === 'playlist.m3u8') {
          hlsUrl = result.url;
        } else if (file === 'thumbnail.jpg') {
          thumbnailUrl = result.url;
        }
      }
    }

    console.log(`✅ [Worker] Uploaded processed video ${videoId} to S3`);

    // If S3 enabled, return CloudFront/S3 URLs
    // Otherwise, return local paths
    if (this.isS3Enabled) {
      return { hlsUrl, thumbnailUrl };
    } else {
      const folderName = path.basename(localDir);
      return {
        hlsUrl: `/uploads/processed_videos/${folderName}/playlist.m3u8`,
        thumbnailUrl: `/uploads/processed_videos/${folderName}/thumbnail.jpg`,
      };
    }
  }

  /**
   * Delete processed video from S3
   */
  async deleteProcessedVideo(videoId: string): Promise<void> {
    if (!this.isS3Enabled || !this.s3Client) {
      return;
    }

    // In production, you'd list and delete all objects with this prefix
    console.log(`🗑️ [Worker] Would delete videos/${videoId}/* from S3`);
  }

  /**
   * Get public URL for a file
   */
  getPublicUrl(s3Key: string): string {
    if (this.cloudfrontUrl) {
      return `${this.cloudfrontUrl}/${s3Key}`;
    }
    return `https://${this.bucket}.s3.${this.region}.amazonaws.com/${s3Key}`;
  }

  /**
   * Get content type from file extension
   */
  private getContentType(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes: Record<string, string> = {
      '.mp4': 'video/mp4',
      '.m3u8': 'application/vnd.apple.mpegurl',
      '.ts': 'video/mp2t',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
    };
    return mimeTypes[ext] || 'application/octet-stream';
  }

  getBucket(): string {
    return this.bucket;
  }

  getCloudfrontUrl(): string {
    return this.cloudfrontUrl;
  }
}
