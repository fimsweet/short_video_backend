import { Controller, Post, Get, Param, Body, Query } from '@nestjs/common';
import { LikesService } from './likes.service';

@Controller('likes')
export class LikesController {
  constructor(private readonly likesService: LikesService) {}

  @Post('toggle')
  async toggleLike(@Body() body: { videoId: string; userId: string }) {
    console.log('Toggle like:', body);
    const result = await this.likesService.toggleLike(body.videoId, body.userId);
    console.log('Toggle result:', result);
    return result;
  }

  @Get('count/:videoId')
  async getLikeCount(@Param('videoId') videoId: string) {
    const count = await this.likesService.getLikeCount(videoId);
    return { count };
  }

  @Get('check/:videoId/:userId')
  async checkLike(@Param('videoId') videoId: string, @Param('userId') userId: string) {
    console.log(`[API] Check like: videoId=${videoId}, userId=${userId}`);
    const liked = await this.likesService.isLikedByUser(videoId, userId);
    console.log(`[API] Like status for video ${videoId} by user ${userId}: ${liked}`);
    return { liked };
  }

  @Get('video/:videoId')
  async getLikesByVideo(@Param('videoId') videoId: string) {
    return this.likesService.getLikesByVideo(videoId);
  }

  @Get('user/:userId')
  async getLikedVideosByUser(@Param('userId') userId: string) {
    console.log(`Get liked videos by user: ${userId}`);
    const videos = await this.likesService.getLikedVideosByUser(userId);
    console.log(`Found ${videos.length} liked videos`);
    return videos;
  }

  /**
   * Get users with similar taste (liked same videos)
   */
  @Get('similar-users/:userId')
  async getUsersWithSimilarTaste(
    @Param('userId') userId: string,
    @Query('excludeIds') excludeIds?: string,
    @Query('limit') limit?: string,
  ) {
    const excludeUserIds = excludeIds 
      ? excludeIds.split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id))
      : [];
    
    return this.likesService.getUsersWithSimilarTaste(
      userId, 
      excludeUserIds,
      limit ? parseInt(limit) : 20
    );
  }

  /**
   * Get creators of videos that user has liked
   */
  @Get('liked-creators/:userId')
  async getCreatorsOfLikedVideos(
    @Param('userId') userId: string,
    @Query('excludeIds') excludeIds?: string,
    @Query('limit') limit?: string,
  ) {
    const excludeUserIds = excludeIds 
      ? excludeIds.split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id))
      : [];
    
    return this.likesService.getCreatorsOfLikedVideos(
      userId,
      excludeUserIds,
      limit ? parseInt(limit) : 20
    );
  }
}
