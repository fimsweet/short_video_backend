import { Controller, Get, Param, Query, ParseIntPipe, DefaultValuePipe } from '@nestjs/common';
import { RecommendationService } from './recommendation.service';

@Controller('recommendation')
export class RecommendationController {
  constructor(private readonly recommendationService: RecommendationService) {}

  /**
   * GET /recommendation/for-you/:userId
   * Get personalized video recommendations for a user
   */
  @Get('for-you/:userId')
  async getForYouFeed(
    @Param('userId', ParseIntPipe) userId: number,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
  ) {
    const videos = await this.recommendationService.getRecommendedVideos(userId, limit);
    return {
      success: true,
      data: videos,
      count: videos.length,
    };
  }

  /**
   * GET /recommendation/trending
   * Get trending videos (for new users or discovery)
   */
  @Get('trending')
  async getTrendingVideos(
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
  ) {
    const videos = await this.recommendationService.getTrendingVideos(limit);
    return {
      success: true,
      data: videos,
      count: videos.length,
    };
  }

  /**
   * GET /recommendation/category/:categoryId
   * Get videos by category
   */
  @Get('category/:categoryId')
  async getVideosByCategory(
    @Param('categoryId', ParseIntPipe) categoryId: number,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
  ) {
    const videos = await this.recommendationService.getVideosByCategory(categoryId, limit);
    return {
      success: true,
      data: videos,
      count: videos.length,
    };
  }

  /**
   * POST /recommendation/invalidate/:userId
   * Invalidate recommendation cache for a user (call after significant user action)
   */
  @Get('invalidate/:userId')
  async invalidateCache(@Param('userId', ParseIntPipe) userId: number) {
    await this.recommendationService.invalidateUserCache(userId);
    return {
      success: true,
      message: `Cache invalidated for user ${userId}`,
    };
  }
}
