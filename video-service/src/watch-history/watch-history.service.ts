import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, MoreThan } from 'typeorm';
import { WatchHistory } from '../entities/watch-history.entity';
import { CategoriesService } from '../categories/categories.service';
import { VideoCategory } from '../entities/video-category.entity';

export interface WatchBasedInterest {
  categoryId: number;
  categoryName: string;
  weight: number;
  totalWatchTime: number;
  videoCount: number;
}

@Injectable()
export class WatchHistoryService {
  constructor(
    @InjectRepository(WatchHistory)
    private watchHistoryRepository: Repository<WatchHistory>,
    @Inject(forwardRef(() => CategoriesService))
    private categoriesService: CategoriesService,
  ) {}

  /**
   * Record or update video watch history
   * Called when user watches or leaves a video
   */
  async recordWatch(
    userId: string,
    videoId: string,
    watchDuration: number,
    videoDuration: number,
  ): Promise<WatchHistory> {
    // Calculate watch percentage
    const watchPercentage = videoDuration > 0 
      ? Math.min((watchDuration / videoDuration) * 100, 100) 
      : 0;
    const isCompleted = watchPercentage >= 90;

    // Check if watch history already exists
    let history = await this.watchHistoryRepository.findOne({
      where: { userId, videoId },
    });

    if (history) {
      // Update: keep max watch duration
      history.watchDuration = Math.max(history.watchDuration, watchDuration);
      history.videoDuration = videoDuration;
      history.watchPercentage = Math.max(history.watchPercentage, watchPercentage);
      history.watchCount += 1;
      history.isCompleted = history.isCompleted || isCompleted;
      history.lastWatchedAt = new Date();
    } else {
      // Create new entry
      history = this.watchHistoryRepository.create({
        userId,
        videoId,
        watchDuration,
        videoDuration,
        watchPercentage,
        watchCount: 1,
        isCompleted,
      });
    }

    const saved = await this.watchHistoryRepository.save(history);
    console.log(`[WATCH] Watch recorded: user=${userId}, video=${videoId}, ${watchPercentage.toFixed(1)}% (${watchDuration}s/${videoDuration}s)`);
    
    return saved;
  }

  /**
   * Get watch history for a user
   */
  async getUserWatchHistory(
    userId: string,
    limit: number = 50,
    offset: number = 0,
  ): Promise<{ data: WatchHistory[]; total: number }> {
    const [data, total] = await this.watchHistoryRepository.findAndCount({
      where: { userId },
      order: { lastWatchedAt: 'DESC' },
      take: limit,
      skip: offset,
    });

    return { data, total };
  }

  /**
   * Remove a single video from watch history
   */
  async removeFromHistory(userId: string, videoId: string): Promise<boolean> {
    const result = await this.watchHistoryRepository.delete({ userId, videoId });
    return (result.affected || 0) > 0;
  }

  /**
   * Clear all watch history for a user
   */
  async clearHistory(userId: string): Promise<number> {
    const result = await this.watchHistoryRepository.delete({ userId });
    return result.affected || 0;
  }

