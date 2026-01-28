import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import * as amqp from 'amqplib';
import * as path from 'path';
import * as fs from 'fs';
import { Video, VideoStatus } from '../entities/video.entity';
import { StorageService } from '../config/storage.service';

// Import fluent-ffmpeg correctly
const ffmpeg = require('fluent-ffmpeg');

@Injectable()
export class VideoProcessorService implements OnModuleInit {
  private rabbitMQUrl: string;
  private queueName: string;
  private processedDir: string;
  private videoServiceUrl: string;

  constructor(
    @InjectRepository(Video)
    private videoRepository: Repository<Video>,
    private configService: ConfigService,
    private httpService: HttpService,
    private storageService: StorageService,
  ) {
    this.rabbitMQUrl = this.configService.get<string>('RABBITMQ_URL') || 'amqp://admin:password@localhost:5672';
    this.queueName = this.configService.get<string>('RABBITMQ_QUEUE') || 'video_processing_queue';
    this.processedDir = this.configService.get<string>('PROCESSED_VIDEOS_PATH') || './processed_videos';
    this.videoServiceUrl = this.configService.get<string>('VIDEO_SERVICE_URL') || 'http://localhost:3002';
  }

  async onModuleInit() {
    // Tạo thư mục processed_videos nếu chưa có
    if (!fs.existsSync(this.processedDir)) {
      fs.mkdirSync(this.processedDir, { recursive: true });
    }

    // Bắt đầu lắng nghe RabbitMQ queue
    await this.startWorker();
  }

  private async startWorker(): Promise<void> {
    console.log('🎬 Video Worker Service started. Waiting for jobs...');

    try {
      const connection = await amqp.connect(this.rabbitMQUrl);
      const channel = await connection.createChannel();

      await channel.assertQueue(this.queueName, { durable: true });
      
      // ✅ MULTIPLE WORKERS: Xử lý đồng thời nhiều video
      // Development: 2-3 videos, Production: 3-5 videos (tùy CPU cores)
      const concurrentJobs = parseInt(this.configService.get<string>('WORKER_CONCURRENCY') || '3', 10);
      channel.prefetch(concurrentJobs);
      
      console.log(`⚡ Worker configured to process ${concurrentJobs} videos concurrently`);

      // ✅ TRUE PARALLEL PROCESSING: Fire-and-forget pattern
      channel.consume(this.queueName, (msg) => {
        if (msg !== null) {
          const job = JSON.parse(msg.content.toString());
          console.log(`[+] Received job:`, job);

          // ✅ Process without blocking - multiple videos at once
          this.processVideo(job)
            .then(() => {
              channel.ack(msg); // Xác nhận đã xử lý xong
              console.log(`[✓] Job ${job.videoId} completed and acknowledged`);
            })
            .catch((error) => {
              console.error(`[-] Failed to process job ${job.videoId}:`, error);
              channel.nack(msg, false, false); // Không retry
            });
        }
      });
    } catch (error) {
      console.error('[-] Worker could not connect to RabbitMQ:', error);
      // Retry sau 5 giây
      setTimeout(() => this.startWorker(), 5000);
    }
  }

