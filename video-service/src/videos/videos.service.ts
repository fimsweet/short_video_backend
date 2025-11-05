import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import * as amqp from 'amqplib';
import { Video, VideoStatus } from '../entities/video.entity';
import { UploadVideoDto } from './dto/upload-video.dto';
import { LikesService } from '../likes/likes.service';
import { CommentsService } from '../comments/comments.service';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

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
    private httpService: HttpService,
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

  async getVideosByUserId(userId: string): Promise<any[]> {
    try {
      console.log(`📹 Fetching videos for user ${userId}...`);

      const videos = await this.videoRepository.find({
        where: { 
          userId,
          status: VideoStatus.READY,
        },
        order: { createdAt: 'DESC' },
      });

      console.log(`✅ Found ${videos.length} videos for user ${userId}`);

      // Add like and comment counts
      const videosWithCounts = await Promise.all(
        videos.map(async (video) => {
          const likeCount = await this.likesService.getLikeCount(video.id);
          const commentCount = await this.commentsService.getCommentCount(video.id);

          // Log thumbnail info
          console.log(`   Video ${video.id}:`);
          console.log(`     thumbnailUrl: ${video.thumbnailUrl}`);
          console.log(`     hlsUrl: ${video.hlsUrl}`);

          return {
            id: video.id,
            userId: video.userId,
            title: video.title,
            description: video.description,
            hlsUrl: video.hlsUrl,
            thumbnailUrl: video.thumbnailUrl, // Make sure this is included
            aspectRatio: video.aspectRatio,
            status: video.status,
            createdAt: video.createdAt,
            likeCount,
            commentCount,
            viewCount: 0, // TODO: Add view tracking
          };
        }),
      );

      return videosWithCounts;
    } catch (error) {
      console.error('❌ Error in getVideosByUserId:', error);
      throw error;
    }
  }

  async getAllVideos(limit: number = 50): Promise<any[]> {
    try {
      console.log(`📹 Fetching all videos (limit: ${limit})...`);

      const videos = await this.videoRepository.find({
        where: { status: VideoStatus.READY },
        order: { createdAt: 'DESC' },
        take: limit,
      });

      console.log(`✅ Found ${videos.length} ready videos`);

      // Add like and comment counts
      const videosWithCounts = await Promise.all(
        videos.map(async (video) => {
          const likeCount = await this.likesService.getLikeCount(video.id);
          const commentCount = await this.commentsService.getCommentCount(video.id);

          console.log(`   Video ${video.id}: ${likeCount} likes, ${commentCount} comments`);

          return {
            ...video,
            likeCount,
            commentCount,
          };
        }),
      );

      console.log(`📤 Returning ${videosWithCounts.length} videos with counts`);
      return videosWithCounts;
    } catch (error) {
      console.error('❌ Error in getAllVideos:', error);
      throw error;
    }
  }

  // Get videos from users that the current user is following
  async getFollowingVideos(userId: number, limit: number = 50): Promise<any[]> {
    try {
      console.log(`📹 Fetching following videos for user ${userId}...`);

      // Get list of users that current user is following from user-service
      const userServiceUrl = this.configService.get<string>('USER_SERVICE_URL') || 'http://localhost:3000';
      const response = await firstValueFrom(
        this.httpService.get(`${userServiceUrl}/follows/following/${userId}`)
      );
      
      const followingIds: number[] = response.data.followingIds || [];
      console.log(`✅ User ${userId} is following ${followingIds.length} users`);

      if (followingIds.length === 0) {
        return [];
      }

      // Get videos from followed users
      const videos = await this.videoRepository
        .createQueryBuilder('video')
        .where('video.status = :status', { status: VideoStatus.READY })
        .andWhere('video.userId IN (:...userIds)', { userIds: followingIds.map(id => id.toString()) })
        .orderBy('video.createdAt', 'DESC')
        .take(limit)
        .getMany();

      console.log(`✅ Found ${videos.length} videos from following users`);

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
    } catch (error) {
      console.error('❌ Error in getFollowingVideos:', error);
      throw error;
    }
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