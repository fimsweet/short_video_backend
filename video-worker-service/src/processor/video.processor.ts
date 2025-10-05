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
      // 1. Lấy thông tin video từ database
      const video = await this.videoRepository.findOne({ where: { id: videoId } });
      if (!video) {
        throw new Error(`Video ${videoId} not found in database`);
      }

      // 2. Chuẩn bị đường dẫn - Sử dụng filePath từ message (giống POC)
      const inputPath = path.resolve(process.cwd(), '..', 'video-service', filePath);
      const outputFileName = path.parse(fileName).name;
      const outputDir = path.join(this.processedDir, outputFileName);

      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }

      console.log(`[+] Processing video: ${inputPath}`);
      console.log(`[+] Output directory: ${outputDir}`);

      // 3. Xử lý video bằng FFmpeg (convert sang HLS)
      await this.convertToHLS(inputPath, outputDir);

      // 4. Cập nhật database
      const hlsUrl = `/uploads/processed_videos/${outputFileName}/playlist.m3u8`;
      await this.videoRepository.update(videoId, {
        status: VideoStatus.READY,
        hlsUrl: hlsUrl,
      });

      console.log(`[✓] Finished processing video ${videoId}`);
    } catch (error) {
      console.error(`[-] Error processing video ${videoId}:`, error);

      // Cập nhật status thành FAILED
      await this.videoRepository.update(videoId, {
        status: VideoStatus.FAILED,
        errorMessage: error.message,
      });
    }
  }

  private convertToHLS(inputPath: string, outputDir: string): Promise<void> {
    return new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .outputOptions([
          '-c:v libx264',          // Video codec: H.264
          '-c:a aac',              // Audio codec: AAC
          '-preset slow',          // Encoding preset (slow = better quality)
          '-crf 22',               // Constant Rate Factor (quality)
          '-sc_threshold 0',       // Scene change threshold
          '-g 48',                 // GOP size
          '-keyint_min 48',        // Minimum keyframe interval
          '-hls_time 10',          // Segment duration: 10 seconds
          '-hls_playlist_type vod', // VOD playlist
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
}
