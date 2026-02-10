import { Injectable, Inject, forwardRef, BadRequestException } from '@nestjs/common';
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
import { CategoriesService } from '../categories/categories.service';
import { SearchService } from '../search/search.service';
import { ActivityLoggerService } from '../config/activity-logger.service';
import { validateVideoFile, deleteInvalidFile } from '../config/file-validation.util';

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
    @Inject(forwardRef(() => CategoriesService))
    private categoriesService: CategoriesService,
    private searchService: SearchService,
    private activityLoggerService: ActivityLoggerService,
  ) {
    this.rabbitMQUrl = this.configService.get<string>('RABBITMQ_URL') || 'amqp://admin:password@localhost:5672';
    this.queueName = this.configService.get<string>('RABBITMQ_QUEUE') || 'video_processing_queue';
  }

  async uploadVideo(
    uploadVideoDto: UploadVideoDto,
    file: Express.Multer.File,
  ): Promise<Video> {
    try {
      console.log('Starting video upload process...');
      console.log('   File:', file.originalname, `(${file.size} bytes)`);
      console.log('   User ID:', uploadVideoDto.userId);

      // ============================================
      // [PRIVACY] SECURITY: Magic Number Validation
      // ============================================
      // This validates the ACTUAL file content, not just the extension
      // Prevents attacks like renaming malware.exe to video.mp4
      // ============================================
      console.log('[CHECK] Validating file magic number...');
      const validation = await validateVideoFile(file.path);
      
      if (!validation.isValid) {
        // Delete the suspicious file immediately
        deleteInvalidFile(file.path);
        
        console.error(`[ERROR] SECURITY: Rejected fake video file from user ${uploadVideoDto.userId}`);
        console.error(`   Original name: ${file.originalname}`);
        console.error(`   Claimed MIME: ${file.mimetype}`);
        console.error(`   Validation error: ${validation.error}`);
        
        throw new BadRequestException(
          'Invalid video file. The file content does not match a valid video format. ' +
          'Please upload a real video file (MP4, MOV, AVI, MKV, WebM).'
        );
      }
      
      console.log(`[OK] File validated: ${validation.detectedMime}`);

      // 1. T?o record trong database
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
      console.log('Video saved to database:', savedVideo.id);

      // 2. Assign categories to video if provided
      if (uploadVideoDto.categoryIds && uploadVideoDto.categoryIds.length > 0) {
        await this.categoriesService.assignCategoriesToVideo(
          savedVideo.id,
          uploadVideoDto.categoryIds,
        );
        console.log('Categories assigned:', uploadVideoDto.categoryIds);
      }

      // 3. Gửi message vào RabbitMQ để worker xử lý
      await this.sendToQueue({
        videoId: savedVideo.id,
        filePath: file.path,
        fileName: file.filename,
        thumbnailTimestamp: uploadVideoDto.thumbnailTimestamp,
      });
      console.log('Job sent to RabbitMQ queue');

      // 4. Invalidate user videos cache so new processing video appears immediately
      await this.cacheManager.del(`user_videos:${uploadVideoDto.userId}`);
      console.log(`[OK] Cache invalidated for user ${uploadVideoDto.userId}`);

      // 5. Log video_posted activity
      this.activityLoggerService.logActivity({
        userId: parseInt(uploadVideoDto.userId),
        actionType: 'video_posted',
        targetId: savedVideo.id,
        targetType: 'video',
        metadata: { title: uploadVideoDto.title },
      });

      return savedVideo;
    } catch (error) {
      console.error('Error uploading video:', error);
      throw error;
    }
  }

  // Called by video-worker-service after processing completes
  async invalidateCacheAfterProcessing(videoId: string, userId: string): Promise<void> {
    console.log(`[CACHE] Invalidating cache after processing for video ${videoId}, user ${userId}`);

    // Invalidate all relevant caches
    await this.cacheManager.del(`video:${videoId}`);
    await this.cacheManager.del(`user_videos:${userId}`);
    await this.cacheManager.del('all_videos:50');
    await this.cacheManager.del('all_videos:100');

    console.log(`[OK] Cache invalidated for video ${videoId}`);
  }

  private async sendToQueue(message: any): Promise<void> {
    let connection: amqp.Connection;
    let channel: amqp.Channel;

    try {
      // Kết nối tới RabbitMQ
      connection = await amqp.connect(this.rabbitMQUrl);
      channel = await connection.createChannel();

      // ============================================
      // Create queue with DLQ support (must match worker config)
      // ============================================
      const dlqName = `${this.queueName}_dlq`;
      
      // Create DLQ first
      await channel.assertQueue(dlqName, { durable: true });
      
      // Create main queue with DLQ routing
      await channel.assertQueue(this.queueName, { 
        durable: true,
        arguments: {
          'x-dead-letter-exchange': '',
          'x-dead-letter-routing-key': dlqName,
        }
      });

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
    // [OK] Check cache first
    const cacheKey = `video:${id}`;
    const cachedVideo = await this.cacheManager.get(cacheKey);

    if (cachedVideo) {
      console.log(`[OK] Cache HIT for video ${id}`);
      return cachedVideo;
    }

    console.log(`[WARN] Cache MISS for video ${id} - fetching from DB`);

    const video = await this.videoRepository.findOne({ where: { id } });
    if (!video) return null;

    const likeCount = await this.likesService.getLikeCount(id);
    const commentCount = await this.commentsService.getCommentCount(id);
    const saveCount = await this.savedVideosService.getSaveCount(id);
    const shareCount = await this.sharesService.getShareCount(id);

    console.log(`?? getVideoById(${id}):`);
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

    // [OK] Store in cache for 5 minutes
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

    // [OK] Invalidate cache when video data changes
    await this.cacheManager.del(`video:${videoId}`);

    console.log(`[VIEW] View count incremented for video ${videoId}: ${video.viewCount}`);

    return video;
  }

  async getVideosByUserId(userId: string): Promise<any[]> {
    try {
      // [OK] Check cache first
      const cacheKey = `user_videos:${userId}`;
      const cachedVideos = await this.cacheManager.get(cacheKey);

      if (cachedVideos) {
        console.log(`[OK] Cache HIT for user ${userId} videos`);
        return cachedVideos as any[];
      }

      console.log(`[WARN] Cache MISS for user ${userId} videos - fetching from DB`);
      console.log(`?? Fetching videos for user ${userId}...`);

      const videos = await this.videoRepository.find({
        where: {
          userId,
        },
        order: { createdAt: 'DESC' },
      });

      console.log(`[OK] Found ${videos.length} videos for user ${userId}`);

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

      // [OK] Store in cache for 2 minutes (user videos change less frequently)
      await this.cacheManager.set(cacheKey, videosWithCounts, 120000);

      return videosWithCounts;
    } catch (error) {
      console.error('[ERROR] Error in getVideosByUserId:', error);
      throw error;
    }
  }

  // Search videos by title or description
  async searchVideos(query: string, limit: number = 50): Promise<any[]> {
    if (!query || query.trim().length === 0) {
      return [];
    }

    try {
      // [OK] Try Elasticsearch first
      if (this.searchService.isAvailable()) {
        console.log(`[CHECK] Using Elasticsearch for search: "${query}"`);
        const esResults = await this.searchService.searchVideos(query, limit);
        console.log(`[CHECK] Elasticsearch found ${esResults.length} videos for query: "${query}"`);

        if (esResults.length > 0) {
          // Enrich with latest counts from DB
          const videosWithCounts = await Promise.all(
            esResults.map(async (video) => {
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
                status: VideoStatus.READY,
              };
            }),
          );
          return videosWithCounts;
        }
      }

      // Fallback to SQL search
      console.log(`[CHECK] Using SQL fallback for search: "${query}"`);
      const searchTerm = `%${query.toLowerCase()}%`;

      const videos = await this.videoRepository
        .createQueryBuilder('video')
        .where('video.status = :status', { status: VideoStatus.READY })
        .andWhere('video.isHidden = :isHidden', { isHidden: false })
        .andWhere('(LOWER(video.title) LIKE :search OR LOWER(video.description) LIKE :search)', { search: searchTerm })
        .orderBy('video.createdAt', 'DESC')
        .limit(limit)
        .getMany();

      console.log(`[CHECK] SQL search found ${videos.length} videos for query: "${query}"`);

      // Add like and comment counts
      const videosWithCounts = await Promise.all(
        videos.map(async (video) => {
          const likeCount = await this.likesService.getLikeCount(video.id);
          const commentCount = await this.commentsService.getCommentCount(video.id);
          const saveCount = await this.savedVideosService.getSaveCount(video.id);
          const shareCount = await this.sharesService.getShareCount(video.id);

          return {
            id: video.id,
            userId: video.userId,
            title: video.title,
            description: video.description,
            hlsUrl: video.hlsUrl,
            thumbnailUrl: video.thumbnailUrl,
            aspectRatio: video.aspectRatio,
            status: video.status,
            createdAt: video.createdAt,
            likeCount,
            commentCount,
            saveCount,
            shareCount,
            viewCount: video.viewCount || 0,
          };
        }),
      );

      return videosWithCounts;
    } catch (error) {
      console.error('[ERROR] Error searching videos:', error);
      return [];
    }
  }

  async getAllVideos(limit: number = 50): Promise<any[]> {
    try {
      // [OK] Check cache first
      const cacheKey = `all_videos:${limit}`;
      const cachedVideos = await this.cacheManager.get(cacheKey);

      if (cachedVideos) {
        console.log(`[OK] Cache HIT for all videos (limit: ${limit})`);
        return cachedVideos as any[];
      }

      console.log(`[WARN] Cache MISS for all videos - fetching from DB`);
      console.log(`?? Fetching all videos (limit: ${limit})...`);

      const videos = await this.videoRepository.find({
        where: {
          status: VideoStatus.READY,
          isHidden: false, // Only show non-hidden videos
        },
        order: { createdAt: 'DESC' },
        take: limit,
      });

      console.log(`[OK] Found ${videos.length} ready videos`);

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

      console.log(`?? Returning ${videosWithCounts.length} videos with counts`);

      // [OK] Store in cache for 1 minute (feed changes frequently)
      await this.cacheManager.set(cacheKey, videosWithCounts, 60000);

      return videosWithCounts;
    } catch (error) {
      console.error('[ERROR] Error in getAllVideos:', error);
      throw error;
    }
  }

  // Get videos from users that the current user is following (EXCLUDING mutual follows/friends)
  // This is for the "Following" tab - shows videos from one-way follows only
  async getFollowingVideos(userId: number, limit: number = 50): Promise<any[]> {
    try {
      console.log(`📺 Fetching following videos for user ${userId} (excluding friends)...`);

      const userServiceUrl = this.configService.get<string>('USER_SERVICE_URL') || 'http://localhost:3000';
      
      // Get all users the current user is following
      const followingResponse = await firstValueFrom(
        this.httpService.get(`${userServiceUrl}/follows/following/${userId}`)
      );
      const followingIds: number[] = followingResponse.data.followingIds || [];
      console.log(`[OK] User ${userId} is following ${followingIds.length} users`);

      if (followingIds.length === 0) {
        return [];
      }

      // Get mutual friends to exclude them from following feed
      const mutualFriendsResponse = await firstValueFrom(
        this.httpService.get(`${userServiceUrl}/follows/mutual-friends/${userId}?limit=1000`)
      );
      const mutualFriendIds: number[] = (mutualFriendsResponse.data.data || []).map((f: any) => f.userId);
      console.log(`[OK] User ${userId} has ${mutualFriendIds.length} mutual friends to exclude`);

      // Filter out mutual friends from following list
      const followingOnlyIds = followingIds.filter(id => !mutualFriendIds.includes(id));
      console.log(`[OK] Following only (not friends): ${followingOnlyIds.length} users`);

      if (followingOnlyIds.length === 0) {
        return [];
      }

      // Get recent videos from followed users (excluding friends)
      // Only show videos from the last 7 days to keep feed fresh
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      const videos = await this.videoRepository
        .createQueryBuilder('video')
        .where('video.status = :status', { status: VideoStatus.READY })
        .andWhere('video.userId IN (:...userIds)', { userIds: followingOnlyIds.map(id => id.toString()) })
        .andWhere('video.createdAt > :since', { since: sevenDaysAgo })
        .orderBy('video.createdAt', 'DESC')
        .take(limit)
        .getMany();

      console.log(`[OK] Found ${videos.length} recent videos from following users (last 7 days, excluding friends)`);

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
      console.error('[ERROR] Error in getFollowingVideos:', error);
      throw error;
    }
  }

  // Get videos from mutual friends only (users who follow each other)
  // This is for the "Friends" tab - shows videos from two-way/mutual follows
  async getFriendsVideos(userId: number, limit: number = 50): Promise<any[]> {
    try {
      console.log(`👥 Fetching friends videos for user ${userId}...`);

      const userServiceUrl = this.configService.get<string>('USER_SERVICE_URL') || 'http://localhost:3000';
      
      // Get mutual friends (users who follow each other)
      const mutualFriendsResponse = await firstValueFrom(
        this.httpService.get(`${userServiceUrl}/follows/mutual-friends/${userId}?limit=1000`)
      );
      const mutualFriendIds: number[] = (mutualFriendsResponse.data.data || []).map((f: any) => f.userId);
      console.log(`[OK] User ${userId} has ${mutualFriendIds.length} mutual friends`);

      if (mutualFriendIds.length === 0) {
        return [];
      }

      // Get recent videos from mutual friends only
      // Only show videos from the last 7 days to keep feed fresh
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      const videos = await this.videoRepository
        .createQueryBuilder('video')
        .where('video.status = :status', { status: VideoStatus.READY })
        .andWhere('video.userId IN (:...userIds)', { userIds: mutualFriendIds.map(id => id.toString()) })
        .andWhere('video.createdAt > :since', { since: sevenDaysAgo })
        .orderBy('video.createdAt', 'DESC')
        .take(limit)
        .getMany();

      console.log(`[OK] Found ${videos.length} recent videos from mutual friends (last 7 days)`);

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
      console.error('[ERROR] Error in getFriendsVideos:', error);
      throw error;
    }
  }

  // Count new videos from following users since a given date
  async getFollowingNewVideoCount(userId: number, since: Date): Promise<number> {
    try {
      const userServiceUrl = this.configService.get<string>('USER_SERVICE_URL') || 'http://localhost:3000';
      
      const followingResponse = await firstValueFrom(
        this.httpService.get(`${userServiceUrl}/follows/following/${userId}`)
      );
      const followingIds: number[] = followingResponse.data.followingIds || [];
      if (followingIds.length === 0) return 0;

      // Exclude mutual friends
      const mutualFriendsResponse = await firstValueFrom(
        this.httpService.get(`${userServiceUrl}/follows/mutual-friends/${userId}?limit=1000`)
      );
      const mutualFriendIds: number[] = (mutualFriendsResponse.data.data || []).map((f: any) => f.userId);
      const followingOnlyIds = followingIds.filter(id => !mutualFriendIds.includes(id));
      if (followingOnlyIds.length === 0) return 0;

      const count = await this.videoRepository
        .createQueryBuilder('video')
        .where('video.status = :status', { status: VideoStatus.READY })
        .andWhere('video.userId IN (:...userIds)', { userIds: followingOnlyIds.map(id => id.toString()) })
        .andWhere('video.createdAt > :since', { since })
        .getCount();

      return count;
    } catch (error) {
      console.error('[ERROR] Error in getFollowingNewVideoCount:', error);
      return 0;
    }
  }

  // Count new videos from mutual friends since a given date
  async getFriendsNewVideoCount(userId: number, since: Date): Promise<number> {
    try {
      const userServiceUrl = this.configService.get<string>('USER_SERVICE_URL') || 'http://localhost:3000';
      
      const mutualFriendsResponse = await firstValueFrom(
        this.httpService.get(`${userServiceUrl}/follows/mutual-friends/${userId}?limit=1000`)
      );
      const mutualFriendIds: number[] = (mutualFriendsResponse.data.data || []).map((f: any) => f.userId);
      if (mutualFriendIds.length === 0) return 0;

      const count = await this.videoRepository
        .createQueryBuilder('video')
        .where('video.status = :status', { status: VideoStatus.READY })
        .andWhere('video.userId IN (:...userIds)', { userIds: mutualFriendIds.map(id => id.toString()) })
        .andWhere('video.createdAt > :since', { since })
        .getCount();

      return count;
    } catch (error) {
      console.error('[ERROR] Error in getFriendsNewVideoCount:', error);
      return 0;
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

    // [OK] Invalidate cache when video status changes
    await this.cacheManager.del(`video:${videoId}`);

    // [OK] Index to Elasticsearch when video is ready
    if (status === VideoStatus.READY) {
      const video = await this.videoRepository.findOne({ where: { id: videoId } });
      if (video) {
        const likeCount = await this.likesService.getLikeCount(videoId);
        const commentCount = await this.commentsService.getCommentCount(videoId);
        await this.searchService.indexVideo({
          id: video.id,
          userId: video.userId,
          title: video.title || '',
          description: video.description || '',
          thumbnailUrl: video.thumbnailUrl || '',
          hlsUrl: video.hlsUrl || '',
          aspectRatio: video.aspectRatio || '9:16',
          viewCount: video.viewCount || 0,
          likeCount,
          commentCount,
          createdAt: video.createdAt,
        });
      }
    }
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

    // [OK] Invalidate caches
    await this.cacheManager.del(`video:${videoId}`);
    await this.cacheManager.del(`user_videos:${userId}`);

    // Log video_hidden activity
    this.activityLoggerService.logActivity({
      userId: parseInt(userId),
      actionType: 'video_hidden',
      targetId: videoId,
      targetType: 'video',
      metadata: { isHidden: video.isHidden, title: video.title },
    });

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

    console.log(`[DELETE] Starting deletion process for video ${videoId}...`);

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

      console.log(`[OK] Deleted all related data for video ${videoId}`);

      // 2. Delete processed video files (HLS segments and thumbnails)
      // Extract folder name from hlsUrl or thumbnailUrl
      let processedFolderName = videoId; // Default to videoId

      if (video.hlsUrl) {
        // hlsUrl format: /uploads/processed_videos/{folder-id}/playlist.m3u8
        const match = video.hlsUrl.match(/\/processed_videos\/([^\/]+)\//);
        if (match && match[1]) {
          processedFolderName = match[1];
          console.log(`[PATH] Extracted folder name from hlsUrl: ${processedFolderName}`);
        }
      } else if (video.thumbnailUrl) {
        // thumbnailUrl format: /uploads/processed_videos/{folder-id}/thumbnail.jpg
        const match = video.thumbnailUrl.match(/\/processed_videos\/([^\/]+)\//);
        if (match && match[1]) {
          processedFolderName = match[1];
          console.log(`[PATH] Extracted folder name from thumbnailUrl: ${processedFolderName}`);
        }
      }

      console.log(`[CHECK] Will delete processed videos folder: ${processedFolderName}`);

      // Use path relative to video-service directory
      const processedVideoPath = path.resolve(__dirname, '..', '..', '..', 'video-worker-service', 'processed_videos', processedFolderName);

      console.log(`[CHECK] Looking for processed videos at: ${processedVideoPath}`);
      console.log(`?? __dirname is: ${__dirname}`);

      if (fs.existsSync(processedVideoPath)) {
        try {
          fs.rmSync(processedVideoPath, { recursive: true, force: true });
          console.log(`[OK] Deleted processed video files at: ${processedVideoPath}`);
        } catch (error) {
          console.error(`[ERROR] Error deleting processed video folder: ${error}`);
        }
      } else {
        console.log(`[WARN] Processed video folder not found at: ${processedVideoPath}`);
        // Try alternative path (in case service is running in different directory)
        const alternativePath = path.resolve(process.cwd(), '..', 'video-worker-service', 'processed_videos', processedFolderName);
        console.log(`[CHECK] Trying alternative path: ${alternativePath}`);

        if (fs.existsSync(alternativePath)) {
          try {
            fs.rmSync(alternativePath, { recursive: true, force: true });
            console.log(`[OK] Deleted processed video files at: ${alternativePath}`);
          } catch (error) {
            console.error(`[ERROR] Error deleting processed video folder: ${error}`);
          }
        } else {
          console.log(`[WARN] Processed video folder not found at alternative path either`);
        }
      }

      // 3. Delete raw video file if exists
      if (video.rawVideoPath && fs.existsSync(video.rawVideoPath)) {
        fs.unlinkSync(video.rawVideoPath);
        console.log(`[DELETE] Deleted raw video file: ${video.rawVideoPath}`);
      } else {
        console.log(`[WARN] Raw video file not found or already deleted: ${video.rawVideoPath}`);
      }

      // 4. Finally, delete the video record from database
      await this.videoRepository.delete(videoId);

      // [OK] Delete from Elasticsearch index
      await this.searchService.deleteVideo(videoId);

      // [OK] Invalidate all related caches
      await this.cacheManager.del(`video:${videoId}`);
      await this.cacheManager.del(`user_videos:${userId}`);
      // Clear common feed cache keys
      await this.cacheManager.del('all_videos:50');
      await this.cacheManager.del('all_videos:100');

      console.log(`[OK] Video ${videoId} completely deleted by user ${userId}`);

      // Log video_deleted activity
      this.activityLoggerService.logActivity({
        userId: parseInt(userId),
        actionType: 'video_deleted',
        targetId: videoId,
        targetType: 'video',
        metadata: { title: video.title },
      });
    } catch (error) {
      console.error(`[ERROR] Error deleting video ${videoId}:`, error);
      throw error; // Throw original error with details
    }
  }

  // Update video privacy settings
  async updateVideoPrivacy(
    videoId: string,
    settings: {
      userId: string;
      visibility?: 'public' | 'friends' | 'private';
      allowComments?: boolean;
      allowDuet?: boolean;
    },
  ): Promise<Video> {
    const video = await this.videoRepository.findOne({ where: { id: videoId } });

    if (!video) {
      throw new Error('Video not found');
    }

    if (video.userId !== settings.userId) {
      throw new Error('Not authorized to update this video');
    }

    if (settings.visibility !== undefined) {
      video.visibility = settings.visibility as any;
    }
    if (settings.allowComments !== undefined) {
      video.allowComments = settings.allowComments;
    }
    if (settings.allowDuet !== undefined) {
      video.allowDuet = settings.allowDuet;
    }

    await this.videoRepository.save(video);

    // Invalidate cache
    await this.cacheManager.del(`video:${videoId}`);
    await this.cacheManager.del(`user_videos:${settings.userId}`);

    console.log(`[PRIVACY] Video ${videoId} privacy updated: visibility=${video.visibility}, comments=${video.allowComments}, duet=${video.allowDuet}`);

    return video;
  }

  // Edit video (title, description)
  async editVideo(
    videoId: string,
    updateData: {
      userId: string;
      title?: string;
      description?: string;
    },
  ): Promise<Video> {
    const video = await this.videoRepository.findOne({ where: { id: videoId } });

    if (!video) {
      throw new Error('Video not found');
    }

    if (video.userId !== updateData.userId) {
      throw new Error('Not authorized to edit this video');
    }

    if (updateData.title !== undefined) {
      video.title = updateData.title;
    }
    if (updateData.description !== undefined) {
      video.description = updateData.description;
    }

    await this.videoRepository.save(video);

    // Invalidate cache
    await this.cacheManager.del(`video:${videoId}`);
    await this.cacheManager.del(`user_videos:${updateData.userId}`);

    // Update Elasticsearch index - convert Video to VideoDocument
    await this.searchService.indexVideo({
      id: video.id,
      userId: video.userId,
      title: video.title,
      description: video.description || '',
      thumbnailUrl: video.thumbnailUrl || '',
      hlsUrl: video.hlsUrl || '',
      aspectRatio: video.aspectRatio || '9:16',
      viewCount: video.viewCount || 0,
      likeCount: 0, // Will be updated separately
      commentCount: 0, // Will be updated separately
      createdAt: video.createdAt,
    });

    console.log(`[EDIT] Video ${videoId} edited: title="${video.title}"`);

    return video;
  }

  // Update video thumbnail
  async updateThumbnail(
    videoId: string,
    userId: string,
    file: Express.Multer.File,
  ): Promise<Video> {
    const video = await this.videoRepository.findOne({ where: { id: videoId } });

    if (!video) {
      throw new Error('Video not found');
    }

    if (video.userId !== userId) {
      throw new Error('Not authorized to update this video thumbnail');
    }

    // Delete old custom thumbnail if exists (but keep auto-generated ones)
    if (video.thumbnailUrl && video.thumbnailUrl.includes('/thumbnails/thumb_')) {
      const oldThumbPath = path.join(process.cwd(), video.thumbnailUrl.replace(/^\//, ''));
      if (fs.existsSync(oldThumbPath)) {
        try {
          fs.unlinkSync(oldThumbPath);
          console.log(`[DELETE] Deleted old thumbnail: ${oldThumbPath}`);
        } catch (e) {
          console.error(`[WARN] Could not delete old thumbnail: ${e}`);
        }
      }
    }

    // Update thumbnail URL
    video.thumbnailUrl = `/uploads/thumbnails/${file.filename}`;
    await this.videoRepository.save(video);

    // Invalidate cache
    await this.cacheManager.del(`video:${videoId}`);
    await this.cacheManager.del(`user_videos:${userId}`);
    await this.cacheManager.del('all_videos:50');

    console.log(`[THUMB] Video ${videoId} thumbnail updated: ${video.thumbnailUrl}`);

    return video;
  }

  // Upload video with custom thumbnail
  async uploadVideoWithThumbnail(
    uploadVideoDto: UploadVideoDto,
    videoFile: Express.Multer.File,
    thumbnailFile?: Express.Multer.File,
  ): Promise<Video> {
    try {
      console.log('Starting video upload with thumbnail...');
      console.log('   Video file:', videoFile.originalname, `(${videoFile.size} bytes)`);
      if (thumbnailFile) {
        console.log('   Thumbnail file:', thumbnailFile.originalname, `(${thumbnailFile.size} bytes)`);
      }
      console.log('   User ID:', uploadVideoDto.userId);

      // 1. Create record in database
      const video = this.videoRepository.create({
        userId: uploadVideoDto.userId,
        title: uploadVideoDto.title,
        description: uploadVideoDto.description,
        originalFileName: videoFile.originalname,
        rawVideoPath: videoFile.path,
        fileSize: videoFile.size,
        status: VideoStatus.PROCESSING,
        // Set custom thumbnail if provided
        thumbnailUrl: thumbnailFile ? `/uploads/thumbnails/${thumbnailFile.filename}` : undefined,
      });

      const savedVideo = await this.videoRepository.save(video);
      console.log('Video saved to database:', savedVideo.id);

      // 2. Assign categories to video if provided
      if (uploadVideoDto.categoryIds && uploadVideoDto.categoryIds.length > 0) {
        await this.categoriesService.assignCategoriesToVideo(
          savedVideo.id,
          uploadVideoDto.categoryIds,
        );
        console.log('Categories assigned:', uploadVideoDto.categoryIds);
      }

      // 3. Send message to RabbitMQ for worker to process
      // Include flag to skip thumbnail generation if custom one provided
      await this.sendToQueue({
        videoId: savedVideo.id,
        filePath: videoFile.path,
        fileName: videoFile.filename,
        skipThumbnailGeneration: !!thumbnailFile,
        thumbnailTimestamp: uploadVideoDto.thumbnailTimestamp,
      });
      console.log('Job sent to RabbitMQ queue');

      // 4. Invalidate user videos cache
      await this.cacheManager.del(`user_videos:${uploadVideoDto.userId}`);
      console.log(`[OK] Cache invalidated for user ${uploadVideoDto.userId}`);

      // 5. Log video_posted activity
      this.activityLoggerService.logActivity({
        userId: parseInt(uploadVideoDto.userId),
        actionType: 'video_posted',
        targetId: savedVideo.id,
        targetType: 'video',
        metadata: { title: savedVideo.title, hasCustomThumbnail: !!thumbnailFile },
      });

      return savedVideo;
    } catch (error) {
      console.error('[ERROR] Error uploading video with thumbnail:', error);
      throw error;
    }
  }
}