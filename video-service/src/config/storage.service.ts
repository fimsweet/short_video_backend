import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
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
      console.log('AWS S3 Storage enabled');
      console.log(`   Bucket: ${this.bucket}`);
      console.log(`   Region: ${this.region}`);
      if (this.cloudfrontUrl) {
        console.log(`   CloudFront: ${this.cloudfrontUrl}`);
      }
    } else {
      console.log('AWS S3 not configured, using local file storage');
    }
  }

  isEnabled(): boolean {
    return this.isS3Enabled;
  }

  /**
   * Upload a file to S3 or local storage
   * @param filePath Local file path
   * @param s3Key S3 key (path in bucket)
   * @param contentType MIME type
   * @returns Upload result with URL
   */
  async uploadFile(
    filePath: string,
    s3Key: string,
    contentType?: string,
  ): Promise<UploadResult> {
    if (!this.isS3Enabled || !this.s3Client) {
      // Local storage fallback - return local path
      return {
        key: s3Key,
        url: `/uploads/${s3Key}`,
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
        partSize: 5 * 1024 * 1024, // 5MB parts
      });

      upload.on('httpUploadProgress', (progress) => {
        const percent = ((progress.loaded || 0) / (progress.total || 1) * 100).toFixed(2);
        console.log(`Uploading ${s3Key}: ${percent}%`);
      });

      await upload.done();
    } else {
      // Simple upload for small files
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
    console.log(`Uploaded to S3: ${s3Key}`);

    return {
      key: s3Key,
      url,
      bucket: this.bucket,
    };
  }

  /**
   * Upload a buffer directly to S3
   */
  async uploadBuffer(
    buffer: Buffer,
    s3Key: string,
    contentType: string,
  ): Promise<UploadResult> {
    if (!this.isS3Enabled || !this.s3Client) {
      throw new Error('S3 not enabled');
    }

    await this.s3Client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: s3Key,
        Body: buffer,
        ContentType: contentType,
      }),
    );

    return {
      key: s3Key,
      url: this.getPublicUrl(s3Key),
      bucket: this.bucket,
    };
  }

  /**
   * Upload entire directory to S3 (for HLS segments)
   */
  async uploadDirectory(
    localDir: string,
    s3Prefix: string,
  ): Promise<UploadResult[]> {
    const results: UploadResult[] = [];
    const files = fs.readdirSync(localDir);

    for (const file of files) {
      const filePath = path.join(localDir, file);
      const stats = fs.statSync(filePath);

      if (stats.isFile()) {
        const s3Key = `${s3Prefix}/${file}`;
        const result = await this.uploadFile(filePath, s3Key);
        results.push(result);
      }
    }

    console.log(`Uploaded directory: ${results.length} files to ${s3Prefix}`);
    return results;
  }

  /**
   * Delete a file from S3
   */
  async deleteFile(s3Key: string): Promise<void> {
    if (!this.isS3Enabled || !this.s3Client) {
      return;
    }

    await this.s3Client.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: s3Key,
      }),
    );
    console.log(`Deleted from S3: ${s3Key}`);
  }

  /**
   * Delete all files with a prefix (for deleting video folder)
   */
  async deleteDirectory(s3Prefix: string): Promise<void> {
    if (!this.isS3Enabled || !this.s3Client) {
      return;
    }

    const listResult = await this.s3Client.send(
      new ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix: s3Prefix,
      }),
    );

    if (listResult.Contents) {
      for (const object of listResult.Contents) {
        if (object.Key) {
          await this.deleteFile(object.Key);
        }
      }
    }
    console.log(`Deleted directory from S3: ${s3Prefix}`);
  }

  /**
   * Check if file exists in S3
   */
  async fileExists(s3Key: string): Promise<boolean> {
    if (!this.isS3Enabled || !this.s3Client) {
      return false;
    }

    try {
      await this.s3Client.send(
        new HeadObjectCommand({
          Bucket: this.bucket,
          Key: s3Key,
        }),
      );
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get public URL for a file (CloudFront or S3)
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
      '.gif': 'image/gif',
      '.webp': 'image/webp',
    };
    return mimeTypes[ext] || 'application/octet-stream';
  }

  /**
   * Get bucket name
   */
  getBucket(): string {
    return this.bucket;
  }

  /**
   * Get CloudFront URL
   */
  getCloudfrontUrl(): string {
    return this.cloudfrontUrl;
  }
}
