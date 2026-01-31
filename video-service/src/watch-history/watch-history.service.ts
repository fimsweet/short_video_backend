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
   * Ghi nhận hoặc cập nhật lịch sử xem video
   * Được gọi khi user xem video hoặc rời khỏi video
   */
  async recordWatch(
    userId: string,
    videoId: string,
    watchDuration: number,
    videoDuration: number,
  ): Promise<WatchHistory> {
    // Tính % đã xem
    const watchPercentage = videoDuration > 0 
      ? Math.min((watchDuration / videoDuration) * 100, 100) 
      : 0;
    const isCompleted = watchPercentage >= 90;

    // Tìm xem đã có history chưa
    let history = await this.watchHistoryRepository.findOne({
      where: { userId, videoId },
    });

    if (history) {
      // Cập nhật: giữ lại max watch duration
      history.watchDuration = Math.max(history.watchDuration, watchDuration);
      history.videoDuration = videoDuration;
      history.watchPercentage = Math.max(history.watchPercentage, watchPercentage);
      history.watchCount += 1;
      history.isCompleted = history.isCompleted || isCompleted;
      history.lastWatchedAt = new Date();
    } else {
      // Tạo mới
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
   * Lấy lịch sử xem của user
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
   * Xoá một video khỏi lịch sử xem
   */
  async removeFromHistory(userId: string, videoId: string): Promise<boolean> {
    const result = await this.watchHistoryRepository.delete({ userId, videoId });
    return (result.affected || 0) > 0;
  }

  /**
   * Xoá toàn bộ lịch sử xem
   */
  async clearHistory(userId: string): Promise<number> {
    const result = await this.watchHistoryRepository.delete({ userId });
    return result.affected || 0;
  }

  /**
   * Tính toán implicit interests từ watch time
   * Đây là hàm quan trọng nhất cho recommendation
   * 
   * Logic:
   * - Chỉ tính những video xem >30% hoặc >10 giây (để loại bỏ skip nhanh)
   * - Weight = tổng thời gian xem của category / max thời gian xem
   * - Xem lại nhiều lần = boost weight
   */
  async getWatchTimeBasedInterests(userId: string): Promise<WatchBasedInterest[]> {
    console.log(`[STATS] Calculating watch-time interests for user ${userId}...`);

    // Lấy 30 ngày gần nhất, chỉ những video xem ý nghĩa (>30% hoặc >10s)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const watchHistory = await this.watchHistoryRepository
      .createQueryBuilder('wh')
      .where('wh.userId = :userId', { userId })
      .andWhere('wh.lastWatchedAt > :date', { date: thirtyDaysAgo })
      .andWhere('(wh.watchPercentage >= 30 OR wh.watchDuration >= 10)')
      .orderBy('wh.lastWatchedAt', 'DESC')
      .take(100) // Giới hạn 100 video gần nhất
      .getMany();

    if (watchHistory.length === 0) {
      console.log(`   No meaningful watch history found`);
      return [];
    }

    // Lấy categories của các video đã xem
    const videoIds = watchHistory.map(wh => wh.videoId);
    const videoCategories = await this.categoriesService.getVideoCategoriesBulk(videoIds);

    // Tính tổng watch time theo category
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

        // Tính điểm watch time có trọng số
        // Video xem hoàn thành = 1.5x, rewatch = 1.2x mỗi lần
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

    // Chuyển đổi thành interests với weight chuẩn hoá
    const maxWatchTime = Math.max(...Array.from(categoryStats.values()).map(s => s.totalWatchTime));
    
    const interests: WatchBasedInterest[] = [];
    categoryStats.forEach((stats, categoryId) => {
      // Weight = normalized watch time (0-1)
      // Boost thêm nếu có nhiều video hoàn thành hoặc xem lại
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

    // Sắp xếp theo weight giảm dần
    interests.sort((a, b) => b.weight - a.weight);

    console.log(`   Found ${interests.length} category interests based on watch time`);
    console.log(`   Top 3: ${interests.slice(0, 3).map(i => `${i.categoryName}(${i.weight.toFixed(2)})`).join(', ')}`);

    return interests;
  }

  /**
   * Kiểm tra user đã xem video này chưa
   */
  async hasWatched(userId: string, videoId: string): Promise<boolean> {
    const count = await this.watchHistoryRepository.count({
      where: { userId, videoId },
    });
    return count > 0;
  }

  /**
   * Lấy danh sách video user đã xem (để lọc khỏi recommendation)
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
   * Thống kê watch time của user
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
