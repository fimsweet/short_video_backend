import { Injectable, Inject, forwardRef, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import * as amqp from 'amqplib';
import * as fs from 'fs';
import * as path from 'path';
import { Video, VideoStatus, VideoVisibility } from '../entities/video.entity';
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
import { StorageService } from '../config/storage.service';
import { PrivacyService } from '../config/privacy.service';
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
    private storageService: StorageService,
    private privacyService: PrivacyService,
  ) {
    this.rabbitMQUrl = this.configService.get<string>('RABBITMQ_URL') || 'amqp://admin:password@localhost:5672';
    this.queueName = this.configService.get<string>('RABBITMQ_QUEUE') || 'video_processing_queue';
  }

  // Helper: Invalidate all user video cache variants using visibility tiers
  // Uses 3 deterministic keys: self, friend, public — no pattern matching needed
  private async invalidateUserVideosCache(userId: string): Promise<void> {
    await Promise.all([
      this.cacheManager.del(`user_videos:${userId}:self`),
      this.cacheManager.del(`user_videos:${userId}:friend`),
      this.cacheManager.del(`user_videos:${userId}:public`),
      this.cacheManager.del(`user_videos:${userId}:restricted`),
    ]);
    console.log(`[CACHE] Invalidated all user_videos cache tiers for user ${userId}`);
  }

  // Helper: Invalidate feed caches so hidden/unhidden videos reflect immediately
  private async invalidateFeedCaches(): Promise<void> {
    await Promise.all([
      this.cacheManager.del('all_videos:50'),
      this.cacheManager.del('all_videos:100'),
    ]);
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
        visibility: uploadVideoDto.visibility || VideoVisibility.PUBLIC,
        allowComments: uploadVideoDto.allowComments !== undefined ? uploadVideoDto.allowComments : true,
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

      // ============================================
      // 3. [S3 SYNC] Upload raw video to S3 BEFORE sending to queue
      // ============================================
      // IMPORTANT: Must await S3 upload BEFORE sending RabbitMQ message!
      // If we send to queue first (fire-and-forget), AWS Batch worker
      // may start before S3 upload completes → "file not found" error.
      //
      // Order: S3 upload (await) → RabbitMQ send → Batch worker downloads
      // This adds 1-2s latency but guarantees 100% reliability.
      // If S3 fails, we still send to queue (EC2 local worker can process).
      // ============================================
      await this.syncRawVideoToS3(file.path, file.filename);

      // 4. Gửi message vào RabbitMQ để worker xử lý
      await this.sendToQueue({
        videoId: savedVideo.id,
        filePath: file.path,
        fileName: file.filename,
        thumbnailTimestamp: uploadVideoDto.thumbnailTimestamp,
      });
      console.log('Job sent to RabbitMQ queue');

      // 5. Invalidate user videos cache so new processing video appears immediately
      await this.invalidateUserVideosCache(uploadVideoDto.userId);
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
    await this.invalidateUserVideosCache(userId);
    await this.invalidateFeedCaches();

    console.log(`[OK] Cache invalidated for video ${videoId}`);
  }

  // ============================================
  // [RETRY] Retry a failed video processing job
  // ============================================
  // Resets status from FAILED → PROCESSING and re-queues to RabbitMQ.
  // The raw video file is preserved on failure (worker keeps it),
  // and for S3-enabled setups, the raw file was already synced to S3 on upload.
  // ============================================
  async retryFailedVideo(videoId: string, userId: string): Promise<Video> {
    const video = await this.videoRepository.findOne({ where: { id: videoId } });

    if (!video) {
      throw new BadRequestException('Video not found');
    }

    if (video.userId !== userId) {
      throw new BadRequestException('You can only retry your own videos');
    }

    if (video.status !== VideoStatus.FAILED) {
      throw new BadRequestException(`Cannot retry video with status "${video.status}". Only failed videos can be retried.`);
    }

    console.log(`[RETRY] Retrying failed video: ${videoId}`);
    console.log(`   Raw video path: ${video.rawVideoPath}`);
    console.log(`   Original file: ${video.originalFileName}`);
    console.log(`   Error was: ${video.errorMessage}`);

    // Reset status to PROCESSING and clear error/old URLs
    await this.videoRepository.update(videoId, {
      status: VideoStatus.PROCESSING,
      errorMessage: null as any,
      hlsUrl: null as any,
      thumbnailUrl: null as any,
    });
    const updatedVideo = await this.videoRepository.findOne({ where: { id: videoId } });
    if (!updatedVideo) {
      throw new BadRequestException('Failed to reload video after retry');
    }

    // Re-queue to RabbitMQ for processing
    const fileName = path.basename(video.rawVideoPath);
    await this.sendToQueue({
      videoId: video.id,
      filePath: video.rawVideoPath,
      fileName: fileName,
    });

    // Invalidate caches so frontend sees updated status
    await this.cacheManager.del(`video:${videoId}`);
    await this.invalidateUserVideosCache(userId);

    console.log(`[OK] Video ${videoId} re-queued for processing`);
    return updatedVideo;
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

  // ============================================
  // [S3 SYNC] Upload raw video to S3 for Batch workers
  // ============================================
  // When a user uploads a video, the raw file is saved locally.
  // AWS Batch workers run on separate machines and can't access
  // local files, so we sync the raw video to S3.
  // 
  // S3 key format: raw_videos/{filename}
  // This matches what the worker expects when downloading.
  //
  // This runs fire-and-forget (non-blocking) because:
  // 1. The local EC2 worker can process from the local file
  // 2. We don't want upload latency to affect the user
  // 3. If S3 fails, only Batch workers are affected
  // ============================================
  private async syncRawVideoToS3(filePath: string, fileName: string): Promise<void> {
    if (!this.storageService.isEnabled()) {
      console.log(`[S3-SYNC] S3 not configured, skipping raw video sync`);
      return; // S3 not configured, skip sync
    }

    try {
      const s3Key = `raw_videos/${fileName}`;
      console.log(`[S3-SYNC] Uploading raw video to S3: ${s3Key}`);
      
      await this.storageService.uploadFile(filePath, s3Key, 'video/mp4');
      
      console.log(`[S3-SYNC] [OK] Raw video synced to S3: ${s3Key}`);
    } catch (error) {
      // ============================================
      // DON'T THROW - S3 sync failure is non-critical
      // ============================================
      // If S3 upload fails, we still send to RabbitMQ.
      // The EC2 local worker can process from local file.
      // Only AWS Batch workers need S3, and if S3 is down,
      // Batch workers won't be able to work anyway.
      // ============================================
      console.error(`[S3-SYNC] [WARN] Failed to sync raw video to S3: ${error.message}`);
      console.error(`[S3-SYNC] EC2 local worker can still process from local file`);
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

  async getVideosByUserId(userId: string, requesterId?: string): Promise<{ videos: any[], privacyRestricted?: boolean, reason?: string }> {
    try {
      // Determine visibility tier for caching (self / friend / public / restricted)
      const isOwner = !requesterId || requesterId === userId;
      let cacheTier = isOwner ? 'self' : 'public'; // default tier

      // [PRIVACY] Check user-level privacy settings before fetching videos
      if (!isOwner) {
        const privacyCheck = await this.privacyService.canViewVideo(requesterId, userId);
        if (!privacyCheck.allowed) {
          console.log(`[PRIVACY] User ${requesterId} cannot view videos of user ${userId}: ${privacyCheck.reason}`);
          const restrictedKey = `user_videos:${userId}:restricted`;
          const cachedRestricted = await this.cacheManager.get(restrictedKey);
          if (cachedRestricted) return cachedRestricted as any;
          const result = { videos: [], privacyRestricted: true, reason: privacyCheck.reason };
          await this.cacheManager.set(restrictedKey, result, 60000);
          return result;
        }
      }

      // Check friendship for non-owners to determine cache tier
      let isFriend = false;
      if (!isOwner) {
        try {
          isFriend = await this.checkMutualFriend(requesterId!, userId);
        } catch (e) {
          console.error('[ERROR] Error checking mutual follow:', e);
        }
        cacheTier = isFriend ? 'friend' : 'public';
      }

      // [OK] Check cache using visibility tier key
      const cacheKey = `user_videos:${userId}:${cacheTier}`;
      const cachedVideos = await this.cacheManager.get(cacheKey);
      if (cachedVideos) {
        console.log(`[OK] Cache HIT for user ${userId} videos (tier: ${cacheTier})`);
        // Always overlay fresh ownerWhoCanComment (user-level privacy can change anytime)
        const cached = cachedVideos as any;
        if (cached.videos && Array.isArray(cached.videos)) {
          const freshSettings = await this.privacyService.getPrivacySettingsBatch([userId]);
          cached.videos = cached.videos.map((v: any) => ({
            ...v,
            ownerWhoCanComment: freshSettings.get(userId)?.whoCanComment || 'everyone',
          }));
        }
        return cached;
      }

      console.log(`[WARN] Cache MISS for user ${userId} videos (tier: ${cacheTier}) - fetching from DB`);

      const videos = await this.videoRepository.find({
        where: { userId },
        order: { createdAt: 'DESC' },
      });

      console.log(`[OK] Found ${videos.length} videos for user ${userId}`);

      // Filter by visibility based on relationship tier
      let filteredVideos = videos;
      if (!isOwner) {
        if (isFriend) {
          filteredVideos = videos.filter(v => 
            !v.isHidden && (v.visibility === VideoVisibility.PUBLIC || v.visibility === VideoVisibility.FRIENDS)
          );
        } else {
          filteredVideos = videos.filter(v => !v.isHidden && v.visibility === VideoVisibility.PUBLIC);
        }
        console.log(`[OK] Filtered to ${filteredVideos.length} visible videos for tier ${cacheTier}`);
      }

      // Fetch owner privacy settings for whoCanComment
      const userSettingsMap = await this.privacyService.getPrivacySettingsBatch([userId]);

      // Add like and comment counts
      const videosWithCounts = await Promise.all(
        filteredVideos.map(async (video) => {
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
            isHidden: video.isHidden || false,
            visibility: video.visibility || 'public',
            allowComments: video.allowComments !== false,
            allowDuet: video.allowDuet !== false,
            createdAt: video.createdAt,
            likeCount,
            commentCount,
            saveCount,
            shareCount,
            viewCount: video.viewCount || 0,
            ownerWhoCanComment: userSettingsMap.get(video.userId)?.whoCanComment || 'everyone',
          };
        }),
      );

      // [OK] Store in cache — but SKIP caching if there are processing/failed videos
      // so the grid always gets fresh DB data and shows status changes immediately
      const result = { videos: videosWithCounts };
      const hasProcessingVideos = videosWithCounts.some(
        v => v.status === 'processing' || v.status === 'failed',
      );

      if (hasProcessingVideos) {
        console.log(`[CACHE] Skipping cache — ${videosWithCounts.filter(v => v.status !== 'ready').length} video(s) still processing/failed`);
      } else {
        await this.cacheManager.set(cacheKey, result, 120000); // 2 minutes
      }

      return result;
    } catch (error) {
      console.error('[ERROR] Error in getVideosByUserId:', error);
      throw error;
    }
  }

  // Check if two users are mutual friends (follow each other)
  async checkMutualFriend(requesterId: string, videoOwnerId: string): Promise<boolean> {
    if (!requesterId || !videoOwnerId) return false;
    try {
      const userServiceUrl = this.configService.get<string>('USER_SERVICE_URL') || 'http://localhost:3000';
      const mutualResponse = await firstValueFrom(
        this.httpService.get(`${userServiceUrl}/follows/check-mutual/${requesterId}/${videoOwnerId}`)
      );
      return mutualResponse.data?.isMutual === true;
    } catch (e) {
      console.error('[ERROR] Error checking mutual friend:', e);
      return false;
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
        .andWhere('video.visibility = :visibility', { visibility: VideoVisibility.PUBLIC })
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
        // Always overlay fresh ownerWhoCanComment (user-level privacy can change anytime)
        const cached = cachedVideos as any[];
        const cachedOwnerIds = [...new Set(cached.map(v => v.userId))];
        const freshSettings = await this.privacyService.getPrivacySettingsBatch(cachedOwnerIds);
        return cached.map(v => ({
          ...v,
          ownerWhoCanComment: freshSettings.get(v.userId)?.whoCanComment || 'everyone',
        }));
      }

      console.log(`[WARN] Cache MISS for all videos - fetching from DB`);
      console.log(`📺 Fetching all videos (limit: ${limit})...`);

      // Fetch more videos to account for privacy filtering
      const videos = await this.videoRepository.find({
        where: {
          status: VideoStatus.READY,
          isHidden: false, // Only show non-hidden videos
          visibility: VideoVisibility.PUBLIC, // Only public videos in general feed
        },
        order: { createdAt: 'DESC' },
        take: limit * 2, // Fetch extra to compensate for privacy filtering
      });

      console.log(`[OK] Found ${videos.length} ready public videos`);

      // [PRIVACY] Filter out videos from private accounts and restricted users
      const filteredVideos = await this.privacyService.filterVideosByPrivacy(videos);
      console.log(`[PRIVACY] After privacy filter: ${filteredVideos.length}/${videos.length} videos`);

      // Trim to requested limit
      const limitedVideos = filteredVideos.slice(0, limit);

      // Fetch owner privacy settings for whoCanComment
      const allOwnerIds = [...new Set(limitedVideos.map(v => v.userId))];
      const allSettingsMap = await this.privacyService.getPrivacySettingsBatch(allOwnerIds);

      // Add like and comment counts
      const videosWithCounts = await Promise.all(
        limitedVideos.map(async (video) => {
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
            ownerWhoCanComment: allSettingsMap.get(video.userId)?.whoCanComment || 'everyone',
          };
        }),
      );

      console.log(`📺 Returning ${videosWithCounts.length} videos with counts`);

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
        .andWhere('video.isHidden = :isHidden', { isHidden: false })
        .andWhere('video.visibility = :visibility', { visibility: VideoVisibility.PUBLIC })
        .andWhere('video.userId IN (:...userIds)', { userIds: followingOnlyIds.map(id => id.toString()) })
        .andWhere('video.createdAt > :since', { since: sevenDaysAgo })
        .orderBy('video.createdAt', 'DESC')
        .take(limit)
        .getMany();

      console.log(`[OK] Found ${videos.length} recent public videos from following users (last 7 days, excluding friends)`);

      // [PRIVACY] Filter by whoCanViewVideos setting
      // Following tab = one-way follows, NOT mutual friends
      // So whoCanViewVideos='friends' should be excluded (viewer is NOT a friend, just a follower)
      // accountPrivacy='private' is OK because viewer IS a follower
      const ownerIds = [...new Set(videos.map(v => v.userId))];
      const settingsMap = await this.privacyService.getPrivacySettingsBatch(ownerIds);
      const privacyFiltered = videos.filter(video => {
        const settings = settingsMap.get(video.userId);
        if (!settings) return true;
        if (settings.whoCanViewVideos === 'onlyMe') return false;
        if (settings.whoCanViewVideos === 'friends') return false; // Not friends, just following
        return true;
      });
      console.log(`[PRIVACY] Following feed after privacy filter: ${privacyFiltered.length}/${videos.length}`);

      // Add like and comment counts + ownerWhoCanComment
      const videosWithCounts = await Promise.all(
        privacyFiltered.map(async (video) => {
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
            ownerWhoCanComment: settingsMap.get(video.userId)?.whoCanComment || 'everyone',
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
        .andWhere('video.isHidden = :isHidden', { isHidden: false })
        .andWhere('video.visibility IN (:...visibilities)', { visibilities: [VideoVisibility.PUBLIC, VideoVisibility.FRIENDS] })
        .andWhere('video.userId IN (:...userIds)', { userIds: mutualFriendIds.map(id => id.toString()) })
        .andWhere('video.createdAt > :since', { since: sevenDaysAgo })
        .orderBy('video.createdAt', 'DESC')
        .take(limit)
        .getMany();

      console.log(`[OK] Found ${videos.length} recent public/friends videos from mutual friends (last 7 days)`);

      // [PRIVACY] Filter by whoCanViewVideos setting
      // Friends tab = mutual follows, so whoCanViewVideos='friends' is OK
      // accountPrivacy='private' is OK because viewer is a follower AND friend
      // Only whoCanViewVideos='onlyMe' should be excluded
      const ownerIds = [...new Set(videos.map(v => v.userId))];
      const settingsMap = await this.privacyService.getPrivacySettingsBatch(ownerIds);
      const privacyFiltered = videos.filter(video => {
        const settings = settingsMap.get(video.userId);
        if (!settings) return true;
        if (settings.whoCanViewVideos === 'onlyMe') return false;
        return true;
      });
      console.log(`[PRIVACY] Friends feed after privacy filter: ${privacyFiltered.length}/${videos.length}`);

      // Add like and comment counts
      const videosWithCounts = await Promise.all(
        privacyFiltered.map(async (video) => {
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
            ownerWhoCanComment: settingsMap.get(video.userId)?.whoCanComment || 'everyone',
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

    // [SYNC] TikTok behavior: hiding a video → set private + disable comments
    // Unhiding a video → restore to public + enable comments
    if (video.isHidden) {
      video.visibility = 'private' as any;
      video.allowComments = false;
    } else {
      // Restore to public visibility and re-enable comments when unhiding
      video.visibility = 'public' as any;
      video.allowComments = true;
    }

    const result = await this.videoRepository.save(video);

    // [OK] Invalidate caches
    await this.cacheManager.del(`video:${videoId}`);
    await this.invalidateUserVideosCache(userId);
    await this.invalidateFeedCaches();

    // [ES] Remove from or re-add to Elasticsearch index
    try {
      if (video.isHidden) {
        // Video is now hidden → remove from search index
        await this.searchService.deleteVideo(videoId);
        console.log(`[ES] Removed hidden video ${videoId} from search index`);
      } else if (video.status === 'ready') {
        // Video is now visible again → re-add to search index
        const likeCount = await this.likesService.getLikeCount(videoId);
        const commentCount = await this.commentsService.getCommentCount(videoId);
        await this.searchService.indexVideo({
          id: video.id,
          title: video.title || '',
          description: video.description || '',
          userId: video.userId,
          thumbnailUrl: video.thumbnailUrl || '',
          hlsUrl: video.hlsUrl || '',
          aspectRatio: video.aspectRatio || '9:16',
          viewCount: video.viewCount || 0,
          likeCount,
          commentCount,
          createdAt: video.createdAt,
        });
        console.log(`[ES] Re-indexed unhidden video ${videoId} to search index`);
      }
    } catch (e) {
      console.error(`[ES] Error updating search index for video ${videoId}:`, e);
    }

    // Log video_hidden activity
    this.activityLoggerService.logActivity({
      userId: parseInt(userId),
      actionType: 'video_hidden',
      targetId: videoId,
      targetType: 'video',
      metadata: { isHidden: video.isHidden, title: video.title, videoThumbnail: video.thumbnailUrl },
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

      // 4. Delete custom thumbnail if exists locally
      if (video.thumbnailUrl) {
        // Custom thumbnail stored at /uploads/thumbnails/{filename}
        if (video.thumbnailUrl.startsWith('/uploads/thumbnails/')) {
          const thumbLocalPath = path.resolve(process.cwd(), video.thumbnailUrl.replace(/^\//, ''));
          if (fs.existsSync(thumbLocalPath)) {
            try {
              fs.unlinkSync(thumbLocalPath);
              console.log(`[DELETE] Deleted custom thumbnail: ${thumbLocalPath}`);
            } catch (e) {
              console.error(`[WARN] Could not delete custom thumbnail: ${e}`);
            }
          }
        }
      }

      // 5. Delete from S3 if enabled (raw video, processed videos, thumbnails)
      if (this.storageService.isEnabled()) {
        try {
          // Delete raw video from S3
          if (video.rawVideoPath) {
            const rawFileName = path.basename(video.rawVideoPath);
            await this.storageService.deleteFile(`raw_videos/${rawFileName}`);
            console.log(`[S3] Deleted raw video from S3: raw_videos/${rawFileName}`);
          }

          // Delete processed video folder from S3
          await this.storageService.deleteDirectory(`processed_videos/${processedFolderName}/`);
          console.log(`[S3] Deleted processed videos from S3: processed_videos/${processedFolderName}/`);

          // Delete custom thumbnail from S3
          if (video.thumbnailUrl && video.thumbnailUrl.includes('/thumbnails/')) {
            // Extract S3 key from CloudFront URL or local path
            const thumbMatch = video.thumbnailUrl.match(/thumbnails\/([^/?]+)/);
            if (thumbMatch && thumbMatch[1]) {
              await this.storageService.deleteFile(`thumbnails/${thumbMatch[1]}`);
              console.log(`[S3] Deleted thumbnail from S3: thumbnails/${thumbMatch[1]}`);
            }
          }
        } catch (s3Error) {
          // Log S3 errors but don't block the deletion
          console.error(`[WARN] S3 cleanup error (video still deleted): ${s3Error.message}`);
        }
      }

      // 6. Finally, delete the video record from database
      await this.videoRepository.delete(videoId);

      // [OK] Delete from Elasticsearch index
      await this.searchService.deleteVideo(videoId);

      // [OK] Invalidate all related caches
      await this.cacheManager.del(`video:${videoId}`);
      await this.invalidateUserVideosCache(userId);
      await this.invalidateFeedCaches();

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

    const oldVisibility = video.visibility;

    if (settings.visibility !== undefined) {
      video.visibility = settings.visibility as any;
    }
    if (settings.allowComments !== undefined) {
      video.allowComments = settings.allowComments;
    }
    if (settings.allowDuet !== undefined) {
      video.allowDuet = settings.allowDuet;
    }

    // [SYNC] If changing visibility away from private, auto-unhide the video
    if (video.isHidden && settings.visibility && settings.visibility !== 'private') {
      video.isHidden = false;
      console.log(`[SYNC] Video ${videoId} auto-unhidden because visibility changed to ${settings.visibility}`);
    }

    await this.videoRepository.save(video);

    // Invalidate cache
    await this.cacheManager.del(`video:${videoId}`);
    await this.invalidateUserVideosCache(settings.userId);
    await this.invalidateFeedCaches();

    // [ES] Update Elasticsearch index based on new visibility
    try {
      if (video.visibility === 'private' || video.isHidden) {
        // Private or hidden → remove from search
        await this.searchService.deleteVideo(videoId);
        console.log(`[ES] Removed private/hidden video ${videoId} from search index`);
      } else if (video.status === 'ready' && (oldVisibility === 'private' || video.visibility === 'public')) {
        // Became visible → re-index
        const likeCount = await this.likesService.getLikeCount(videoId);
        const commentCount = await this.commentsService.getCommentCount(videoId);
        await this.searchService.indexVideo({
          id: video.id,
          title: video.title || '',
          description: video.description || '',
          userId: video.userId,
          thumbnailUrl: video.thumbnailUrl || '',
          hlsUrl: video.hlsUrl || '',
          aspectRatio: video.aspectRatio || '9:16',
          viewCount: video.viewCount || 0,
          likeCount,
          commentCount,
          createdAt: video.createdAt,
        });
        console.log(`[ES] Re-indexed video ${videoId} after visibility change to ${video.visibility}`);
      }
    } catch (e) {
      console.error(`[ES] Error updating search index for video ${videoId}:`, e);
    }

    // Log privacy_updated activity
    this.activityLoggerService.logActivity({
      userId: parseInt(settings.userId),
      actionType: 'privacy_updated',
      targetId: videoId,
      targetType: 'video',
      metadata: { visibility: video.visibility, allowComments: video.allowComments, allowDuet: video.allowDuet },
    });

    console.log(`[PRIVACY] Video ${videoId} privacy updated: visibility=${video.visibility}, comments=${video.allowComments}, duet=${video.allowDuet}, isHidden=${video.isHidden}`);

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
    await this.invalidateUserVideosCache(updateData.userId);

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

    // Upload new thumbnail to S3 if enabled, otherwise use local path
    if (this.storageService.isEnabled()) {
      const thumbS3Key = `thumbnails/${file.filename}`;
      const uploadResult = await this.storageService.uploadFile(
        file.path, thumbS3Key, file.mimetype || 'image/jpeg',
      );
      video.thumbnailUrl = uploadResult.url;
      console.log(`[S3] Thumbnail uploaded to S3: ${video.thumbnailUrl}`);
      // Delete local file after S3 upload
      try { fs.unlinkSync(file.path); } catch (e) { /* ignore */ }
    } else {
      video.thumbnailUrl = `/uploads/thumbnails/${file.filename}`;
    }
    await this.videoRepository.save(video);

    // Invalidate cache
    await this.cacheManager.del(`video:${videoId}`);
    await this.invalidateUserVideosCache(userId);
    await this.invalidateFeedCaches();

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

      // 1. Upload custom thumbnail to S3 if provided (before creating DB record)
      let thumbnailUrl: string | undefined;
      if (thumbnailFile) {
        // FileFieldsInterceptor uses multerConfig which saves ALL files to ./uploads/raw_videos/
        // We need to move the thumbnail to the correct directory: ./uploads/thumbnails/
        const thumbnailsDir = path.resolve(process.cwd(), 'uploads', 'thumbnails');
        if (!fs.existsSync(thumbnailsDir)) {
          fs.mkdirSync(thumbnailsDir, { recursive: true });
        }
        const correctThumbPath = path.join(thumbnailsDir, thumbnailFile.filename);
        try {
          fs.renameSync(thumbnailFile.path, correctThumbPath);
          thumbnailFile.path = correctThumbPath;
          console.log(`[THUMB] Moved thumbnail from raw_videos/ to thumbnails/: ${correctThumbPath}`);
        } catch (moveErr) {
          // Fallback: copy + delete if rename fails (cross-device)
          fs.copyFileSync(thumbnailFile.path, correctThumbPath);
          fs.unlinkSync(thumbnailFile.path);
          thumbnailFile.path = correctThumbPath;
          console.log(`[THUMB] Copied thumbnail to thumbnails/: ${correctThumbPath}`);
        }

        if (this.storageService.isEnabled()) {
          // Upload to S3 and get CloudFront URL
          const thumbS3Key = `thumbnails/${thumbnailFile.filename}`;
          const uploadResult = await this.storageService.uploadFile(
            thumbnailFile.path, thumbS3Key, thumbnailFile.mimetype || 'image/jpeg',
          );
          thumbnailUrl = uploadResult.url;
          console.log(`[S3] Custom thumbnail uploaded: ${thumbnailUrl}`);
          // Keep local file for dev/fallback, S3 is the primary source in production
        } else {
          // Local storage - file is now at ./uploads/thumbnails/{filename}
          thumbnailUrl = `/uploads/thumbnails/${thumbnailFile.filename}`;
        }
      }

      // 2. Create record in database
      const video = this.videoRepository.create({
        userId: uploadVideoDto.userId,
        title: uploadVideoDto.title,
        description: uploadVideoDto.description,
        originalFileName: videoFile.originalname,
        rawVideoPath: videoFile.path,
        fileSize: videoFile.size,
        status: VideoStatus.PROCESSING,
        visibility: uploadVideoDto.visibility || VideoVisibility.PUBLIC,
        allowComments: uploadVideoDto.allowComments !== undefined ? uploadVideoDto.allowComments : true,
        // Set custom thumbnail (CloudFront URL if S3 enabled, local path otherwise)
        thumbnailUrl,
      });

      const savedVideo = await this.videoRepository.save(video);
      console.log('Video saved to database:', savedVideo.id);

      // 3. Assign categories to video if provided
      if (uploadVideoDto.categoryIds && uploadVideoDto.categoryIds.length > 0) {
        await this.categoriesService.assignCategoriesToVideo(
          savedVideo.id,
          uploadVideoDto.categoryIds,
        );
        console.log('Categories assigned:', uploadVideoDto.categoryIds);
      }

      // 4. [S3 SYNC] Upload raw video to S3 BEFORE sending to queue
      await this.syncRawVideoToS3(videoFile.path, videoFile.filename);

      // 5. Send message to RabbitMQ for worker to process
      // Include flag to skip thumbnail generation if custom one provided
      await this.sendToQueue({
        videoId: savedVideo.id,
        filePath: videoFile.path,
        fileName: videoFile.filename,
        skipThumbnailGeneration: !!thumbnailFile,
        thumbnailTimestamp: uploadVideoDto.thumbnailTimestamp,
      });
      console.log('Job sent to RabbitMQ queue');

      // 6. Invalidate user videos cache
      await this.invalidateUserVideosCache(uploadVideoDto.userId);
      console.log(`[OK] Cache invalidated for user ${uploadVideoDto.userId}`);

      // 7. Log video_posted activity
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