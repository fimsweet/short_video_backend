import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import * as amqp from 'amqplib';
import * as fs from 'fs';
import * as path from 'path';
import { Video, VideoStatus } from '../entities/video.entity';
import { UploadVideoDto } from './dto/upload-video.dto';
import { LikesService } from '../likes/likes.service';
import { CommentsService } from '../comments/comments.service';
import { SavedVideosService } from '../saved-videos/saved-videos.service';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { SharesService } from '../shares/shares.service';

@Injectable()
export class VideosService {
  private rabbitMQUrl: string;
  private queueName: string;

  constructor(
    @InjectRepository(Video)
    private videoRepository: Repository<Video>,
    private configService: ConfigService,
    @Inject(CACHE_MANAGER)
    private cacheManager: Cache,
    @Inject(forwardRef(() => LikesService))
    private likesService: LikesService,
    @Inject(forwardRef(() => CommentsService))
    private commentsService: CommentsService,
    @Inject(forwardRef(() => SavedVideosService))
    private savedVideosService: SavedVideosService,
    @Inject(forwardRef(() => SharesService))
    private sharesService: SharesService,
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
    // ✅ Check cache first
    const cacheKey = `video:${id}`;
    const cachedVideo = await this.cacheManager.get(cacheKey);
    
    if (cachedVideo) {
      console.log(`✅ Cache HIT for video ${id}`);
      return cachedVideo;
    }
    
    console.log(`⚠️ Cache MISS for video ${id} - fetching from DB`);

    const video = await this.videoRepository.findOne({ where: { id } });
    if (!video) return null;

    const likeCount = await this.likesService.getLikeCount(id);
    const commentCount = await this.commentsService.getCommentCount(id);
    const saveCount = await this.savedVideosService.getSaveCount(id);
    const shareCount = await this.sharesService.getShareCount(id);

    console.log(`📹 getVideoById(${id}):`);
    console.log(`   likeCount: ${likeCount}`);
    console.log(`   commentCount: ${commentCount}`);
    console.log(`   saveCount: ${saveCount}`);
    console.log(`   thumbnailUrl: ${video.thumbnailUrl}`);

    const result = {
      ...video,
      likeCount,
      commentCount,
      saveCount,
      shareCount,
    };

    // ✅ Store in cache for 5 minutes
    await this.cacheManager.set(cacheKey, result, 300000);
    
    return result;
  }

  async incrementViewCount(videoId: string): Promise<Video> {
    const video = await this.videoRepository.findOne({ where: { id: videoId } });
    
    if (!video) {
      throw new Error('Video not found');
    }

    video.viewCount = (video.viewCount || 0) + 1;
    await this.videoRepository.save(video);
    
    // ✅ Invalidate cache when video data changes
    await this.cacheManager.del(`video:${videoId}`);
    
    console.log(`👁️ View count incremented for video ${videoId}: ${video.viewCount}`);
    
    return video;
  }

  async getVideosByUserId(userId: string): Promise<any[]> {
    try {
      // ✅ Check cache first
      const cacheKey = `user_videos:${userId}`;
      const cachedVideos = await this.cacheManager.get(cacheKey);
      
      if (cachedVideos) {
        console.log(`✅ Cache HIT for user ${userId} videos`);
        return cachedVideos as any[];
      }
      
      console.log(`⚠️ Cache MISS for user ${userId} videos - fetching from DB`);
      console.log(`📹 Fetching videos for user ${userId}...`);

      const videos = await this.videoRepository.find({
        where: { 
          userId,
        },
        order: { createdAt: 'DESC' },
      });

      console.log(`✅ Found ${videos.length} videos for user ${userId}`);

      // Add like and comment counts
      const videosWithCounts = await Promise.all(
        videos.map(async (video) => {
          const likeCount = await this.likesService.getLikeCount(video.id);
          const commentCount = await this.commentsService.getCommentCount(video.id);
          const saveCount = await this.savedVideosService.getSaveCount(video.id);
          const shareCount = await this.sharesService.getShareCount(video.id);

          // Log video info including isHidden
          console.log(`   Video ${video.id}:`);
          console.log(`     thumbnailUrl: ${video.thumbnailUrl}`);
          console.log(`     hlsUrl: ${video.hlsUrl}`);
          console.log(`     isHidden: ${video.isHidden}`);
          console.log(`     status: ${video.status}`);

          return {
            id: video.id,
            userId: video.userId,
            title: video.title,
            description: video.description,
            hlsUrl: video.hlsUrl,
            thumbnailUrl: video.thumbnailUrl, // Make sure this is included
            aspectRatio: video.aspectRatio,
            status: video.status,
            isHidden: video.isHidden || false, // Include isHidden flag
            createdAt: video.createdAt,
            likeCount,
            commentCount,
            saveCount,
            shareCount,
            viewCount: video.viewCount || 0, // Use actual view count from database
          };
        }),
      );

      // ✅ Store in cache for 2 minutes (user videos change less frequently)
      await this.cacheManager.set(cacheKey, videosWithCounts, 120000);
      
      return videosWithCounts;
    } catch (error) {
      console.error('❌ Error in getVideosByUserId:', error);
      throw error;
    }
  }

