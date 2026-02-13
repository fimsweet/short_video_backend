import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
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
      console.log('[Worker] AWS S3 Storage enabled');
      console.log(`   Bucket: ${this.bucket}`);
      console.log(`   Region: ${this.region}`);
    } else {
      console.log('[Worker] AWS S3 not configured, using local file storage');
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
          CacheControl: this.getCacheControl(filePath), // ?? HLS Caching
        },
        queueSize: 4,
        partSize: 5 * 1024 * 1024,
      });

      upload.on('httpUploadProgress', (progress) => {
        const percent = ((progress.loaded || 0) / (progress.total || 1) * 100).toFixed(2);
        console.log(`[UPLOAD] [Worker] Uploading ${s3Key}: ${percent}%`);
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
          CacheControl: this.getCacheControl(filePath), // ?? HLS Caching
        }),
      );
    }

    const url = this.getPublicUrl(s3Key);
    console.log(`[OK] [Worker] Uploaded to S3: ${s3Key}`);

    return {
      key: s3Key,
      url,
      bucket: this.bucket,
    };
  }

  /**
   * Upload entire processed video directory to S3
   * ============================================
   * ?? OPTIMIZED: Parallel Upload for ABR
   * ============================================
   * - Supports ABR subdirectories (720p/, 480p/, 360p/)
   * - Uses Promise.all for parallel uploads
   * - Reduces upload time from 30s ? 5s for typical videos
   * ============================================
   */
  async uploadProcessedVideo(
    localDir: string,
    videoId: string,
  ): Promise<{ hlsUrl: string; thumbnailUrl: string }> {
    const s3Prefix = `videos/${videoId}`;
    
    // Collect all files recursively (including ABR subdirectories)
    const allFiles = this.getAllFilesRecursively(localDir);
    
    console.log(`[UPLOAD] [Worker] Uploading ${allFiles.length} files in parallel...`);
    const startTime = Date.now();

    let hlsUrl = '';
    let thumbnailUrl = '';

    // ============================================
    // BATCHED PARALLEL UPLOAD (concurrency limit)
    // ============================================
    // Upload files in batches of BATCH_SIZE to avoid
    // overwhelming Node.js socket pool (default 50).
    // 266 files all at once causes:
    //   "socket usage at capacity=50 and 148 additional requests are enqueued"
    // Batching to 30 concurrent uploads avoids this issue
    // while still being much faster than sequential upload.
    // ============================================
    const BATCH_SIZE = 30;
    
    // Prepare upload tasks with metadata
    const uploadTasks = allFiles.map((filePath) => {
      const relativePath = path.relative(localDir, filePath).replace(/\\/g, '/');
      const s3Key = `${s3Prefix}/${relativePath}`;
      return { filePath, s3Key, relativePath };
    });

    // Process in batches
    for (let i = 0; i < uploadTasks.length; i += BATCH_SIZE) {
      const batch = uploadTasks.slice(i, i + BATCH_SIZE);
      const batchResults = await Promise.all(
        batch.map(async (task) => {
          const result = await this.uploadFile(task.filePath, task.s3Key);

          // ABR: master.m3u8 is the entry point (not playlist.m3u8)
          if (task.relativePath === 'master.m3u8') {
            hlsUrl = result.url;
          } else if (task.relativePath === 'thumbnail.jpg') {
            thumbnailUrl = result.url;
          }

          return result;
        }),
      );
    }
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`[OK] [Worker] Uploaded ${allFiles.length} files to S3 in ${duration}s (parallel)`);

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
   * Recursively get all files in a directory (including subdirectories)
   * Used for ABR upload where we have 720p/, 480p/, 360p/ subdirectories
   */
  private getAllFilesRecursively(dir: string): string[] {
    const files: string[] = [];
    const items = fs.readdirSync(dir);

    for (const item of items) {
      const fullPath = path.join(dir, item);
      const stat = fs.statSync(fullPath);

      if (stat.isDirectory()) {
        // Recursively get files from subdirectory
        files.push(...this.getAllFilesRecursively(fullPath));
      } else if (stat.isFile()) {
        files.push(fullPath);
      }
    }

    return files;
  }

  // ============================================
  // [S3 DOWNLOAD] Download raw video from S3
  // ============================================
  // Used by AWS Batch workers to download raw videos that
  // were uploaded by video-service's S3 sync.
  // EC2 local workers skip this (file already exists locally).
  // ============================================
  async downloadFile(s3Key: string, localPath: string): Promise<void> {
    if (!this.isS3Enabled || !this.s3Client) {
      throw new Error('S3 not enabled - cannot download file');
    }

    console.log(`[S3-DOWNLOAD] Downloading ${s3Key} → ${localPath}`);
    const startTime = Date.now();

    // Ensure parent directory exists
    const dir = path.dirname(localPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const response = await this.s3Client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: s3Key,
      }),
    );

    // Stream the S3 object to local file
    const body = response.Body as NodeJS.ReadableStream;
    const writeStream = fs.createWriteStream(localPath);

    await new Promise<void>((resolve, reject) => {
      body.pipe(writeStream);
      writeStream.on('finish', resolve);
      writeStream.on('error', reject);
      body.on('error', reject);
    });

    const fileSize = fs.statSync(localPath).size;
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`[S3-DOWNLOAD] [OK] Downloaded ${(fileSize / 1024 / 1024).toFixed(2)} MB in ${duration}s`);
  }

  // ============================================
  // [S3 DELETE] Delete a file from S3
  // ============================================
  // Used to clean up raw videos from S3 after processing
  // to save storage costs.
  // ============================================
  async deleteFile(s3Key: string): Promise<void> {
    if (!this.isS3Enabled || !this.s3Client) {
      return;
    }

    try {
      await this.s3Client.send(
        new DeleteObjectCommand({
          Bucket: this.bucket,
          Key: s3Key,
        }),
      );
      console.log(`[S3-DELETE] [OK] Deleted from S3: ${s3Key}`);
    } catch (error) {
      console.warn(`[S3-DELETE] [WARN] Failed to delete ${s3Key}: ${error.message}`);
    }
  }

  // ============================================
  // [S3 CHECK] Check if file exists in S3
  // ============================================
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
   * Delete processed video from S3
   */
  async deleteProcessedVideo(videoId: string): Promise<void> {
    if (!this.isS3Enabled || !this.s3Client) {
      return;
    }

    // In production, you'd list and delete all objects with this prefix
    console.log(`[DELETE] [Worker] Would delete videos/${videoId}/* from S3`);
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

  /**
   * ============================================
   * ?? HLS CACHING: Get Cache-Control header
   * ============================================
   * CloudFront/Browser caching strategy:
   * - .ts segments: Cache for 1 year (immutable, never change)
   * - .m3u8 playlists: Cache for 1 hour (VOD) or no-cache (live)
   * - Thumbnails: Cache for 1 day
   * 
   * This significantly reduces S3 costs and improves playback latency
   * ============================================
   */
  private getCacheControl(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    
    switch (ext) {
      case '.ts':
        // HLS segments are immutable - cache aggressively
        // 1 year = 31536000 seconds
        return 'public, max-age=31536000, immutable';
      
      case '.m3u8':
        // VOD playlists don't change, but keep shorter for flexibility
        // 1 hour = 3600 seconds
        return 'public, max-age=3600';
      
      case '.jpg':
      case '.jpeg':
      case '.png':
        // Thumbnails - cache for 1 day
        return 'public, max-age=86400';
      
      default:
        // Other files - no caching
        return 'no-cache';
    }
  }

  getBucket(): string {
    return this.bucket;
  }

  getCloudfrontUrl(): string {
    return this.cloudfrontUrl;
  }
}
