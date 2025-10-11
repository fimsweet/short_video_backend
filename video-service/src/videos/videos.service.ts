import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import * as amqp from 'amqplib';
import { Video, VideoStatus } from '../entities/video.entity';
import { UploadVideoDto } from './dto/upload-video.dto';
import { LikesService } from '../likes/likes.service';
import { CommentsService } from '../comments/comments.service';

@Injectable()
export class VideosService {
  private rabbitMQUrl: string;
  private queueName: string;

  constructor(
    @InjectRepository(Video)
    private videoRepository: Repository<Video>,
    private configService: ConfigService,
    @Inject(forwardRef(() => LikesService))
    private likesService: LikesService,
    @Inject(forwardRef(() => CommentsService))
    private commentsService: CommentsService,
  ) {
    this.rabbitMQUrl = this.configService.get<string>('RABBITMQ_URL') || 'amqp://admin:password@localhost:5672';
    this.queueName = this.configService.get<string>('RABBITMQ_QUEUE') || 'video_processing_queue';
  }

  async uploadVideo(
    uploadVideoDto: UploadVideoDto,
    file: Express.Multer.File,
  ): Promise<Video> {
    try {
      console.log('📹 Starting video upload process...');
      console.log('   File:', file.originalname, `(${file.size} bytes)`);
      console.log('   User ID:', uploadVideoDto.userId);

      // 1. Tạo record trong database
      const video = this.videoRepository.create({
        userId: uploadVideoDto.userId,
        title: uploadVideoDto.title,
        description: uploadVideoDto.description,
        originalFileName: file.originalname,
        rawVideoPath: file.path,
        fileSize: file.size,
        status: VideoStatus.PROCESSING,
      });

      const savedVideo = await this.videoRepository.save(video);
      console.log('✅ Video saved to database:', savedVideo.id);

      // 2. Gửi message vào RabbitMQ để worker xử lý
      await this.sendToQueue({
        videoId: savedVideo.id,
        filePath: file.path,
        fileName: file.filename,
      });
      console.log('✅ Job sent to RabbitMQ queue');

      return savedVideo;
    } catch (error) {
      console.error('Error uploading video:', error);
      throw error;
    }
  }

  private async sendToQueue(message: any): Promise<void> {
    let connection: amqp.Connection;
    let channel: amqp.Channel;

    try {
      // Kết nối tới RabbitMQ
      connection = await amqp.connect(this.rabbitMQUrl);
      channel = await connection.createChannel();

      // Tạo queue nếu chưa tồn tại
      await channel.assertQueue(this.queueName, { durable: true });

      // Gửi message
      channel.sendToQueue(
        this.queueName,
        Buffer.from(JSON.stringify(message)),
        { persistent: true },
      );

      console.log(`[x] Sent video processing job:`, message);

      await channel.close();
      await connection.close();
    } catch (error) {
      console.error('Error sending to RabbitMQ:', error);
      throw error;
    }
  }

  async getVideoById(id: string): Promise<any> {
    const video = await this.videoRepository.findOne({ where: { id } });
    if (!video) return null;

    const likeCount = await this.likesService.getLikeCount(id);
    const commentCount = await this.commentsService.getCommentCount(id);

    return {
      ...video,
      likeCount,
      commentCount,
    };
  }

  async getVideosByUserId(userId: string): Promise<Video[]> {
    return this.videoRepository.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
  }

  // Get all ready videos for feed (guest mode)
  async getAllVideos(limit: number = 50): Promise<any[]> {
    const videos = await this.videoRepository.find({
      where: { status: VideoStatus.READY },
      order: { createdAt: 'DESC' },
      take: limit,
    });

    // Add like and comment counts
    const videosWithCounts = await Promise.all(
      videos.map(async (video) => {
        const likeCount = await this.likesService.getLikeCount(video.id);
        const commentCount = await this.commentsService.getCommentCount(video.id);
        return {
          ...video,
          likeCount,
          commentCount,
        };
      }),
    );

    return videosWithCounts;
  }

  async updateVideoStatus(
    videoId: string,
    status: VideoStatus,
    hlsUrl?: string,
    errorMessage?: string,
  ): Promise<void> {
    await this.videoRepository.update(videoId, {
      status,
      hlsUrl,
      errorMessage,
    });
  }
}