  /**
   * Calculate implicit interests from watch time data
   * Core function for the recommendation engine
   * 
   * Logic:
   * - Only considers videos watched >30% or >10 seconds (filters out quick skips)
   * - Weight = total watch time per category / max watch time (normalized)
   * - Rewatches boost the weight
   */
  async getWatchTimeBasedInterests(userId: string): Promise<WatchBasedInterest[]> {
    console.log(`[STATS] Calculating watch-time interests for user ${userId}...`);

    // Last 30 days, only meaningful watches (>30% or >10s)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const watchHistory = await this.watchHistoryRepository
      .createQueryBuilder('wh')
      .where('wh.userId = :userId', { userId })
      .andWhere('wh.lastWatchedAt > :date', { date: thirtyDaysAgo })
      .andWhere('(wh.watchPercentage >= 30 OR wh.watchDuration >= 10)')
      .orderBy('wh.lastWatchedAt', 'DESC')
      .take(100) // Limit to most recent 100 videos
      .getMany();

    if (watchHistory.length === 0) {
      console.log(`   No meaningful watch history found`);
      return [];
    }

    // Fetch categories for watched videos
    const videoIds = watchHistory.map(wh => wh.videoId);
    const videoCategories = await this.categoriesService.getVideoCategoriesBulk(videoIds);

    // Aggregate total watch time per category
    const categoryStats: Map<number, {
      categoryName: string;
      totalWatchTime: number;
      totalVideos: number;
      completedVideos: number;
      rewatchCount: number;
    }> = new Map();

    for (const wh of watchHistory) {
      const categories = videoCategories.get(wh.videoId) || [];
      
      for (const cat of categories) {
        const stats = categoryStats.get(cat.categoryId) || {
          categoryName: cat.categoryName,
          totalWatchTime: 0,
          totalVideos: 0,
          completedVideos: 0,
          rewatchCount: 0,
        };

        // Weighted watch time scoring
        // Completed video = 1.5x, each rewatch = +0.2x (capped at 5 rewatches)
        let effectiveWatchTime = wh.watchDuration;
        if (wh.isCompleted) effectiveWatchTime *= 1.5;
        if (wh.watchCount > 1) effectiveWatchTime *= (1 + 0.2 * Math.min(wh.watchCount - 1, 5));

        stats.totalWatchTime += effectiveWatchTime;
        stats.totalVideos++;
        if (wh.isCompleted) stats.completedVideos++;
        stats.rewatchCount += Math.max(0, wh.watchCount - 1);

        categoryStats.set(cat.categoryId, stats);
      }
    }

    // Convert to interests with normalized weights
    const maxWatchTime = Math.max(...Array.from(categoryStats.values()).map(s => s.totalWatchTime));
    
    const interests: WatchBasedInterest[] = [];
    categoryStats.forEach((stats, categoryId) => {
      // Weight = normalized watch time (0-1)
      // Boost weight for high completion and rewatch rates
      let weight = stats.totalWatchTime / maxWatchTime;
      
      // Boost for completion rate
      const completionRate = stats.completedVideos / stats.totalVideos;
      weight *= (1 + completionRate * 0.3);

      interests.push({
        categoryId,
        categoryName: stats.categoryName,
        weight: Math.min(weight, 2), // Cap at 2
        totalWatchTime: stats.totalWatchTime,
        videoCount: stats.totalVideos,
      });
    });

    // Sort by weight descending
    interests.sort((a, b) => b.weight - a.weight);

    console.log(`   Found ${interests.length} category interests based on watch time`);
    console.log(`   Top 3: ${interests.slice(0, 3).map(i => `${i.categoryName}(${i.weight.toFixed(2)})`).join(', ')}`);

    return interests;
  }

  /**
   * Check if a user has watched a specific video
   */
  async hasWatched(userId: string, videoId: string): Promise<boolean> {
    const count = await this.watchHistoryRepository.count({
      where: { userId, videoId },
    });
    return count > 0;
  }

  /**
   * Get list of watched video IDs (used to exclude from recommendations)
   */
  async getWatchedVideoIds(userId: string, limit: number = 100): Promise<string[]> {
    const history = await this.watchHistoryRepository.find({
      where: { userId },
      select: ['videoId'],
      order: { lastWatchedAt: 'DESC' },
      take: limit,
    });

    return history.map(h => h.videoId);
  }

  /**
   * Get aggregated watch statistics for a user
   */
  async getUserWatchStats(userId: string): Promise<{
    totalWatchTime: number;
    totalVideosWatched: number;
    completedVideos: number;
    avgWatchPercentage: number;
  }> {
    const stats = await this.watchHistoryRepository
      .createQueryBuilder('wh')
      .select('SUM(wh.watchDuration)', 'totalWatchTime')
      .addSelect('COUNT(*)', 'totalVideosWatched')
      .addSelect('SUM(CASE WHEN wh.isCompleted = true THEN 1 ELSE 0 END)', 'completedVideos')
      .addSelect('AVG(wh.watchPercentage)', 'avgWatchPercentage')
      .where('wh.userId = :userId', { userId })
      .getRawOne();

    return {
      totalWatchTime: parseInt(stats.totalWatchTime) || 0,
      totalVideosWatched: parseInt(stats.totalVideosWatched) || 0,
      completedVideos: parseInt(stats.completedVideos) || 0,
      avgWatchPercentage: parseFloat(stats.avgWatchPercentage) || 0,
    };
  }
}
