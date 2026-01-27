import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  ParseIntPipe,
} from '@nestjs/common';
import { WatchHistoryService } from './watch-history.service';

class RecordWatchDto {
  userId: string;
  videoId: string;
  watchDuration: number; // giây
  videoDuration: number; // giây
}

@Controller('watch-history')
export class WatchHistoryController {
  constructor(private readonly watchHistoryService: WatchHistoryService) {}

  /**
   * Ghi nhận thời gian xem video
   * POST /watch-history
   */
  @Post()
  async recordWatch(@Body() dto: RecordWatchDto) {
    const result = await this.watchHistoryService.recordWatch(
      dto.userId,
      dto.videoId,
      dto.watchDuration,
      dto.videoDuration,
    );

    return {
      success: true,
      message: 'Watch recorded',
      data: {
        id: result.id,
        watchPercentage: result.watchPercentage,
        isCompleted: result.isCompleted,
        watchCount: result.watchCount,
      },
    };
  }

  /**
   * Lấy lịch sử xem của user
   * GET /watch-history/:userId
   */
  @Get(':userId')
  async getUserHistory(
    @Param('userId') userId: string,
    @Query('limit') limit?: number,
    @Query('offset') offset?: number,
  ) {
    const result = await this.watchHistoryService.getUserWatchHistory(
      userId,
      limit || 50,
      offset || 0,
    );

    return {
      success: true,
      data: result.data,
      total: result.total,
    };
  }

  /**
   * Lấy interests dựa trên watch time
   * GET /watch-history/:userId/interests
   */
  @Get(':userId/interests')
  async getWatchInterests(@Param('userId') userId: string) {
    const interests = await this.watchHistoryService.getWatchTimeBasedInterests(userId);

    return {
      success: true,
      data: interests,
    };
  }

  /**
   * Lấy thống kê xem của user
   * GET /watch-history/:userId/stats
   */
  @Get(':userId/stats')
  async getUserStats(@Param('userId') userId: string) {
    const stats = await this.watchHistoryService.getUserWatchStats(userId);

    return {
      success: true,
      data: stats,
    };
  }

  /**
   * Xoá một video khỏi lịch sử
   * DELETE /watch-history/:userId/:videoId
   */
  @Delete(':userId/:videoId')
  async removeFromHistory(
    @Param('userId') userId: string,
    @Param('videoId') videoId: string,
  ) {
    const removed = await this.watchHistoryService.removeFromHistory(userId, videoId);

    return {
      success: removed,
      message: removed ? 'Removed from history' : 'Not found in history',
    };
  }

  /**
   * Xoá toàn bộ lịch sử
   * DELETE /watch-history/:userId
   */
  @Delete(':userId')
  async clearHistory(@Param('userId') userId: string) {
    const count = await this.watchHistoryService.clearHistory(userId);

    return {
      success: true,
      message: `Cleared ${count} items from history`,
      deletedCount: count,
    };
  }
}