  private async processVideo(job: any): Promise<void> {
    const { videoId, filePath, fileName } = job;

    try {
      console.log(`\n${'='.repeat(60)}`);
      console.log(`🎬 PROCESSING VIDEO: ${videoId}`);
      console.log(`${'='.repeat(60)}`);
      
      // 1. Lấy thông tin video từ database
      const video = await this.videoRepository.findOne({ where: { id: videoId } });
      if (!video) {
        throw new Error(`Video ${videoId} not found in database`);
      }

      console.log(`✅ Video found in database`);
      console.log(`   Title: ${video.title}`);
      console.log(`   User: ${video.userId}`);

      // 2. Chuẩn bị đường dẫn
      const inputPath = path.resolve(process.cwd(), '..', 'video-service', filePath);
      const outputFileName = path.parse(fileName).name;
      const outputDir = path.join(this.processedDir, outputFileName);

      // Check if input file exists
      if (!fs.existsSync(inputPath)) {
        throw new Error(`Input file not found: ${inputPath}`);
      }

      const stats = fs.statSync(inputPath);
      console.log(`✅ Input file found: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);

      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }

      console.log(`📁 Input: ${inputPath}`);
      console.log(`📁 Output: ${outputDir}`);

      // 3. Get original video aspect ratio using ffprobe
      console.log(`🔍 Detecting video aspect ratio...`);
      const originalAspectRatio = await this.getVideoAspectRatio(inputPath);
      console.log(`✅ Aspect ratio: ${originalAspectRatio}`);

      // 4. Xử lý video bằng FFmpeg (convert sang HLS)
      console.log(`🎞️ Starting FFmpeg conversion...`);
      await this.convertToHLS(inputPath, outputDir);

      // 5. Tạo thumbnail từ video
      console.log(`📸 Generating thumbnail...`);
      await this.generateThumbnail(inputPath, outputDir);

      // 6. Upload to S3 or use local paths
      let hlsUrl: string;
      let thumbnailUrl: string | null;

      if (this.storageService.isEnabled()) {
        // Upload to AWS S3
        console.log(`☁️ Uploading to S3...`);
        const uploadResult = await this.storageService.uploadProcessedVideo(outputDir, videoId);
        hlsUrl = uploadResult.hlsUrl;
        thumbnailUrl = uploadResult.thumbnailUrl;

        // Clean up local files after S3 upload
        console.log(`🧹 Cleaning up local files...`);
        fs.rmSync(outputDir, { recursive: true, force: true });
      } else {
        // Use local paths
        hlsUrl = `/uploads/processed_videos/${outputFileName}/playlist.m3u8`;
        thumbnailUrl = `/uploads/processed_videos/${outputFileName}/thumbnail.jpg`;
      }

      // 7. Cập nhật database với aspect ratio và thumbnail
      await this.videoRepository.update(videoId, {
        status: VideoStatus.READY,
        hlsUrl: hlsUrl,
        thumbnailUrl: thumbnailUrl,
        aspectRatio: originalAspectRatio,
      });

      // 8. Notify video-service to invalidate cache
      await this.notifyProcessingComplete(videoId, video.userId);

      console.log(`\n${'='.repeat(60)}`);
      console.log(`✅ VIDEO PROCESSING COMPLETED: ${videoId}`);
      console.log(`   HLS URL: ${hlsUrl}`);
      console.log(`   Thumbnail URL: ${thumbnailUrl}`);
      console.log(`   Aspect Ratio: ${originalAspectRatio}`);
      console.log(`${'='.repeat(60)}\n`);
    } catch (error) {
      console.error(`\n${'='.repeat(60)}`);
      console.error(`❌ ERROR PROCESSING VIDEO: ${videoId}`);
      console.error(`${'='.repeat(60)}`);
      console.error(`Error details:`, error);
      console.error(`Stack trace:`, error.stack);
      console.error(`${'='.repeat(60)}\n`);

      // Cập nhật status thành FAILED
      await this.videoRepository.update(videoId, {
        status: VideoStatus.FAILED,
        errorMessage: error.message || 'Unknown error',
      });
    }
  }

  private getVideoAspectRatio(inputPath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(inputPath, (err, metadata) => {
        if (err) {
          reject(err);
          return;
        }

        const videoStream = metadata.streams.find(s => s.codec_type === 'video');
        if (!videoStream || !videoStream.width || !videoStream.height) {
          resolve('unknown');
          return;
        }

        const width = videoStream.width;
        const height = videoStream.height;
        const ratio = width / height;

        // Detect common aspect ratios
        if (Math.abs(ratio - 9/16) < 0.01) {
          resolve('9:16'); // Portrait (TikTok)
        } else if (Math.abs(ratio - 16/9) < 0.01) {
          resolve('16:9'); // Landscape (YouTube)
        } else if (Math.abs(ratio - 1) < 0.01) {
          resolve('1:1'); // Square (Instagram)
        } else if (Math.abs(ratio - 4/3) < 0.01) {
          resolve('4:3'); // Classic TV
        } else {
          resolve(`${width}:${height}`); // Custom ratio
        }
      });
    });
  }

  private convertToHLS(inputPath: string, outputDir: string): Promise<void> {
    return new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .outputOptions([
          '-c:v libx264',
          '-c:a aac',
          '-preset slow',
          '-crf 22',
          '-sc_threshold 0',
          '-g 48',
          '-keyint_min 48',
          

          "-vf scale='if(gt(iw/ih,9/16),1080,-2)':'if(gt(iw/ih,9/16),-2,1920)':flags=lanczos",
          
          '-hls_time 10',
          '-hls_playlist_type vod',
          `-hls_segment_filename ${outputDir}/segment%03d.ts`,
        ])
        .output(`${outputDir}/playlist.m3u8`)
        .on('start', (commandLine) => {
          console.log('[FFmpeg] Command:', commandLine);
        })
        .on('progress', (progress) => {
          console.log(`[FFmpeg] Processing: ${progress.percent?.toFixed(2)}%`);
        })
        .on('end', () => {
          console.log('[FFmpeg] Conversion completed');
          resolve();
        })
        .on('error', (err) => {
          console.error('[FFmpeg] Error:', err);
          reject(err);
        })
        .run();
    });
  }

  private generateThumbnail(inputPath: string, outputDir: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const thumbnailPath = `${outputDir}/thumbnail.jpg`;
      
      console.log(`📸 Generating thumbnail at: ${thumbnailPath}`);
      
      // Use FFmpeg to create thumbnail with proper aspect ratio
      ffmpeg(inputPath)
        .outputOptions([
          // Seek to 10% of video duration
          '-ss', '00:00:01',
          // Take 1 frame
          '-vframes', '1',
          // Smart crop to 1:1 square for grid view (like Instagram/TikTok)
          // This crops the center and scales to 720x720
          '-vf', 'scale=720:720:force_original_aspect_ratio=increase,crop=720:720',
          // Quality
          '-q:v', '2',
        ])
        .output(thumbnailPath)
        .on('start', (commandLine) => {
          console.log('[FFmpeg Thumbnail] Command:', commandLine);
        })
        .on('end', () => {
          // Verify file was created
          if (fs.existsSync(thumbnailPath)) {
            const stats = fs.statSync(thumbnailPath);
            console.log(`✅ Thumbnail generated successfully: ${(stats.size / 1024).toFixed(2)} KB`);
            resolve(thumbnailPath);
          } else {
            console.error('❌ Thumbnail file not created');
            resolve('');
          }
        })
        .on('error', (err) => {
          console.error('[FFmpeg] Thumbnail generation error:', err);
          // Don't reject - video can still work without thumbnail
          resolve('');
        })
        .run();
    });
  }

  // Notify video-service to invalidate cache after processing
  private async notifyProcessingComplete(videoId: string, userId: string): Promise<void> {
    try {
      console.log(`🔄 Notifying video-service to invalidate cache for video ${videoId}...`);
      
      await firstValueFrom(
        this.httpService.post(
          `${this.videoServiceUrl}/videos/${videoId}/processing-complete`,
          { userId },
          { timeout: 5000 }
        )
      );
      
      console.log(`✅ Video-service cache invalidated for video ${videoId}`);
    } catch (error) {
      // Log error but don't fail the processing - cache will eventually expire
      console.error(`⚠️ Failed to notify video-service for cache invalidation:`, error.message);
    }
  }
}
