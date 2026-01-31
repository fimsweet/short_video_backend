import { Controller, Post, Get, Param, Body, BadRequestException, Query } from '@nestjs/common';
import { FollowsService } from './follows.service';

@Controller('follows')
export class FollowsController {
  constructor(private readonly followsService: FollowsService) {}

  @Post('toggle')
  async toggleFollow(@Body() body: { followerId: number; followingId: number }) {
    try {
      return await this.followsService.toggleFollow(body.followerId, body.followingId);
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }

  @Get('check/:followerId/:followingId')
  async checkFollow(
    @Param('followerId') followerId: string,
    @Param('followingId') followingId: string,
  ) {
    const following = await this.followsService.isFollowing(
      parseInt(followerId, 10),
      parseInt(followingId, 10),
    );
    return { following };
  }

  @Get('followers/:userId')
  async getFollowers(@Param('userId') userId: string) {
    const followerIds = await this.followsService.getFollowers(parseInt(userId, 10));
    return { followerIds };
  }

  @Get('following/:userId')
  async getFollowing(@Param('userId') userId: string) {
    const followingIds = await this.followsService.getFollowing(parseInt(userId, 10));
    return { followingIds };
  }

  @Get('stats/:userId')
  async getStats(@Param('userId') userId: string) {
    const id = parseInt(userId, 10);
    const [followerCount, followingCount] = await Promise.all([
      this.followsService.getFollowerCount(id),
      this.followsService.getFollowingCount(id),
    ]);
    return { followerCount, followingCount };
  }

  @Get('followers-with-status/:userId')
  async getFollowersWithStatus(
    @Param('userId') userId: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const result = await this.followsService.getFollowersWithMutualStatus(
      parseInt(userId, 10),
      limit ? parseInt(limit, 10) : 20,
      offset ? parseInt(offset, 10) : 0,
    );
    return result;
  }

  @Get('following-with-status/:userId')
  async getFollowingWithStatus(
    @Param('userId') userId: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const result = await this.followsService.getFollowingWithMutualStatus(
      parseInt(userId, 10),
      limit ? parseInt(limit, 10) : 20,
      offset ? parseInt(offset, 10) : 0,
    );
    return result;
  }

  @Get('check-mutual/:userId1/:userId2')
  async checkMutual(
    @Param('userId1') userId1: string,
    @Param('userId2') userId2: string,
  ) {
    const isMutual = await this.followsService.isMutualFollow(
      parseInt(userId1, 10),
      parseInt(userId2, 10),
    );
    return { isMutual };
  }

  /**
   * Get suggested users to follow
   * Returns users based on mutual friends, similar taste, liked content, popularity, etc.
   */
  @Get('suggestions/:userId')
  async getSuggestions(
    @Param('userId') userId: string,
    @Query('limit') limit?: string,
  ) {
    const suggestions = await this.followsService.getSuggestions(
      parseInt(userId, 10),
      limit ? parseInt(limit, 10) : 15,
    );
    return { 
      success: true,
      data: suggestions,
    };
  }

  /**
   * Get mutual friends (users who follow each other)
   * This is the "Friends" relationship like TikTok
   */
  @Get('mutual-friends/:userId')
  async getMutualFriends(
    @Param('userId') userId: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const result = await this.followsService.getMutualFriends(
      parseInt(userId, 10),
      limit ? parseInt(limit, 10) : 20,
      offset ? parseInt(offset, 10) : 0,
    );
    return result;
  }
}
