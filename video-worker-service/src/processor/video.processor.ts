import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as amqp from 'amqplib';
import * as path from 'path';
import * as fs from 'fs';
import { Video, VideoStatus } from '../entities/video.entity';

// Import fluent-ffmpeg correctly
const ffmpeg = require('fluent-ffmpeg');

@Injectable()
export class VideoProcessorService implements OnModuleInit {
  private rabbitMQUrl: string;
  private queueName: string;
  private processedDir: string;

  constructor(
    @InjectRepository(Video)
    private videoRepository: Repository<Video>,
    private configService: ConfigService,
  ) {
    this.rabbitMQUrl = this.configService.get<string>('RABBITMQ_URL') || 'amqp://admin:password@localhost:5672';
    this.queueName = this.configService.get<string>('RABBITMQ_QUEUE') || 'video_processing_queue';
    this.processedDir = this.configService.get<string>('PROCESSED_VIDEOS_PATH') || './processed_videos';
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
      channel.prefetch(1); // Chỉ xử lý 1 video tại một thời điểm

      channel.consume(this.queueName, async (msg) => {
        if (msg !== null) {
          try {
            const job = JSON.parse(msg.content.toString());
            console.log(`[+] Received job:`, job);

            await this.processVideo(job);

            channel.ack(msg); // Xác nhận đã xử lý xong
          } catch (error) {
            console.error('[-] Failed to process message:', error);
            channel.nack(msg, false, false); // Không retry
          }
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

      // 5. Cập nhật database với aspect ratio
      const hlsUrl = `/uploads/processed_videos/${outputFileName}/playlist.m3u8`;
      await this.videoRepository.update(videoId, {
        status: VideoStatus.READY,
        hlsUrl: hlsUrl,
        aspectRatio: originalAspectRatio,
      });

      console.log(`\n${'='.repeat(60)}`);
      console.log(`✅ VIDEO PROCESSING COMPLETED: ${videoId}`);
      console.log(`   HLS URL: ${hlsUrl}`);
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
          
          // TikTok-style: Scale to fit 9:16 WITHOUT cropping (add black bars if needed)
          // This will maintain full video content with letterboxing
          '-vf scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black',
          
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
          console.log('[FFmpeg] Conversion completed - Video fitted to 9:16 with letterboxing');
          resolve();
        })
        .on('error', (err) => {
          console.error('[FFmpeg] Error:', err);
          reject(err);
        })
        .run();
    });
  }
}
