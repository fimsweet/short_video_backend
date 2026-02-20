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

  /**
   * Get follow status: 'none', 'pending', 'following'
   */
  @Get('status/:followerId/:followingId')
  async getFollowStatus(
    @Param('followerId') followerId: string,
    @Param('followingId') followingId: string,
  ) {
    const status = await this.followsService.getFollowStatus(
      parseInt(followerId, 10),
      parseInt(followingId, 10),
    );
    return { status };
  }

  /**
   * Get incoming pending follow requests for the current user
   */
  @Get('pending-requests/:userId')
  async getPendingRequests(
    @Param('userId') userId: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.followsService.getPendingFollowRequests(
      parseInt(userId, 10),
      limit ? parseInt(limit, 10) : 20,
      offset ? parseInt(offset, 10) : 0,
    );
  }

  /**
   * Get count of pending follow requests
   */
  @Get('pending-count/:userId')
  async getPendingCount(@Param('userId') userId: string) {
    const count = await this.followsService.getPendingRequestCount(parseInt(userId, 10));
    return { count };
  }

  /**
   * Approve a follow request
   */
  @Post('approve')
  async approveFollowRequest(@Body() body: { followerId: number; followingId: number }) {
    try {
      return await this.followsService.approveFollowRequest(body.followerId, body.followingId);
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }

  /**
   * Reject a follow request
   */
  @Post('reject')
  async rejectFollowRequest(@Body() body: { followerId: number; followingId: number }) {
    try {
      return await this.followsService.rejectFollowRequest(body.followerId, body.followingId);
    } catch (error) {
      throw new BadRequestException(error.message);
    }
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
    @Query('requesterId') requesterId?: string,
  ) {
    const targetId = parseInt(userId, 10);
    // Privacy check
    if (requesterId) {
      const privacyCheck = await this.followsService.checkListPrivacy(
        targetId, parseInt(requesterId, 10), 'followers',
      );
      if (!privacyCheck.allowed) {
        return { data: [], hasMore: false, total: 0, privacyRestricted: true, reason: privacyCheck.reason };
      }
    }
    const result = await this.followsService.getFollowersWithMutualStatus(
      targetId,
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
    @Query('requesterId') requesterId?: string,
  ) {
    const targetId = parseInt(userId, 10);
    // Privacy check
    if (requesterId) {
      const privacyCheck = await this.followsService.checkListPrivacy(
        targetId, parseInt(requesterId, 10), 'following',
      );
      if (!privacyCheck.allowed) {
        return { data: [], hasMore: false, total: 0, privacyRestricted: true, reason: privacyCheck.reason };
      }
    }
    const result = await this.followsService.getFollowingWithMutualStatus(
      targetId,
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

  /**
   * Check list privacy: can requester view target's followers/following/liked list
   */
  @Get('check-list-privacy/:targetUserId')
  async checkListPrivacy(
    @Param('targetUserId') targetUserId: string,
    @Query('requesterId') requesterId: string,
    @Query('listType') listType: 'followers' | 'following' | 'likedVideos',
  ) {
    const result = await this.followsService.checkListPrivacy(
      parseInt(targetUserId, 10),
      requesterId ? parseInt(requesterId, 10) : undefined,
      listType || 'followers',
    );
    return result;
  }
}