  async getAllVideos(limit: number = 50): Promise<any[]> {
    try {
      // ✅ Check cache first
      const cacheKey = `all_videos:${limit}`;
      const cachedVideos = await this.cacheManager.get(cacheKey);
      
      if (cachedVideos) {
        console.log(`✅ Cache HIT for all videos (limit: ${limit})`);
        return cachedVideos as any[];
      }
      
      console.log(`⚠️ Cache MISS for all videos - fetching from DB`);
      console.log(`📹 Fetching all videos (limit: ${limit})...`);

      const videos = await this.videoRepository.find({
        where: { 
          status: VideoStatus.READY,
          isHidden: false, // Only show non-hidden videos
        },
        order: { createdAt: 'DESC' },
        take: limit,
      });

      console.log(`✅ Found ${videos.length} ready videos`);

      // Add like and comment counts
      const videosWithCounts = await Promise.all(
        videos.map(async (video) => {
          const likeCount = await this.likesService.getLikeCount(video.id);
          const commentCount = await this.commentsService.getCommentCount(video.id);
          const saveCount = await this.savedVideosService.getSaveCount(video.id);
          const shareCount = await this.sharesService.getShareCount(video.id);

          return {
            ...video,
            likeCount,
            commentCount,
            saveCount,
            shareCount,
          };
        }),
      );

      console.log(`📤 Returning ${videosWithCounts.length} videos with counts`);
      
      // ✅ Store in cache for 1 minute (feed changes frequently)
      await this.cacheManager.set(cacheKey, videosWithCounts, 60000);
      
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

      const userServiceUrl = this.configService.get<string>('USER_SERVICE_URL') || 'http://localhost:3000';
      const response = await firstValueFrom(
        this.httpService.get(`${userServiceUrl}/follows/following/${userId}`)
      );
      
      const followingIds: number[] = response.data.followingIds || [];
      console.log(`✅ User ${userId} is following ${followingIds.length} users`);

      if (followingIds.length === 0) {
        return [];
      }

      // Get videos from followed users (including hidden videos - TikTok logic)
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
          const saveCount = await this.savedVideosService.getSaveCount(video.id);
          const shareCount = await this.sharesService.getShareCount(video.id);
          return {
            ...video,
            likeCount,
            commentCount,
            saveCount,
            shareCount,
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
    
    // ✅ Invalidate cache when video status changes
    await this.cacheManager.del(`video:${videoId}`);
  }

  async toggleHideVideo(videoId: string, userId: string): Promise<Video> {
    const video = await this.videoRepository.findOne({ where: { id: videoId } });
    
    if (!video) {
      throw new Error('Video not found');
    }

    if (video.userId !== userId) {
      throw new Error('Unauthorized: You can only hide your own videos');
    }

    video.isHidden = !video.isHidden;
    const result = await this.videoRepository.save(video);
    
    // ✅ Invalidate caches
    await this.cacheManager.del(`video:${videoId}`);
    await this.cacheManager.del(`user_videos:${userId}`);
    
    return result;
  }

  async deleteVideo(videoId: string, userId: string): Promise<void> {
    const video = await this.videoRepository.findOne({ where: { id: videoId } });
    
    if (!video) {
      throw new Error('Video not found');
    }

    if (video.userId !== userId) {
      throw new Error('Unauthorized: You can only delete your own videos');
    }

    console.log(`🗑️ Starting deletion process for video ${videoId}...`);

    try {
      // 1. Delete all related data from database
      await Promise.all([
        // Delete all likes
        this.likesService.deleteAllLikesForVideo(videoId),
        // Delete all comments
        this.commentsService.deleteAllCommentsForVideo(videoId),
        // Delete all saves
        this.savedVideosService.deleteAllSavesForVideo(videoId),
        // Delete all shares
        this.sharesService.deleteAllSharesForVideo(videoId),
      ]);

      console.log(`✅ Deleted all related data for video ${videoId}`);

      // 2. Delete processed video files (HLS segments and thumbnails)
      // Extract folder name from hlsUrl or thumbnailUrl
      let processedFolderName = videoId; // Default to videoId
      
      if (video.hlsUrl) {
        // hlsUrl format: /uploads/processed_videos/{folder-id}/playlist.m3u8
        const match = video.hlsUrl.match(/\/processed_videos\/([^\/]+)\//);
        if (match && match[1]) {
          processedFolderName = match[1];
          console.log(`📁 Extracted folder name from hlsUrl: ${processedFolderName}`);
        }
      } else if (video.thumbnailUrl) {
        // thumbnailUrl format: /uploads/processed_videos/{folder-id}/thumbnail.jpg
        const match = video.thumbnailUrl.match(/\/processed_videos\/([^\/]+)\//);
        if (match && match[1]) {
          processedFolderName = match[1];
          console.log(`📁 Extracted folder name from thumbnailUrl: ${processedFolderName}`);
        }
      }
      
      console.log(`🔍 Will delete processed videos folder: ${processedFolderName}`);
      
      // Use path relative to video-service directory
      const processedVideoPath = path.resolve(__dirname, '..', '..', '..', 'video-worker-service', 'processed_videos', processedFolderName);
      
      console.log(`🔍 Looking for processed videos at: ${processedVideoPath}`);
      console.log(`📂 __dirname is: ${__dirname}`);
      
      if (fs.existsSync(processedVideoPath)) {
        try {
          fs.rmSync(processedVideoPath, { recursive: true, force: true });
          console.log(`✅ Deleted processed video files at: ${processedVideoPath}`);
        } catch (error) {
          console.error(`❌ Error deleting processed video folder: ${error}`);
        }
      } else {
        console.log(`⚠️ Processed video folder not found at: ${processedVideoPath}`);
        // Try alternative path (in case service is running in different directory)
        const alternativePath = path.resolve(process.cwd(), '..', 'video-worker-service', 'processed_videos', processedFolderName);
        console.log(`🔍 Trying alternative path: ${alternativePath}`);
        
        if (fs.existsSync(alternativePath)) {
          try {
            fs.rmSync(alternativePath, { recursive: true, force: true });
            console.log(`✅ Deleted processed video files at: ${alternativePath}`);
          } catch (error) {
            console.error(`❌ Error deleting processed video folder: ${error}`);
          }
        } else {
          console.log(`⚠️ Processed video folder not found at alternative path either`);
        }
      }

      // 3. Delete raw video file if exists
      if (video.rawVideoPath && fs.existsSync(video.rawVideoPath)) {
        fs.unlinkSync(video.rawVideoPath);
        console.log(`🗑️ Deleted raw video file: ${video.rawVideoPath}`);
      } else {
        console.log(`⚠️ Raw video file not found or already deleted: ${video.rawVideoPath}`);
      }

      // 4. Finally, delete the video record from database
      await this.videoRepository.delete(videoId);
      
      // ✅ Invalidate all related caches
      await this.cacheManager.del(`video:${videoId}`);
      await this.cacheManager.del(`user_videos:${userId}`);
      // Clear common feed cache keys
      await this.cacheManager.del('all_videos:50');
      await this.cacheManager.del('all_videos:100');
      
      console.log(`✅ Video ${videoId} completely deleted by user ${userId}`);
    } catch (error) {
      console.error(`❌ Error deleting video ${videoId}:`, error);
      throw error; // Throw original error with details
    }
  }
}