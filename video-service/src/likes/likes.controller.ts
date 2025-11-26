import { Controller, Post, Get, Param, Body } from '@nestjs/common';
import { LikesService } from './likes.service';

@Controller('likes')
export class LikesController {
  constructor(private readonly likesService: LikesService) {}

  @Post('toggle')
  async toggleLike(@Body() body: { videoId: string; userId: string }) {
    console.log('👆 Toggle like:', body);
    const result = await this.likesService.toggleLike(body.videoId, body.userId);
    console.log('✅ Toggle result:', result);
    return result;
  }

  @Get('count/:videoId')
  async getLikeCount(@Param('videoId') videoId: string) {
    const count = await this.likesService.getLikeCount(videoId);
    return { count };
  }

  @Get('check/:videoId/:userId')
  async checkLike(@Param('videoId') videoId: string, @Param('userId') userId: string) {
    console.log(`🔍 [API] Check like: videoId=${videoId}, userId=${userId}`);
    const liked = await this.likesService.isLikedByUser(videoId, userId);
    console.log(`✅ [API] Like status for video ${videoId} by user ${userId}: ${liked}`);
    return { liked };
  }

  @Get('video/:videoId')
  async getLikesByVideo(@Param('videoId') videoId: string) {
    return this.likesService.getLikesByVideo(videoId);
  }
}
