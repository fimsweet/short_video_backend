import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Like } from '../entities/like.entity';
import { Video } from '../entities/video.entity';
import { CommentsService } from '../comments/comments.service';
import { SavedVideosService } from '../saved-videos/saved-videos.service';
import { SharesService } from '../shares/shares.service';
import { ActivityLoggerService } from '../config/activity-logger.service';

@Injectable()
export class LikesService {
  constructor(
    @InjectRepository(Like)
    private likeRepository: Repository<Like>,
    @InjectRepository(Video)
    private videoRepository: Repository<Video>,
    @Inject(forwardRef(() => CommentsService))
    private commentsService: CommentsService,
    @Inject(forwardRef(() => SavedVideosService))
    private savedVideosService: SavedVideosService,
    @Inject(forwardRef(() => SharesService))
    private sharesService: SharesService,
    private activityLoggerService: ActivityLoggerService,
  ) { }

  async toggleLike(videoId: string, userId: string): Promise<{ liked: boolean; likeCount: number }> {
    console.log(`🔄 Toggle like: videoId=${videoId}, userId=${userId}`);

    const existingLike = await this.likeRepository.findOne({
      where: { videoId, userId },
    });

    if (existingLike) {
      console.log('❌ Unlike - removing existing like');
      await this.likeRepository.remove(existingLike);

      // Log unlike activity
      this.activityLoggerService.logActivity({
        userId: parseInt(userId),
        actionType: 'unlike',
        targetId: videoId,
        targetType: 'video',
      });

      const likeCount = await this.getLikeCount(videoId);
      return { liked: false, likeCount };
    } else {
      console.log('❤️ Like - creating new like');
      await this.likeRepository.save({
        videoId,
        userId,
      });

      // Log like activity
      this.activityLoggerService.logActivity({
        userId: parseInt(userId),
        actionType: 'like',
        targetId: videoId,
        targetType: 'video',
      });

      const likeCount = await this.getLikeCount(videoId);
      return { liked: true, likeCount };
    }
  }

  async getLikeCount(videoId: string): Promise<number> {
    return this.likeRepository.count({ where: { videoId } });
  }

  async isLikedByUser(videoId: string, userId: string): Promise<boolean> {
    console.log(`🔍 [DB] Checking like: videoId=${videoId}, userId=${userId}`);

    const like = await this.likeRepository.findOne({
      where: { videoId, userId },
    });

    const liked = !!like;
    console.log(`✅ [DB] Like found: ${liked}`, like ? `(id: ${like.id})` : '');
    return liked;
  }

  async getLikesByVideo(videoId: string): Promise<Like[]> {
    return this.likeRepository.find({
      where: { videoId },
      order: { createdAt: 'DESC' },
    });
  }

  async getLikedVideosByUser(userId: string): Promise<any[]> {
    console.log(`🔍 Fetching liked videos for user: ${userId}`);

    // Get all likes by this user
    const likes = await this.likeRepository.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });

    console.log(`📝 Found ${likes.length} total likes`);

    if (likes.length === 0) {
      return [];
    }

    // Get video details for each like, excluding user's own videos
    const videoIds = likes.map(like => like.videoId);
    const videos = await this.videoRepository
      .createQueryBuilder('video')
      .where('video.id IN (:...videoIds)', { videoIds })
      .andWhere('video.userId != :userId', { userId })
      .orderBy('video.createdAt', 'DESC')
      .getMany();

    console.log(`✅ Returning ${videos.length} videos (excluding user's own)`);

    // Add counts for each video (like, comment, save, share)
    const videosWithCounts = await Promise.all(
      videos.map(async (video) => {
        const likeCount = await this.getLikeCount(video.id);
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

    console.log(`✅ Added counts to ${videosWithCounts.length} videos`);
    return videosWithCounts;
  }

  async deleteAllLikesForVideo(videoId: string): Promise<void> {
    await this.likeRepository.delete({ videoId });
    console.log(`🗑️ Deleted all likes for video ${videoId}`);
  }
}
